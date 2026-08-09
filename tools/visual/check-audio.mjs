#!/usr/bin/env node

/**
 * `BAR-CONTENT §2.3`／`§2.4` 的機械檢查。
 *
 * §2.3  有音效——`AudioContext` 真的在跑
 * §2.4  引擎聲隨速度變化——兩個不同速度取樣點的頻率不相同
 *
 * ## 這支檢查必須能失敗
 *
 * `BAR-CONTENT.md §0` 的重點就是「其餘四份 bar 沒有一項會因為東西不存在
 * 而失敗」。如果這支檢查本身也不會紅，那整個修正是白做的。
 *
 * **證偽驗證方式**：把 `src/render/renderer.ts` 裡的 `this.#audio.update(snap)`
 * 註解掉，這支必須報 `§2.4 FAIL`（引擎頻率不隨速度變）；
 * 把 `createClayAudio()` 換成 no-op 版本，必須報 `§2.3 FAIL`。
 *
 * ## 為什麼用真實瀏覽器
 *
 * Web Audio 在 Node 裡不存在。跟 `perf-probe.mjs` 一樣走 raw CDP，
 * 不新增 npm 依賴。**`--autoplay-policy=no-user-gesture-required` 是必要的**
 * ——headless 沒有使用者互動，`AudioContext` 會一直停在 suspended。
 *
 * Usage:
 *   node tools/visual/check-audio.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const BUILD_DIR = join(REPO_ROOT, 'build/out');

/** 兩個取樣點的目標速度比例。差距要夠大，否則平滑會讓兩者幾乎相同。 */
const SLOW_RATIO = 0.05;
const FAST_RATIO = 0.9;

/** 兩個取樣點的頻率至少要差這麼多 Hz 才算「隨速度變化」。 */
const MIN_HZ_DELTA = 20;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.map': 'application/json',
};

async function startServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = join(BUILD_DIR, rel);
    if (!file.startsWith(BUILD_DIR)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { server, port: server.address().port };
}

async function findChrome() {
  for (const c of [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
  ].filter(Boolean)) {
    try { await access(c); return c; } catch { /* next */ }
  }
  throw new Error('no Chrome for check-audio');
}

class Cdp {
  #ws; #id = 0; #pending = new Map();
  constructor(url) { this.url = url; }
  async connect() {
    const { WebSocket } = await import('node:worker_threads').then(() => globalThis);
    this.#ws = new WebSocket(this.url);
    await new Promise((ok, no) => { this.#ws.onopen = ok; this.#ws.onerror = no; });
    this.#ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      const p = this.#pending.get(msg.id);
      if (p) { this.#pending.delete(msg.id); msg.error ? p.no(new Error(JSON.stringify(msg.error))) : p.ok(msg.result); }
    };
  }
  call(method, params = {}) {
    const id = ++this.#id;
    this.#ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, no) => this.#pending.set(id, { ok, no }));
  }
  async evaluate(expression) {
    const r = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r?.result?.value;
  }
  close() { this.#ws?.close(); }
}

async function waitForPort(child) {
  let out = '';
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const chunk = await new Promise((ok) => {
      const t = setTimeout(() => ok(''), 300);
      child.stderr.once('data', (d) => { clearTimeout(t); ok(String(d)); });
    });
    out += chunk;
    const m = out.match(/ws:\/\/127\.0\.0\.1:(\d+)/);
    if (m) return Number(m[1]);
  }
  throw new Error(`Chrome exposed no CDP port:\n${out.slice(-400)}`);
}

async function main() {
  const { server, port } = await startServer();
  const chrome = await findChrome();
  const userDataDir = await mkdtemp(join(tmpdir(), 'clay-audio-'));
  const child = spawn(chrome, [
    '--headless=new', '--no-sandbox', '--disable-extensions',
    // 沒有這個旗標，headless 的 AudioContext 永遠是 suspended，
    // §2.3 會因為環境而不是因為實作 FAIL。
    '--autoplay-policy=no-user-gesture-required',
    '--use-gl=angle', '--use-angle=metal',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const failures = [];
  let session;
  try {
    const debugPort = await waitForPort(child);
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const page = targets.find((t) => t.type === 'page');
    session = new Cdp(page.webSocketDebuggerUrl);
    await session.connect();
    await session.call('Page.enable');
    await session.call('Runtime.enable');
    await session.call('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
    await new Promise((ok) => setTimeout(ok, 3000));

    // 這支檢查讀的是 renderer 曝露的音訊除錯狀態。
    const probe = async (ratio) => session.evaluate(`(() => {
      const a = window.__CLAY_AUDIO__;
      if (!a) return null;
      a.__forceSpeedRatio(${ratio});
      return new Promise((ok) => setTimeout(() => ok(a.debugState()), 400));
    })()`);

    const slow = await probe(SLOW_RATIO);
    const fast = await probe(FAST_RATIO);

    // **§2.4b：走真實輸入，證明音訊真的接在遊戲上。**
    //
    // 第一版只有上面那個 forced-ratio 檢查，而它繞過 `update()` 直接推
    // engine voice——我把 `renderer.ts` 的 `this.#audio.update(snap)` 註解掉，
    // 那一版照樣 PASS。**又一個測不到重點的檢查。**
    //
    // 這一段按住油門讓車真的加速，只讀 `debugState()`，不碰任何測試掛鉤。
    // 音訊若沒接上遊戲，頻率會停在怠速。
    await session.evaluate('window.__CLAY_AUDIO__.__forceSpeedRatio(null)');
    const key = (type, code, keyCode) => session.call('Input.dispatchKeyEvent', {
      type, code, key: 'ArrowUp', windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode,
    });
    const idleHz = (await session.evaluate('window.__CLAY_AUDIO__.debugState()')).engineHz;
    await key('keyDown', 'ArrowUp', 38);
    await new Promise((ok) => setTimeout(ok, 2500));
    const drivingHz = (await session.evaluate('window.__CLAY_AUDIO__.debugState()')).engineHz;
    await key('keyUp', 'ArrowUp', 38);
    const wiredDelta = drivingHz - idleHz;
    if (!(wiredDelta >= MIN_HZ_DELTA)) {
      failures.push(
        `§2.4b 音訊沒有接在遊戲上：按住油門 2.5s，引擎頻率 `
        + `${idleHz.toFixed(1)}Hz → ${drivingHz.toFixed(1)}Hz（只差 ${wiredDelta.toFixed(1)}Hz）。`
        + '檢查 renderer 有沒有每幀呼叫 audio.update(snap)。',
      );
    }
    console.log(JSON.stringify({ idle_hz: +idleHz.toFixed(2), driving_hz: +drivingHz.toFixed(2), wired_delta_hz: +wiredDelta.toFixed(2) }, null, 2));

    if (!slow || !fast) {
      failures.push('§2.3 window.__CLAY_AUDIO__ 不存在——音訊系統沒有接上');
    } else {
      if (!slow.running) {
        failures.push(`§2.3 AudioContext 沒有在跑（state 不是 running）`);
      }
      const delta = Math.abs(fast.engineHz - slow.engineHz);
      if (!(delta >= MIN_HZ_DELTA)) {
        failures.push(
          `§2.4 引擎頻率不隨速度變化：ratio ${SLOW_RATIO} → ${slow.engineHz.toFixed(1)}Hz、`
          + `ratio ${FAST_RATIO} → ${fast.engineHz.toFixed(1)}Hz，差 ${delta.toFixed(1)}Hz`
          + `（至少要 ${MIN_HZ_DELTA}Hz）`,
        );
      }
      console.log(JSON.stringify({
        running: slow.running,
        slow_hz: Number(slow.engineHz.toFixed(2)),
        fast_hz: Number(fast.engineHz.toFixed(2)),
        delta_hz: Number(delta.toFixed(2)),
      }, null, 2));
    }
  } finally {
    session?.close();
    if (child.exitCode === null) child.kill('SIGTERM');
    server.close();
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }

  if (failures.length > 0) {
    console.error('\ncheck-audio: FAIL\n  ' + failures.join('\n  '));
    process.exit(1);
  }
  console.error('\ncheck-audio: PASS (§2.3 音訊在跑、§2.4 引擎聲隨速度變化)');
}

main().catch((e) => { console.error(`check-audio: ${e.message}`); process.exit(1); });
