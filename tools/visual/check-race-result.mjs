#!/usr/bin/env node
/**
 * 結算畫面機械驗收（BAR-CONTENT §2.1／§2.2）。
 *
 * - 以 `?totalLaps=1` 縮短到完賽（條款問的是 totalLaps，不是硬鎖 3）
 * - 持油門＋右轉繞圈直到 `[data-role="race-result"]` 出現
 * - 斷言名次、總時間、名次列表、重新開始後 LAP 回到 1
 *
 * 這支檢查必須能失敗：拿掉結算畫面會紅（R36 要求寫完自驗一次）。
 *
 * Usage:
 *   npm run build && node tools/visual/check-race-result.mjs
 *   npm run test:race-result
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve, sep, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const BUILD_ROOT = resolve(REPO_ROOT, 'build/out');

/** SwiftShader 下一圈約 20s；給足餘裕避免慢機假紅。 */
const FINISH_WALL_MS = 120_000;
const KEY_CODES = {
  ArrowUp: 38,
  ArrowRight: 39,
};

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // next
    }
  }
  throw new Error('no Chrome/Chromium for race-result harness');
}

function mimeType(path) {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'application/octet-stream';
}

async function startStaticServer() {
  await access(join(BUILD_ROOT, 'index.html'));
  const server = createServer(async (request, response) => {
    try {
      const requested = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
      const filePath = resolve(BUILD_ROOT, relative);
      if (filePath !== BUILD_ROOT && !filePath.startsWith(`${BUILD_ROOT}${sep}`)) {
        response.writeHead(403);
        response.end('forbidden');
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, { 'content-type': mimeType(filePath), 'cache-control': 'no-store' });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end('not found');
    }
  });
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', done);
  });
  return { server, port: server.address().port };
}

async function waitForDevtoolsPort(child) {
  return new Promise((done, fail) => {
    let settled = false;
    let output = '';
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      fail(new Error(`Chrome did not expose CDP: ${output.slice(-400)}`));
    }, 15_000);
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
      const match = output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) finish(done, Number(match[1]));
    });
    child.once('exit', (code) => finish(fail, new Error(`Chrome exited early (${code})`)));
  });
}

async function waitForPageTarget(port) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((target) => target.type === 'page');
      if (page) return page;
    } catch {
      // starting
    }
    await sleep(100);
  }
  throw new Error('Chrome exposed no page target');
}

class CdpSession {
  #socket;
  #nextId = 0;
  #pending = new Map();

  constructor(url) {
    this.#socket = new WebSocket(url);
    this.#socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    });
  }

  async connect() {
    await new Promise((done, fail) => {
      this.#socket.addEventListener('open', done, { once: true });
      this.#socket.addEventListener('error', fail, { once: true });
    });
  }

  call(method, params = {}) {
    const id = ++this.#nextId;
    this.#socket.send(JSON.stringify({ id, method, params }));
    return new Promise((done, fail) => {
      this.#pending.set(id, { resolve: done, reject: fail });
    });
  }

  close() {
    this.#socket.close();
  }
}

async function keyDown(session, code) {
  await session.call('Input.dispatchKeyEvent', {
    type: 'keyDown',
    code,
    key: code,
    windowsVirtualKeyCode: KEY_CODES[code],
    nativeVirtualKeyCode: KEY_CODES[code],
  });
}

async function keyUp(session, code) {
  await session.call('Input.dispatchKeyEvent', {
    type: 'keyUp',
    code,
    key: code,
    windowsVirtualKeyCode: KEY_CODES[code],
    nativeVirtualKeyCode: KEY_CODES[code],
  });
}

async function evaluate(session, expression) {
  const result = await session.call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result?.exceptionDetails) {
    throw new Error(`evaluate failed: ${JSON.stringify(result.exceptionDetails)}`);
  }
  return result?.result?.value;
}

async function main() {
  const { server, port } = await startStaticServer();
  const chromePath = await findChrome();
  const userDataDir = await mkdtemp(join(tmpdir(), 'clay-kart-race-result-'));
  const child = spawn(
    chromePath,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-extensions',
      '--disable-background-networking',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--window-size=1280,720',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  let session = null;
  const failures = [];
  try {
    const debugPort = await waitForDevtoolsPort(child);
    const page = await waitForPageTarget(debugPort);
    session = new CdpSession(page.webSocketDebuggerUrl);
    await session.connect();
    await session.call('Page.enable');
    await session.call('Runtime.enable');
    await session.call('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await session.call('Page.navigate', {
      url: `http://127.0.0.1:${port}/index.html?totalLaps=1`,
    });

    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const hasCanvas = await evaluate(session, 'Boolean(document.querySelector("#app canvas"))');
      if (hasCanvas) {
        ready = true;
        break;
      }
      await sleep(50);
    }
    if (!ready) throw new Error('canvas never mounted');

    // 繞圈直到完賽
    await keyDown(session, 'ArrowUp');
    await keyDown(session, 'ArrowRight');

    let finished = null;
    const deadline = Date.now() + FINISH_WALL_MS;
    while (Date.now() < deadline) {
      finished = await evaluate(
        session,
        `(() => {
          const root = document.querySelector('[data-role="race-result"]');
          if (!root || root.hidden) return null;
          const place = root.querySelector('[data-role="race-result-place"]')?.textContent?.trim() ?? '';
          const total = root.querySelector('[data-role="race-result-total-time"]')?.textContent?.trim() ?? '';
          const best = root.querySelector('[data-role="race-result-best-lap"]')?.textContent?.trim() ?? '';
          const rows = [...root.querySelectorAll('[data-role="race-result-standings"] li')].map((li) => ({
            text: li.textContent?.trim() ?? '',
            player: li.dataset.player === 'true',
          }));
          const restart = root.querySelector('[data-role="race-result-restart"]');
          const lapHud = document.querySelectorAll('[data-role="clay-hud-value"]')[0]?.textContent?.trim() ?? '';
          return {
            place,
            total,
            best,
            rows,
            hasRestart: Boolean(restart),
            restartDisabled: Boolean(restart?.disabled),
            lapHud,
            visible: !root.hidden,
          };
        })()`,
      );
      if (finished?.visible) break;
      await sleep(200);
    }

    await keyUp(session, 'ArrowRight');
    await keyUp(session, 'ArrowUp');

    if (!finished?.visible) {
      failures.push(`race-result never appeared within ${FINISH_WALL_MS}ms`);
    } else {
      if (!/^\d+\/\d+$/.test(finished.place)) {
        failures.push(`place missing/malformed: ${JSON.stringify(finished.place)}`);
      }
      if (!/TOTAL\s+\d+\.\d+s/i.test(finished.total)) {
        failures.push(`total time missing/malformed: ${JSON.stringify(finished.total)}`);
      }
      if (!/BEST\s+(\d+\.\d+s|--)/i.test(finished.best)) {
        failures.push(`best lap missing/malformed: ${JSON.stringify(finished.best)}`);
      }
      if (!finished.rows || finished.rows.length < 1) {
        failures.push('standings list empty');
      } else if (!finished.rows.some((row) => row.player)) {
        failures.push('standings has no player-marked row');
      }
      if (!finished.hasRestart) {
        failures.push('missing [data-role="race-result-restart"]');
      }
    }

    // 點重新開始 → LAP 回到 1/1（totalLaps=1）
    if (failures.length === 0) {
      await evaluate(
        session,
        `(() => {
          const btn = document.querySelector('[data-role="race-result-restart"]');
          if (!btn) throw new Error('restart missing at click time');
          btn.click();
          return true;
        })()`,
      );

      let after = null;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        after = await evaluate(
          session,
          `(() => {
            const root = document.querySelector('[data-role="race-result"]');
            const lapHud = document.querySelectorAll('[data-role="clay-hud-value"]')[0]?.textContent?.trim() ?? '';
            return {
              resultHidden: !root || root.hidden,
              lapHud,
            };
          })()`,
        );
        if (after?.resultHidden && /^1\//.test(after.lapHud)) break;
        await sleep(50);
      }

      if (!after?.resultHidden) {
        failures.push('race-result still visible after restart');
      }
      if (!after?.lapHud || !/^1\//.test(after.lapHud)) {
        failures.push(`lap did not return to 1 after restart: ${JSON.stringify(after?.lapHud)}`);
      }
    }

    const report = {
      ok: failures.length === 0,
      measured: finished,
      failures,
    };
    console.log(JSON.stringify(report, null, 2));
    if (failures.length) {
      console.error('\nrace-result: FAIL');
      for (const failure of failures) console.error(`  - ${failure}`);
      process.exitCode = 1;
    } else {
      console.error('\nrace-result: PASS');
    }
  } finally {
    session?.close();
    child.kill('SIGTERM');
    await new Promise((done) => child.once('exit', done));
    await new Promise((done) => server.close(done));
    await rm(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
