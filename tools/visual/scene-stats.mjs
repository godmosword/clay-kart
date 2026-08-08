#!/usr/bin/env node
/**
 * 場景靜態量測（R30 Cursor）：增減場景物件後回報用的便宜探針。
 *
 * 載頁 → 等幾幀 → 讀每幀 WebGL draw call / 三角形峰值。
 * **不跑圈、不節流、不量 fps／heap**——目標數秒內結束。
 * 超標只回報數字，exit 0（修法在視覺端，見 BAR-PERF §5.3／BACKLOG）。
 *
 * Usage:
 *   npm run build && node tools/visual/scene-stats.mjs
 *   npm run scene-stats
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
/** §5.3 預算——只印在報告裡，不據此 fail。 */
const DRAW_CALLS_BUDGET = 150;
const TRIANGLES_K_BUDGET = 400;

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
  throw new Error('no Chrome/Chromium for scene-stats');
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

/** 最小 WebGL 計數——只為 draw_calls／triangles，不做 texture／heap。 */
function sceneProbeScript() {
  return `(() => {
  const state = {
    frameIndex: 0,
    frameDrawCalls: new Map(),
    frameTriangles: new Map(),
    glFrames: new Set(),
  };
  const originalRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => originalRaf((ts) => {
    state.frameIndex += 1;
    try {
      return callback(ts);
    } finally {
      // frame closed
    }
  });
  const patchGl = (prototype) => {
    if (!prototype || prototype.__claySceneStatsPatched) return;
    Object.defineProperty(prototype, '__claySceneStatsPatched', { value: true });
    const originalDrawElements = prototype.drawElements;
    const originalDrawArrays = prototype.drawArrays;
    const bump = (gl, mode, count) => {
      const i = state.frameIndex;
      state.glFrames.add(i);
      state.frameDrawCalls.set(i, (state.frameDrawCalls.get(i) ?? 0) + 1);
      if (mode === gl.TRIANGLES) {
        state.frameTriangles.set(i, (state.frameTriangles.get(i) ?? 0) + count / 3);
      }
    };
    prototype.drawElements = function(mode, count, ...args) {
      bump(this, mode, count);
      return originalDrawElements.call(this, mode, count, ...args);
    };
    prototype.drawArrays = function(mode, first, count, ...args) {
      bump(this, mode, count);
      return originalDrawArrays.call(this, mode, first, count, ...args);
    };
  };
  patchGl(WebGLRenderingContext.prototype);
  if (window.WebGL2RenderingContext) patchGl(WebGL2RenderingContext.prototype);
  window.__CLAY_SCENE_STATS__ = state;
})();`;
}

async function main() {
  const started = Date.now();
  const { server, port } = await startStaticServer();
  const chromePath = await findChrome();
  const userDataDir = await mkdtemp(join(tmpdir(), 'clay-kart-scene-stats-'));
  const child = spawn(
    chromePath,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-extensions',
      '--disable-background-networking',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--window-size=800,600',
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
    await session.call('Page.addScriptToEvaluateOnNewDocument', { source: sceneProbeScript() });
    await session.call('Emulation.setDeviceMetricsOverride', {
      width: 800,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await session.call('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });

    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const probe = await session.call('Runtime.evaluate', {
        expression: 'Boolean(document.querySelector("#app canvas"))',
        returnByValue: true,
      });
      if (probe?.result?.value === true) {
        ready = true;
        break;
      }
      await sleep(50);
    }
    if (!ready) throw new Error('canvas never mounted');

    // 等幾幀把 AI 車 ensure 進來
    await sleep(1500);

    const measured = await session.call('Runtime.evaluate', {
      expression: `(() => {
        const state = window.__CLAY_SCENE_STATS__;
        if (!state) return { error: 'missing __CLAY_SCENE_STATS__' };
        const draws = state.frameDrawCalls ? [...state.frameDrawCalls.values()] : [];
        const tris = state.frameTriangles ? [...state.frameTriangles.values()] : [];
        return {
          canvas_count: document.querySelectorAll('canvas').length,
          sampled_frames: state.glFrames?.size ?? 0,
          draw_calls: draws.length ? Math.max(...draws) : 0,
          triangles_k: tris.length ? Math.max(...tris) / 1000 : 0,
        };
      })()`,
      returnByValue: true,
    });

    const data = measured?.result?.value;
    if (!data || data.error || data.canvas_count < 1 || data.sampled_frames < 1) {
      throw new Error(`scene-stats measure failed: ${JSON.stringify(data)}`);
    }

    const elapsed_s = (Date.now() - started) / 1000;
    const report = {
      ok: true,
      mode: 'scene-only',
      draw_calls: data.draw_calls,
      triangles_k: Number(data.triangles_k.toFixed(3)),
      budgets: {
        draw_calls: DRAW_CALLS_BUDGET,
        triangles_k: TRIANGLES_K_BUDGET,
      },
      over_budget: {
        draw_calls: data.draw_calls > DRAW_CALLS_BUDGET,
        triangles_k: data.triangles_k > TRIANGLES_K_BUDGET,
      },
      sampled_frames: data.sampled_frames,
      elapsed_s: Number(elapsed_s.toFixed(2)),
      note:
        '超標只回報不修（§5.3 在視覺端）。增減場景物件的 Cursor 回報必須附 draw_calls 與 triangles_k。',
    };
    console.log(JSON.stringify(report, null, 2));
    if (report.over_budget.draw_calls || report.over_budget.triangles_k) {
      console.error(
        `\nscene-stats: OVER BUDGET (reporting only) draw_calls=${report.draw_calls}/${DRAW_CALLS_BUDGET} ` +
          `triangles_k=${report.triangles_k}/${TRIANGLES_K_BUDGET}`,
      );
    } else {
      console.error('\nscene-stats: within §5.3/§5.4 budgets');
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
