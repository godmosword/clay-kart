#!/usr/bin/env node
/**
 * 遊戲畫面截圖器。
 *
 * `render-components.mjs` 拍的是拍攝台上的單一元件，證明不了「元件裝進遊戲
 * 之後長什麼樣」——R18／R19 兩輪的元件圖都很正常，但遊戲畫面跑的一直是
 * W1 方塊車。這支腳本拍的是**真的跑起來的遊戲**（`build/out/`），跟
 * `perf-probe.mjs` 量的是同一份產物。
 *
 * 沿用 R16 的 raw CDP + headless Chrome 做法，不新增 npm 依賴。
 *
 * Usage:
 *   node tools/visual/game-shot.mjs --out build/visual/game.png \
 *     [--seconds 3] [--keys ArrowUp,ArrowRight] [--width 1280] [--height 720]
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const BUILD_ROOT = resolve(REPO_ROOT, 'build/out');

/** `player-input.ts` 的鍵盤對照表用 `code`，windowsVirtualKeyCode 只影響舊式事件。 */
const KEY_CODES = {
  ArrowUp: 38,
  ArrowDown: 40,
  ArrowLeft: 37,
  ArrowRight: 39,
  ControlLeft: 17,
  ShiftLeft: 16,
  Space: 32,
};

function parseArgs(argv) {
  const options = {
    out: resolve(REPO_ROOT, 'build/visual/game.png'),
    seconds: 3,
    keys: [],
    width: 1280,
    height: 720,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--out' && next) {
      options.out = resolve(next);
      i += 1;
    } else if (arg === '--seconds' && next) {
      options.seconds = Number(next);
      i += 1;
    } else if (arg === '--keys' && next) {
      options.keys = next.split(',').map((key) => key.trim()).filter(Boolean);
      i += 1;
    } else if (arg === '--width' && next) {
      options.width = Number(next);
      i += 1;
    } else if (arg === '--height' && next) {
      options.height = Number(next);
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node tools/visual/game-shot.mjs [--out <png>] [--seconds <n>] [--keys A,B] [--width <px>] [--height <px>]',
      );
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${arg}`);
    }
  }
  for (const key of options.keys) {
    if (!(key in KEY_CODES)) throw new Error(`unsupported key: ${key}`);
  }
  return options;
}

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
      // next candidate
    }
  }
  throw new Error('no Chrome/Chromium executable available for the game screenshot harness');
}

function mimeType(path) {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.json')) return 'application/json; charset=utf-8';
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
      // Chrome still starting
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

async function main() {
  const options = parseArgs(process.argv);
  const { server, port } = await startStaticServer();
  const chromePath = await findChrome();
  const userDataDir = await mkdtemp(join(tmpdir(), 'clay-kart-game-shot-'));

  const child = spawn(
    chromePath,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-extensions',
      '--disable-background-networking',
      // 同 render-components.mjs：沒有 GPU 也拍得出來，且跨機器一致。
      '--use-gl=angle',
      '--use-angle=swiftshader',
      `--window-size=${options.width},${options.height}`,
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
      width: options.width,
      height: options.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await session.call('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });

    // 等 canvas 真的出現，再開始按鍵與計時。
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const probe = await session.call('Runtime.evaluate', {
        expression: 'Boolean(document.querySelector("#app canvas"))',
        returnByValue: true,
      });
      if (probe?.result?.value === true) {
        ready = true;
        break;
      }
      await sleep(100);
    }
    if (!ready) throw new Error('game never mounted a canvas');

    for (const key of options.keys) {
      await session.call('Input.dispatchKeyEvent', {
        type: 'keyDown',
        code: key,
        key,
        windowsVirtualKeyCode: KEY_CODES[key],
        nativeVirtualKeyCode: KEY_CODES[key],
      });
    }

    await sleep(options.seconds * 1000);

    const shot = await session.call('Page.captureScreenshot', { format: 'png' });
    if (session.pageErrors.length > 0) {
      throw new Error(`page reported errors:\n  ${session.pageErrors.join('\n  ')}`);
    }
    await mkdir(dirname(options.out), { recursive: true });
    await writeFile(options.out, Buffer.from(shot.data, 'base64'));

    const state = await session.call('Runtime.evaluate', {
      expression: 'document.querySelector("#app div")?.textContent ?? ""',
      returnByValue: true,
    });
    console.log(
      JSON.stringify(
        { ok: true, out: options.out, seconds: options.seconds, keys: options.keys, hud: state?.result?.value ?? '' },
        null,
        2,
      ),
    );
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
