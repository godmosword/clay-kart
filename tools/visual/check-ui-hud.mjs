#!/usr/bin/env node
/**
 * ui-hud 機械驗收（BAR-VISUAL §1.3 / §5.12）。
 *
 * 可程式判定：底板 `#f0e4cd`、數字 `#3a5f96`、告警 `#ff8c2b`；
 * 禁純白底；opacity 必須為 1、無 backdrop-filter；
 * 底板短邊 / 畫面短邊 ≤ 1/8。
 *
 * Usage:
 *   npm run build && node tools/visual/check-ui-hud.mjs
 *   npm run test:ui-hud
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

const EXPECT = {
  board: { r: 0xf0, g: 0xe4, b: 0xcd },
  number: { r: 0x3a, g: 0x5f, b: 0x96 },
  alert: { r: 0xff, g: 0x8c, b: 0x2b },
};
const RGB_TOL = 2;

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
  throw new Error('no Chrome/Chromium for ui-hud harness');
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
  pageErrors = [];

  constructor(url) {
    this.#socket = new WebSocket(url);
    this.#socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
        const text = (message.params.args ?? [])
          .map((arg) => arg.value ?? arg.description ?? '')
          .join(' ');
        if (text.trim()) this.pageErrors.push(`console.error: ${text}`);
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params?.exceptionDetails;
        this.pageErrors.push(`exception: ${details?.exception?.description ?? details?.text ?? ''}`);
        return;
      }
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

function parseRgb(css) {
  const m = String(css).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
}

function near(actual, expected, tol = RGB_TOL) {
  if (!actual) return false;
  return (
    Math.abs(actual.r - expected.r) <= tol &&
    Math.abs(actual.g - expected.g) <= tol &&
    Math.abs(actual.b - expected.b) <= tol
  );
}

async function main() {
  const { server, port } = await startStaticServer();
  const chromePath = await findChrome();
  const userDataDir = await mkdtemp(join(tmpdir(), 'clay-kart-ui-hud-'));

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
    await session.call('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });

    let ready = false;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const probe = await session.call('Runtime.evaluate', {
        expression: 'Boolean(document.querySelector(\'[data-role="clay-hud-board"]\'))',
        returnByValue: true,
      });
      if (probe?.result?.value === true) {
        ready = true;
        break;
      }
      await sleep(100);
    }
    if (!ready) throw new Error('clay-hud board never mounted');

    // 等一幀 layout / fitBoard
    await sleep(200);

    const measured = await session.call('Runtime.evaluate', {
      expression: `(() => {
        const board = document.querySelector('[data-role="clay-hud-board"]');
        const root = document.querySelector('[data-role="clay-hud"]');
        const mount = document.getElementById('app');
        if (!board || !root || !mount) return { error: 'missing nodes' };
        const bs = getComputedStyle(board);
        const rs = getComputedStyle(root);
        const values = [...document.querySelectorAll('[data-role="clay-hud-value"]')].map((el) => {
          const s = getComputedStyle(el);
          return { color: s.color, opacity: s.opacity, backdrop: s.backdropFilter || s.webkitBackdropFilter || 'none' };
        });
        const alert = document.querySelector('[data-role="clay-hud-alert"]');
        const as_ = alert ? getComputedStyle(alert) : null;
        const rect = board.getBoundingClientRect();
        // 用未 scale 的 offset 量「底板」本體；scale 是為了守 1/8，視覺短邊看 bounding
        const visualShort = Math.min(rect.width, rect.height);
        const viewShort = Math.min(mount.clientWidth, mount.clientHeight);
        return {
          boardBg: bs.backgroundColor,
          boardOpacity: bs.opacity,
          boardBackdrop: bs.backdropFilter || bs.webkitBackdropFilter || 'none',
          rootOpacity: rs.opacity,
          rootBackdrop: rs.backdropFilter || rs.webkitBackdropFilter || 'none',
          values,
          alertColor: as_ ? as_.color : null,
          alertOpacity: as_ ? as_.opacity : null,
          visualShort,
          viewShort,
          ratio: viewShort > 0 ? visualShort / viewShort : null,
        };
      })()`,
      returnByValue: true,
    });

    const data = measured?.result?.value;
    if (!data || data.error) throw new Error(`measure failed: ${JSON.stringify(data)}`);

    const failures = [];
    const boardRgb = parseRgb(data.boardBg);
    if (!near(boardRgb, EXPECT.board)) {
      failures.push(`board bg want #f0e4cd, got ${data.boardBg}`);
    }
    if (near(boardRgb, { r: 255, g: 255, b: 255 }, 0)) {
      failures.push('board bg is pure white #ffffff (banned)');
    }
    if (String(data.boardOpacity) !== '1') {
      failures.push(`board opacity must be 1, got ${data.boardOpacity}`);
    }
    if (String(data.rootOpacity) !== '1') {
      failures.push(`root opacity must be 1, got ${data.rootOpacity}`);
    }
    if (data.boardBackdrop && data.boardBackdrop !== 'none') {
      failures.push(`board backdrop-filter banned, got ${data.boardBackdrop}`);
    }
    if (data.rootBackdrop && data.rootBackdrop !== 'none') {
      failures.push(`root backdrop-filter banned, got ${data.rootBackdrop}`);
    }
    if (!Array.isArray(data.values) || data.values.length < 1) {
      failures.push('no clay-hud-value nodes');
    } else {
      for (const [i, v] of data.values.entries()) {
        if (!near(parseRgb(v.color), EXPECT.number)) {
          failures.push(`value[${i}] color want #3a5f96, got ${v.color}`);
        }
        if (String(v.opacity) !== '1') {
          failures.push(`value[${i}] opacity must be 1, got ${v.opacity}`);
        }
        if (v.backdrop && v.backdrop !== 'none') {
          failures.push(`value[${i}] backdrop-filter banned`);
        }
      }
    }
    if (!near(parseRgb(data.alertColor), EXPECT.alert)) {
      failures.push(`alert color want #ff8c2b, got ${data.alertColor}`);
    }
    if (data.ratio == null || !(data.ratio <= 1 / 8 + 1e-6)) {
      failures.push(
        `board short/view short must be ≤ 1/8, got ${data.ratio} ` +
          `(visualShort=${data.visualShort}, viewShort=${data.viewShort})`,
      );
    }

    if (session.pageErrors.length > 0) {
      failures.push(...session.pageErrors.map((e) => `page: ${e}`));
    }

    const report = {
      ok: failures.length === 0,
      mechanical_checks_passed: failures.length === 0,
      measured: data,
      failures,
    };
    console.log(JSON.stringify(report, null, 2));
    if (failures.length > 0) {
      console.error('\nui-hud mechanical: FAIL');
      for (const f of failures) console.error(' -', f);
      process.exitCode = 1;
    } else {
      console.error('\nui-hud mechanical: PASS');
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
