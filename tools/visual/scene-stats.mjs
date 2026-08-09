#!/usr/bin/env node
/**
 * 場景靜態量測（R30／R33 Cursor）：增減場景物件後回報用的便宜探針。
 *
 * 載頁 → 等幾幀 → 讀每幀 WebGL draw call / 三角形峰值。
 * **不跑圈、不節流、不量 fps／heap**——目標數秒內結束。
 *
 * R33 任務零：攔 `drawElementsInstanced`／`drawArraysInstanced`
 * （三角形 = count/3 × primCount）。InstancedMesh 以前對量測是隱形的。
 *
 * R33 任務一：相對 committed baseline 報漂移；超門檻非零退出。
 * §5.3／§5.4 預算超標仍只回報不修（修法在視覺端）。
 *
 * Usage:
 *   npm run build && node tools/visual/scene-stats.mjs
 *   npm run build && node tools/visual/scene-stats.mjs --update-baseline
 *   npm run scene-stats
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const BUILD_ROOT = resolve(REPO_ROOT, 'build/out');
const BASELINE_PATH = resolve(HERE, 'scene-stats.baseline.json');

/** §5.3／§5.4 預算——只印在報告裡，不據此 fail。 */
const DRAW_CALLS_BUDGET = 150;
const TRIANGLES_K_BUDGET = 400;

/**
 * 漂移門檻（相對 baseline；超了非零退出）。
 *
 * - draw_calls ±5：絕對值小，±5 能抓住 R33 那種 +6～+8 靜靜漂，
 *   又容忍 SwiftShader 偶發多一兩次 ensure／warmup draw。
 * - triangles_k ±10%：補攔 instanced 後基線在千級；絕對門檻難定，
 *   相對 10% 對應「加了一大塊幾何」而不是幀間抖動。
 */
const DRIFT_DRAW_CALLS_ABS = 5;
const DRIFT_TRIANGLES_K_REL = 0.1;

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

function parseArgs(argv) {
  return {
    updateBaseline: argv.includes('--update-baseline'),
  };
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

/**
 * 最小 WebGL 計數——draw_calls／triangles，含 instanced。
 * 並按 method／framebuffer／viewport 分組，解釋陰影 pass 倍率。
 */
function sceneProbeScript() {
  return `(() => {
  const state = {
    frameIndex: 0,
    frameDrawCalls: new Map(),
    frameTriangles: new Map(),
    frameBreakdown: new Map(),
    glFrames: new Set(),
    framebufferIds: new Map(),
    nextFramebufferId: 0,
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
  const modeName = (gl, mode) => ({
    [gl.POINTS]: 'POINTS',
    [gl.LINES]: 'LINES',
    [gl.LINE_LOOP]: 'LINE_LOOP',
    [gl.LINE_STRIP]: 'LINE_STRIP',
    [gl.TRIANGLES]: 'TRIANGLES',
    [gl.TRIANGLE_STRIP]: 'TRIANGLE_STRIP',
    [gl.TRIANGLE_FAN]: 'TRIANGLE_FAN',
  }[mode] ?? ('mode_' + mode));
  const framebufferName = (gl) => {
    try {
      const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      if (!framebuffer) return 'default';
      let id = state.framebufferIds.get(framebuffer);
      if (!id) {
        id = state.nextFramebufferId + 1;
        state.nextFramebufferId = id;
        state.framebufferIds.set(framebuffer, id);
      }
      return 'fbo-' + id;
    } catch {
      return 'unknown';
    }
  };
  const viewportName = (gl) => {
    try {
      return Array.from(gl.getParameter(gl.VIEWPORT) ?? []).join('x');
    } catch {
      return 'unknown';
    }
  };
  const bump = (gl, method, mode, count, instanceCount) => {
    const instances = Math.max(1, Number(instanceCount) || 1);
    const indexCount = Math.max(0, Number(count) || 0);
    const triangles = mode === gl.TRIANGLES ? (indexCount / 3) * instances : 0;
    const i = state.frameIndex;
    state.glFrames.add(i);
    state.frameDrawCalls.set(i, (state.frameDrawCalls.get(i) ?? 0) + 1);
    state.frameTriangles.set(i, (state.frameTriangles.get(i) ?? 0) + triangles);
    const modeLabel = modeName(gl, mode);
    const framebuffer = framebufferName(gl);
    const viewport = viewportName(gl);
    const key = [i, method, modeLabel, framebuffer, viewport].join('|');
    const existing = state.frameBreakdown.get(key) ?? {
      frame_index: i,
      method,
      mode: modeLabel,
      framebuffer,
      viewport,
      calls: 0,
      instance_count: 0,
      index_count: 0,
      triangles: 0,
    };
    existing.calls += 1;
    existing.instance_count += instances;
    existing.index_count += indexCount;
    existing.triangles += triangles;
    state.frameBreakdown.set(key, existing);
  };
  const patchGl = (prototype) => {
    if (!prototype || prototype.__claySceneStatsPatched) return;
    Object.defineProperty(prototype, '__claySceneStatsPatched', { value: true });
    const originalDrawElements = prototype.drawElements;
    const originalDrawArrays = prototype.drawArrays;
    if (originalDrawElements) {
      prototype.drawElements = function(mode, count, ...args) {
        bump(this, 'drawElements', mode, count, 1);
        return originalDrawElements.call(this, mode, count, ...args);
      };
    }
    if (originalDrawArrays) {
      prototype.drawArrays = function(mode, first, count, ...args) {
        bump(this, 'drawArrays', mode, count, 1);
        return originalDrawArrays.call(this, mode, first, count, ...args);
      };
    }
    // InstancedMesh 走這兩條；舊瀏覽器／WebGL1 可能沒有，取用前先判斷。
    const originalDrawElementsInstanced = prototype.drawElementsInstanced;
    const originalDrawArraysInstanced = prototype.drawArraysInstanced;
    if (originalDrawElementsInstanced) {
      prototype.drawElementsInstanced = function(mode, count, type, offset, instanceCount) {
        bump(this, 'drawElementsInstanced', mode, count, instanceCount);
        return originalDrawElementsInstanced.call(this, mode, count, type, offset, instanceCount);
      };
    }
    if (originalDrawArraysInstanced) {
      prototype.drawArraysInstanced = function(mode, first, count, instanceCount) {
        bump(this, 'drawArraysInstanced', mode, count, instanceCount);
        return originalDrawArraysInstanced.call(this, mode, first, count, instanceCount);
      };
    }
  };
  patchGl(WebGLRenderingContext.prototype);
  if (window.WebGL2RenderingContext) patchGl(WebGL2RenderingContext.prototype);
  window.__CLAY_SCENE_STATS__ = state;
})();`;
}

async function measureScene() {
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
        const draws = state.frameDrawCalls ? [...state.frameDrawCalls.entries()] : [];
        const tris = state.frameTriangles ? [...state.frameTriangles.entries()] : [];
        if (!draws.length || !tris.length) {
          return { error: 'no frames', canvas_count: document.querySelectorAll('canvas').length };
        }
        const peakTri = tris.reduce((best, entry) => (entry[1] > best[1] ? entry : best), tris[0]);
        const peakFrameIndex = peakTri[0];
        const peakBreakdown = [...state.frameBreakdown.values()]
          .filter((entry) => entry.frame_index === peakFrameIndex)
          .sort((a, b) => b.triangles - a.triangles);
        const byMethod = new Map();
        const byFramebuffer = new Map();
        for (const entry of peakBreakdown) {
          const method = byMethod.get(entry.method) ?? { method: entry.method, calls: 0, triangles: 0 };
          method.calls += entry.calls;
          method.triangles += entry.triangles;
          byMethod.set(entry.method, method);
          const fb = byFramebuffer.get(entry.framebuffer) ?? {
            framebuffer: entry.framebuffer,
            calls: 0,
            triangles: 0,
          };
          fb.calls += entry.calls;
          fb.triangles += entry.triangles;
          byFramebuffer.set(entry.framebuffer, fb);
        }
        return {
          canvas_count: document.querySelectorAll('canvas').length,
          sampled_frames: state.glFrames?.size ?? 0,
          draw_calls: Math.max(...draws.map(([, n]) => n)),
          triangles_k: peakTri[1] / 1000,
          peak_frame_index: peakFrameIndex,
          peak_frame_draw_calls: state.frameDrawCalls.get(peakFrameIndex) ?? 0,
          peak_frame_triangles: peakTri[1],
          peak_breakdown_by_method: [...byMethod.values()].sort((a, b) => b.triangles - a.triangles),
          peak_breakdown_by_framebuffer: [...byFramebuffer.values()].sort((a, b) => b.triangles - a.triangles),
          peak_draw_breakdown: peakBreakdown.slice(0, 24),
        };
      })()`,
      returnByValue: true,
    });

    const data = measured?.result?.value;
    if (!data || data.error || data.canvas_count < 1 || data.sampled_frames < 1) {
      throw new Error(`scene-stats measure failed: ${JSON.stringify(data)}`);
    }

    return {
      draw_calls: data.draw_calls,
      triangles_k: Number(data.triangles_k.toFixed(3)),
      sampled_frames: data.sampled_frames,
      peak_frame_index: data.peak_frame_index,
      peak_frame_draw_calls: data.peak_frame_draw_calls,
      peak_frame_triangles: data.peak_frame_triangles,
      peak_breakdown_by_method: data.peak_breakdown_by_method,
      peak_breakdown_by_framebuffer: data.peak_breakdown_by_framebuffer,
      peak_draw_breakdown: data.peak_draw_breakdown,
      elapsed_s: Number(((Date.now() - started) / 1000).toFixed(2)),
    };
  } finally {
    session?.close();
    child.kill('SIGTERM');
    await new Promise((done) => child.once('exit', done));
    await new Promise((done) => server.close(done));
    await rm(userDataDir, { recursive: true, force: true });
  }
}

async function readBaseline() {
  try {
    return JSON.parse(await readFile(BASELINE_PATH, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function compareDrift(measured, baseline) {
  const drawDelta = measured.draw_calls - baseline.draw_calls;
  const triDelta = measured.triangles_k - baseline.triangles_k;
  const triRel =
    baseline.triangles_k === 0
      ? measured.triangles_k === 0
        ? 0
        : Infinity
      : Math.abs(triDelta) / baseline.triangles_k;
  const drawOk = Math.abs(drawDelta) <= DRIFT_DRAW_CALLS_ABS;
  const triOk = triRel <= DRIFT_TRIANGLES_K_REL;
  return {
    baseline: {
      draw_calls: baseline.draw_calls,
      triangles_k: baseline.triangles_k,
      updated: baseline.updated ?? null,
    },
    delta: {
      draw_calls: drawDelta,
      triangles_k: Number(triDelta.toFixed(3)),
      triangles_k_rel: Number((Number.isFinite(triRel) ? triRel : 0).toFixed(4)),
    },
    thresholds: {
      draw_calls_abs: DRIFT_DRAW_CALLS_ABS,
      triangles_k_rel: DRIFT_TRIANGLES_K_REL,
      reason:
        'draw_calls ±5 抓靜靜 +6～+8；triangles_k ±10% 對應千級基線上的幾何成長',
    },
    ok: drawOk && triOk,
    failures: [
      ...(!drawOk
        ? [
            `draw_calls drifted ${drawDelta >= 0 ? '+' : ''}${drawDelta} ` +
              `(measured ${measured.draw_calls}, baseline ${baseline.draw_calls}, ` +
              `threshold ±${DRIFT_DRAW_CALLS_ABS})`,
          ]
        : []),
      ...(!triOk
        ? [
            `triangles_k drifted ${(triRel * 100).toFixed(1)}% ` +
              `(measured ${measured.triangles_k}, baseline ${baseline.triangles_k}, ` +
              `threshold ±${DRIFT_TRIANGLES_K_REL * 100}%)`,
          ]
        : []),
    ],
  };
}

async function main() {
  const { updateBaseline } = parseArgs(process.argv.slice(2));
  const measured = await measureScene();

  const budgets = {
    draw_calls: DRAW_CALLS_BUDGET,
    triangles_k: TRIANGLES_K_BUDGET,
  };
  const over_budget = {
    draw_calls: measured.draw_calls > DRAW_CALLS_BUDGET,
    triangles_k: measured.triangles_k > TRIANGLES_K_BUDGET,
  };

  let drift = null;
  let exitCode = 0;

  if (updateBaseline) {
    const baseline = {
      draw_calls: measured.draw_calls,
      triangles_k: measured.triangles_k,
      updated: new Date().toISOString(),
      note:
        'Committed baseline for scene-stats drift gate. Update only with --update-baseline after intentional scene growth.',
      thresholds: {
        draw_calls_abs: DRIFT_DRAW_CALLS_ABS,
        triangles_k_rel: DRIFT_TRIANGLES_K_REL,
      },
      peak_breakdown_by_method: measured.peak_breakdown_by_method,
      peak_breakdown_by_framebuffer: measured.peak_breakdown_by_framebuffer,
    };
    await writeFile(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
    drift = {
      ok: true,
      updated_baseline: true,
      path: 'tools/visual/scene-stats.baseline.json',
      baseline: {
        draw_calls: baseline.draw_calls,
        triangles_k: baseline.triangles_k,
        updated: baseline.updated,
      },
      thresholds: baseline.thresholds,
      failures: [],
    };
  } else {
    const baseline = await readBaseline();
    if (!baseline) {
      drift = {
        ok: false,
        updated_baseline: false,
        failures: [
          `missing baseline at ${BASELINE_PATH}; run with --update-baseline after measuring`,
        ],
      };
      exitCode = 1;
    } else {
      drift = { updated_baseline: false, ...compareDrift(measured, baseline) };
      if (!drift.ok) exitCode = 1;
    }
  }

  const report = {
    ok: exitCode === 0,
    mode: 'scene-only',
    draw_calls: measured.draw_calls,
    triangles_k: measured.triangles_k,
    budgets,
    over_budget,
    drift,
    peak_frame_index: measured.peak_frame_index,
    peak_frame_draw_calls: measured.peak_frame_draw_calls,
    peak_frame_triangles: measured.peak_frame_triangles,
    peak_breakdown_by_method: measured.peak_breakdown_by_method,
    peak_breakdown_by_framebuffer: measured.peak_breakdown_by_framebuffer,
    peak_draw_breakdown: measured.peak_draw_breakdown,
    sampled_frames: measured.sampled_frames,
    elapsed_s: measured.elapsed_s,
    note:
      '預算超標只回報不修（§5.3 在視覺端）。漂移超門檻非零退出；場景真長大了用 --update-baseline。',
  };
  console.log(JSON.stringify(report, null, 2));

  if (over_budget.draw_calls || over_budget.triangles_k) {
    console.error(
      `\nscene-stats: OVER BUDGET (reporting only) draw_calls=${report.draw_calls}/${DRAW_CALLS_BUDGET} ` +
        `triangles_k=${report.triangles_k}/${TRIANGLES_K_BUDGET}`,
    );
  } else {
    console.error('\nscene-stats: within §5.3/§5.4 budgets');
  }

  if (drift?.updated_baseline) {
    console.error(
      `scene-stats: baseline updated → draw_calls=${measured.draw_calls} triangles_k=${measured.triangles_k}`,
    );
  } else if (drift?.ok) {
    console.error(
      `scene-stats drift: PASS (Δdraw=${drift.delta.draw_calls}, ` +
        `Δtri_k=${drift.delta.triangles_k}, rel=${(drift.delta.triangles_k_rel * 100).toFixed(2)}%)`,
    );
  } else {
    console.error(`\nscene-stats drift: FAIL\n${(drift?.failures ?? []).map((f) => `  - ${f}`).join('\n')}`);
  }

  process.exit(exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
