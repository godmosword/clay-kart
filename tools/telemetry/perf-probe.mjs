#!/usr/bin/env node

/** Real headless-browser performance probe for the built renderer. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildSha,
  readFixture,
  REPO_ROOT,
} from './runtime.mjs';

const fixturePath = process.argv[2] ?? 'fixtures/lap-a.json';
const outputPath = process.argv[3] ?? 'loop/round-16/artifacts/perf-proxy.json';
const device = process.argv[4] ?? 'proxy';
const MEASUREMENT_SECONDS = 5;
const fixture = await readFixture(fixturePath);
const TICK_HZ = 120;
const BUILD_ROOT = resolve(REPO_ROOT, 'build/out');

function percentile(values, percent) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * percent / 100;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
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
      // Try the next known installation path.
    }
  }
  throw new Error('no Chrome/Chromium executable is available for the headless perf probe');
}

function mimeType(path) {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.json')) return 'application/json; charset=utf-8';
  if (path.endsWith('.map')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

async function startStaticServer() {
  await access(join(BUILD_ROOT, 'index.html'));
  const server = createServer(async (request, response) => {
    try {
      const requestPath = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
      const filePath = resolve(BUILD_ROOT, relativePath);
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
  await new Promise((resolveServer, rejectServer) => {
    server.once('error', rejectServer);
    server.listen(0, '127.0.0.1', resolveServer);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to allocate local perf server');
  return { server, port: address.port };
}

async function assetMetrics() {
  const assetDir = resolve(BUILD_ROOT, 'assets');
  let gzBytes = 0;
  let rawBytes = 0;
  for (const file of await readdir(assetDir)) {
    const path = join(assetDir, file);
    const info = await stat(path);
    if (!info.isFile()) continue;
    const bytes = await readFile(path);
    rawBytes += bytes.byteLength;
    if (file.endsWith('.js')) gzBytes += gzipSync(bytes).byteLength;
  }
  return {
    initial_bundle_kb_gz: gzBytes / 1024,
    total_assets_mb: rawBytes / (1024 * 1024),
  };
}

async function waitForDevtoolsPort(child) {
  return new Promise((resolvePort, rejectPort) => {
    let settled = false;
    let output = '';
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      rejectPort(new Error(`Chrome did not expose CDP: ${output.slice(-500)}`));
    }, 10_000);
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
      const match = output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) finish(resolvePort, Number(match[1]));
    });
    child.once('exit', (code) => finish(rejectPort, new Error(`Chrome exited before CDP startup (${code})`)));
  });
}

async function waitForPageTarget(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((target) => target.type === 'page');
      if (page) return page;
    } catch {
      // Chrome is still starting its HTTP endpoint.
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
    await new Promise((resolveOpen, rejectOpen) => {
      this.#socket.addEventListener('open', resolveOpen, { once: true });
      this.#socket.addEventListener('error', rejectOpen, { once: true });
    });
  }

  call(method, params = {}) {
    const id = ++this.#nextId;
    this.#socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveCall, rejectCall) => {
      this.#pending.set(id, { resolve: resolveCall, reject: rejectCall });
    });
  }

  close() {
    this.#socket.close();
  }
}

function browserProbeScript() {
  return String.raw`(() => {
  const state = {
    raf: [],
    glFrames: new Set(),
    frameDrawCalls: new Map(),
    frameTriangles: new Map(),
    glDrawCalls: 0,
    triangles: 0,
    heapSamples: [],
    firstRenderAt: null,
    documentStart: performance.now(),
    measurementStart: performance.now(),
    inputTimers: [],
  };
  state.reset = () => {
    for (const timer of state.inputTimers) clearTimeout(timer);
    state.inputTimers = [];
    state.raf = [];
    state.glFrames = new Set();
    state.frameDrawCalls = new Map();
    state.frameTriangles = new Map();
    state.glDrawCalls = 0;
    state.triangles = 0;
    state.heapSamples = [];
    state.measurementStart = performance.now();
  };
  state.scheduleInput = (segments, tickHz) => {
    const held = new Set();
    const codeFor = (input) => {
      const codes = [];
      if (input.throttle) codes.push('ArrowUp');
      if (input.steer < 0) codes.push('ArrowLeft');
      if (input.steer > 0) codes.push('ArrowRight');
      if (input.brake) codes.push('ArrowDown');
      if (input.reverse) codes.push('ShiftLeft');
      if (input.drift) codes.push('ControlLeft');
      if (input.jump) codes.push('Space');
      return new Set(codes);
    };
    const apply = (input) => {
      const next = codeFor(input);
      for (const code of held) {
        if (next.has(code)) continue;
        window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
        held.delete(code);
      }
      for (const code of next) {
        if (held.has(code)) continue;
        window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
        held.add(code);
      }
    };
    for (const segment of segments) {
      const timer = setTimeout(() => apply(segment.input), segment.start_tick * 1000 / tickHz);
      state.inputTimers.push(timer);
    }
  };
  const originalRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => originalRaf((timestamp) => {
    state.raf.push({ timestamp, now: performance.now() });
    if (performance.memory) state.heapSamples.push(performance.memory.usedJSHeapSize / (1024 * 1024));
    return callback(timestamp);
  });
  const patchGl = (prototype) => {
    if (!prototype || prototype.__r16PerfPatched) return;
    Object.defineProperty(prototype, '__r16PerfPatched', { value: true });
    const originalDrawElements = prototype.drawElements;
    const originalDrawArrays = prototype.drawArrays;
    prototype.drawElements = function(mode, count, ...args) {
      state.glDrawCalls += 1;
      const frame = state.raf.length;
      state.glFrames.add(frame);
      state.frameDrawCalls.set(frame, (state.frameDrawCalls.get(frame) ?? 0) + 1);
      if (state.firstRenderAt === null) state.firstRenderAt = performance.now();
      if (mode === this.TRIANGLES) {
        state.triangles += count / 3;
        state.frameTriangles.set(frame, (state.frameTriangles.get(frame) ?? 0) + count / 3);
      }
      return originalDrawElements.call(this, mode, count, ...args);
    };
    prototype.drawArrays = function(mode, first, count, ...args) {
      state.glDrawCalls += 1;
      const frame = state.raf.length;
      state.glFrames.add(frame);
      state.frameDrawCalls.set(frame, (state.frameDrawCalls.get(frame) ?? 0) + 1);
      if (state.firstRenderAt === null) state.firstRenderAt = performance.now();
      if (mode === this.TRIANGLES) {
        state.triangles += count / 3;
        state.frameTriangles.set(frame, (state.frameTriangles.get(frame) ?? 0) + count / 3);
      }
      return originalDrawArrays.call(this, mode, first, count, ...args);
    };
  };
  patchGl(WebGLRenderingContext.prototype);
  patchGl(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
  window.__R16_PERF__ = state;
  state.reset();
})();`;
}

function fixtureSegmentsForWindow() {
  const maxTick = Math.ceil(MEASUREMENT_SECONDS * TICK_HZ) + 1;
  return fixture.input_segments
    .filter((segment) => segment.start_tick <= maxTick)
    .map((segment) => ({ ...segment, end_tick: Math.min(segment.end_tick, maxTick) }))
    .filter((segment) => segment.end_tick > segment.start_tick);
}

async function measureBrowser() {
  const chromePath = await findChrome();
  const { server, port: serverPort } = await startStaticServer();
  const userDataDir = await mkdtemp(join(tmpdir(), 'clay-kart-r16-chrome-'));
  const child = spawn(chromePath, [
    '--headless=new',
    '--no-sandbox',
    '--disable-extensions',
    '--disable-background-networking',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let session = null;
  try {
    const debugPort = await waitForDevtoolsPort(child);
    const page = await waitForPageTarget(debugPort);
    session = new CdpSession(page.webSocketDebuggerUrl);
    await session.connect();
    await session.call('Page.enable');
    await session.call('Runtime.enable');
    await session.call('Page.addScriptToEvaluateOnNewDocument', { source: browserProbeScript() });
    await session.call('Emulation.setDeviceMetricsOverride', {
      width: 800,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await session.call('Page.navigate', { url: `http://127.0.0.1:${serverPort}/index.html` });
    await sleep(1500);
    const segments = fixtureSegmentsForWindow();
    await session.call('Runtime.evaluate', {
      expression: `window.__R16_PERF__?.reset(); window.__R16_PERF__?.scheduleInput(${JSON.stringify(segments)}, ${TICK_HZ});`,
      returnByValue: true,
    });
    await sleep(MEASUREMENT_SECONDS * 1000 + 100);
    const result = await session.call('Runtime.evaluate', {
      expression: `(() => {
        const state = window.__R16_PERF__;
        const raf = state?.raf ?? [];
        const first = raf[0]?.now ?? state?.measurementStart ?? 0;
        const last = raf.at(-1)?.now ?? first;
        const elapsed = Math.max(0, last - (state?.measurementStart ?? first)) / 1000;
        const renderedFrames = state?.glFrames?.size ?? 0;
        const frameIntervals = raf.slice(1).map((entry, index) => entry.now - raf[index].now);
        const fps = frameIntervals.filter((ms) => ms > 0).map((ms) => 1000 / ms);
        const percentile = (values, percent) => {
          if (!values.length) return 0;
          const sorted = [...values].sort((a, b) => a - b);
          const index = (sorted.length - 1) * percent / 100;
          const lower = Math.floor(index), upper = Math.ceil(index);
          return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
        };
        const renderedHz = elapsed > 0 ? renderedFrames / elapsed : 0;
        const navigation = performance.getEntriesByType('navigation')[0];
        const heap = state?.heapSamples ?? [];
        const drawCallsPerFrame = state?.frameDrawCalls ? [...state.frameDrawCalls.values()] : [];
        const trianglesPerFrame = state?.frameTriangles ? [...state.frameTriangles.values()] : [];
        return {
          canvas_count: document.querySelectorAll('canvas').length,
          raf_callbacks: raf.length,
          rendered_frames: renderedFrames,
          gl_draw_calls: state?.glDrawCalls ?? 0,
          triangles: state?.triangles ?? 0,
          elapsed_s: elapsed,
          fps_p50: percentile(fps, 50),
          fps_p05: percentile(fps, 5),
          frame_time_p99_ms: percentile(frameIntervals, 99),
          long_frame_count: frameIntervals.filter((ms) => ms > 33).length,
          vehicle_transform_hz: renderedHz,
          camera_hz: renderedHz,
          character_anim_hz: null,
          character_anim_status: 'not_applicable_no_character_animation',
          first_interactive_s: navigation?.domContentLoadedEventEnd ? navigation.domContentLoadedEventEnd / 1000 : null,
          time_to_first_render_s: state?.firstRenderAt === null ? null : (state.firstRenderAt - state.documentStart) / 1000,
          heap_peak_mb: heap.length ? Math.max(...heap) : null,
          heap_growth_per_lap_mb: heap.length > 1 ? Math.max(0, heap.at(-1) - heap[0]) : null,
          draw_calls: drawCallsPerFrame.length ? Math.max(...drawCallsPerFrame) : 0,
          triangles_k: trianglesPerFrame.length ? Math.max(...trianglesPerFrame) / 1000 : 0,
          gc_pause_max_ms: null,
          texture_memory_mb: null,
        };
      })()`,
      returnByValue: true,
    });
    const measured = result?.result?.value;
    if (!measured || measured.canvas_count < 1 || measured.rendered_frames < 1) {
      throw new Error(`headless renderer produced no measurable WebGL frames: ${JSON.stringify(measured)}`);
    }
    return measured;
  } finally {
    session?.close();
    child.kill('SIGTERM');
    await new Promise((resolveExit) => child.once('exit', resolveExit));
    await new Promise((resolveServer) => server.close(resolveServer));
    await rm(userDataDir, { recursive: true, force: true });
  }
}

const measured = await measureBrowser();
const assets = await assetMetrics();
const report = {
  meta: {
    fixture: fixture.fixture,
    tick_hz: TICK_HZ,
    total_ticks: fixture.ticks,
    measurement_seconds: MEASUREMENT_SECONDS,
    build_sha: buildSha(),
    seed: fixture.seed,
    device,
    device_note: 'Chrome headless ANGLE/SwiftShader proxy; not a real iPad/Android measurement',
    measurement_method: 'External requestAnimationFrame and WebGL draw instrumentation. renderer.draw updates vehicle transforms and camera before each observed WebGL frame.',
    character_animation: 'not_applicable_no_character_animation',
  },
  metrics: {
    ...measured,
    ...assets,
  },
};

const output = resolve(outputPath);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(`perf-probe: headless ${device} -> ${output}`);
