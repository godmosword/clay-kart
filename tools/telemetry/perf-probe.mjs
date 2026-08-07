#!/usr/bin/env node

/** Real headless-browser performance probe for the built renderer. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { arch, cpus, hostname, platform, release, totalmem } from 'node:os';
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
const environment = process.argv[5] ?? process.env.PERF_ENV ?? 'local';
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
  #eventWaiters = new Map();

  constructor(url) {
    this.#socket = new WebSocket(url);
    this.#socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const pending = this.#pending.get(message.id);
        if (!pending) return;
        this.#pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
        return;
      }
      const waiters = this.#eventWaiters.get(message.method);
      if (!waiters) return;
      this.#eventWaiters.delete(message.method);
      for (const resolveEvent of waiters) resolveEvent(message.params ?? {});
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

  waitForEvent(method) {
    return new Promise((resolveEvent) => {
      const waiters = this.#eventWaiters.get(method) ?? [];
      waiters.push(resolveEvent);
      this.#eventWaiters.set(method, waiters);
    });
  }

  close() {
    this.#socket.close();
  }
}

async function readTracingStream(session, stream) {
  let trace = '';
  try {
    let eof = false;
    while (!eof) {
      const chunk = await session.call('IO.read', { handle: stream });
      trace += chunk.data ?? '';
      eof = chunk.eof === true;
    }
  } finally {
    await session.call('IO.close', { handle: stream }).catch(() => {});
  }
  return trace;
}

function traceEvents(traceText) {
  let trace;
  try {
    trace = JSON.parse(traceText);
  } catch {
    return [];
  }
  return Array.isArray(trace?.traceEvents) ? trace.traceEvents : [];
}

function gcTraceEvents(events) {
  return events
    .filter((event) => typeof event?.name === 'string' && /gc|garbage/i.test(event.name))
    .map((event) => ({
      name: event.name,
      startMs: Number(event.ts) / 1000,
      durationMs: Number(event.dur) / 1000,
    }))
    .filter((event) => Number.isFinite(event.startMs) && Number.isFinite(event.durationMs) && event.durationMs > 0);
}

function gcPauseMaxMs(gcEvents) {
  return gcEvents.reduce(
    (maximum, event) => Math.max(maximum, event.durationMs),
    0,
  );
}

function unionOverlapMs(intervals, startMs, endMs) {
  const clipped = intervals
    .map((interval) => ({
      startMs: Math.max(startMs, interval.startMs),
      endMs: Math.min(endMs, interval.startMs + interval.durationMs),
    }))
    .filter((interval) => interval.endMs > interval.startMs)
    .sort((left, right) => left.startMs - right.startMs);
  let total = 0;
  let current = null;
  for (const interval of clipped) {
    if (!current) {
      current = interval;
      continue;
    }
    if (interval.startMs > current.endMs) {
      total += current.endMs - current.startMs;
      current = interval;
    } else {
      current.endMs = Math.max(current.endMs, interval.endMs);
    }
  }
  if (current) total += current.endMs - current.startMs;
  return total;
}

function traceEventName(event) {
  return event?.name === '__r16_trace_anchor__'
    || event?.args?.name === '__r16_trace_anchor__'
    || event?.args?.data?.name === '__r16_trace_anchor__';
}

function traceAnchorMs(events) {
  const anchor = events.find(traceEventName);
  const timestampMs = Number(anchor?.ts) / 1000;
  return Number.isFinite(timestampMs) ? timestampMs : null;
}

function environmentMetadata(chromePath) {
  const cpu = cpus()[0];
  return {
    name: environment,
    hostname: hostname(),
    platform: `${platform()} ${release()}`,
    arch: arch(),
    node_version: process.version,
    cpu_model: cpu?.model ?? null,
    cpu_count: cpus().length,
    memory_total_mb: totalmem() / (1024 * 1024),
    chrome_path: chromePath,
    containerized: environment === 'container',
  };
}

function browserProbeScript() {
  return String.raw`(() => {
  const state = {
    raf: [],
    activeFrame: null,
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
    textureBytes: 0,
    textureContexts: new Map(),
    renderTelemetryStart: null,
  };
  state.reset = () => {
    for (const timer of state.inputTimers) clearTimeout(timer);
    state.inputTimers = [];
    state.raf = [];
    state.activeFrame = null;
    state.glFrames = new Set();
    state.frameDrawCalls = new Map();
    state.frameTriangles = new Map();
    state.glDrawCalls = 0;
    state.triangles = 0;
    state.heapSamples = [];
    state.measurementStart = performance.now();
    const telemetry = window.__CLAY_RENDER_TELEMETRY__;
    state.renderTelemetryStart = telemetry && Number.isFinite(telemetry.renderedFrames)
      && Number.isFinite(telemetry.vehicleTransformUpdates)
      && Number.isFinite(telemetry.cameraUpdates)
      && Number.isFinite(telemetry.characterAnimationFrames)
      ? {
        renderedFrames: telemetry.renderedFrames,
        vehicleTransformUpdates: telemetry.vehicleTransformUpdates,
        cameraUpdates: telemetry.cameraUpdates,
        characterAnimationFrames: telemetry.characterAnimationFrames,
      }
      : null;
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
    const frame = {
      index: state.raf.length,
      timestamp,
      start: performance.now(),
      drawMs: 0,
      callbackEnd: null,
      scriptMs: 0,
    };
    state.raf.push({ timestamp, now: frame.start, frame });
    if (performance.memory) state.heapSamples.push(performance.memory.usedJSHeapSize / (1024 * 1024));
    state.activeFrame = frame;
    try {
      return callback(timestamp);
    } finally {
      frame.callbackEnd = performance.now();
      frame.scriptMs = Math.max(0, frame.callbackEnd - frame.start - frame.drawMs);
      state.activeFrame = null;
    }
  });
  const patchGl = (prototype) => {
    if (!prototype || prototype.__r16PerfPatched) return;
    Object.defineProperty(prototype, '__r16PerfPatched', { value: true });
    const originalDrawElements = prototype.drawElements;
    const originalDrawArrays = prototype.drawArrays;
    const originalBindTexture = prototype.bindTexture;
    const originalDeleteTexture = prototype.deleteTexture;
    const originalTexImage2D = prototype.texImage2D;
    const originalTexStorage2D = prototype.texStorage2D;
    const originalCompressedTexImage2D = prototype.compressedTexImage2D;
    const originalGenerateMipmap = prototype.generateMipmap;

    const contextState = (gl) => {
      let context = state.textureContexts.get(gl);
      if (!context) {
        context = { bound: new Map(), textures: new Map() };
        state.textureContexts.set(gl, context);
      }
      return context;
    };
    const textureTarget = (gl, target) => (
      target >= gl.TEXTURE_CUBE_MAP_POSITIVE_X && target <= gl.TEXTURE_CUBE_MAP_NEGATIVE_Z
        ? gl.TEXTURE_CUBE_MAP
        : target
    );
    const bytesPerPixel = (gl, format, type) => {
      const channels = format === gl.RGBA ? 4
        : format === gl.RGB ? 3
          : format === gl.RG ? 2
            : format === gl.RED || format === gl.ALPHA || format === gl.LUMINANCE ? 1
              : format === gl.LUMINANCE_ALPHA ? 2 : 4;
      const bytes = type === gl.FLOAT || type === gl.UNSIGNED_INT || type === gl.INT ? 4
        : type === gl.HALF_FLOAT || type === gl.HALF_FLOAT_OES || type === gl.UNSIGNED_SHORT || type === gl.SHORT ? 2
          : 1;
      return channels * bytes;
    };
    const textureRecord = (context, texture) => {
      let record = context.textures.get(texture);
      if (!record) {
        record = { levels: new Map() };
        context.textures.set(texture, record);
      }
      return record;
    };
    const replaceLevel = (gl, target, level, bytes, width, height, bpp) => {
      const context = contextState(gl);
      const texture = context.bound.get(textureTarget(gl, target));
      if (!texture) return;
      const record = textureRecord(context, texture);
      const previous = record.levels.get(level)?.bytes ?? 0;
      record.levels.set(level, { bytes, width, height, bpp });
      state.textureBytes += bytes - previous;
    };
    const deleteRecord = (gl, texture) => {
      if (!texture) return;
      const context = contextState(gl);
      const record = context.textures.get(texture);
      if (!record) return;
      for (const level of record.levels.values()) state.textureBytes -= level.bytes;
      context.textures.delete(texture);
    };
    const sourceDimension = (source, key) => Number(
      source?.[key] ?? source?.[key === 'width' ? 'videoWidth' : 'videoHeight'] ?? 0,
    );

    prototype.bindTexture = function(target, texture) {
      const result = originalBindTexture.call(this, target, texture);
      contextState(this).bound.set(target, texture);
      return result;
    };
    prototype.deleteTexture = function(texture) {
      deleteRecord(this, texture);
      return originalDeleteTexture.call(this, texture);
    };
    if (originalTexImage2D) {
      prototype.texImage2D = function(...args) {
        const target = args[0];
        const level = Number(args[1]);
        let width;
        let height;
        let format;
        let type;
        if (args.length >= 9) {
          width = Number(args[3]);
          height = Number(args[4]);
          format = args[6];
          type = args[7];
        } else {
          const source = args[5];
          width = sourceDimension(source, 'width');
          height = sourceDimension(source, 'height');
          format = args[3];
          type = args[4];
        }
        const result = originalTexImage2D.apply(this, args);
        if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
          replaceLevel(this, target, level, width * height * bytesPerPixel(this, format, type), width, height, bytesPerPixel(this, format, type));
        }
        return result;
      };
    }
    if (originalTexStorage2D) {
      prototype.texStorage2D = function(target, levels, internalFormat, width, height) {
        const result = originalTexStorage2D.call(this, target, levels, internalFormat, width, height);
        const bpp = internalFormat === this.RGBA8 || internalFormat === this.RGBA16F || internalFormat === this.RGBA32F ? 4
          : internalFormat === this.RGB8 || internalFormat === this.RGB565 ? 3 : 1;
        for (let level = 0; level < levels; level += 1) {
          const levelWidth = Math.max(1, width >> level);
          const levelHeight = Math.max(1, height >> level);
          replaceLevel(this, target, level, levelWidth * levelHeight * bpp, levelWidth, levelHeight, bpp);
        }
        return result;
      };
    }
    if (originalCompressedTexImage2D) {
      prototype.compressedTexImage2D = function(...args) {
        const target = args[0];
        const level = Number(args[1]);
        const width = Number(args[3]);
        const height = Number(args[4]);
        const data = args[6];
        const result = originalCompressedTexImage2D.apply(this, args);
        const bytes = Number(data?.byteLength ?? 0);
        if (bytes > 0) replaceLevel(this, target, level, bytes, width, height, 0);
        return result;
      };
    }
    if (originalGenerateMipmap) {
      prototype.generateMipmap = function(target) {
        const result = originalGenerateMipmap.call(this, target);
        const context = contextState(this);
        const texture = context.bound.get(textureTarget(this, target));
        const base = texture ? context.textures.get(texture)?.levels.get(0) : null;
        if (base && base.bpp > 0) {
          for (let level = 1, width = base.width, height = base.height; width > 1 || height > 1; level += 1) {
            width = Math.max(1, width >> 1);
            height = Math.max(1, height >> 1);
            replaceLevel(this, target, level, width * height * base.bpp, width, height, base.bpp);
          }
        }
        return result;
      };
    }
    prototype.drawElements = function(mode, count, ...args) {
      const frame = state.activeFrame;
      const drawStart = performance.now();
      state.glDrawCalls += 1;
      const frameIndex = frame?.index ?? state.raf.length - 1;
      state.glFrames.add(frameIndex);
      state.frameDrawCalls.set(frameIndex, (state.frameDrawCalls.get(frameIndex) ?? 0) + 1);
      if (state.firstRenderAt === null) state.firstRenderAt = performance.now();
      if (mode === this.TRIANGLES) {
        state.triangles += count / 3;
        state.frameTriangles.set(frameIndex, (state.frameTriangles.get(frameIndex) ?? 0) + count / 3);
      }
      try {
        return originalDrawElements.call(this, mode, count, ...args);
      } finally {
        if (frame) frame.drawMs += performance.now() - drawStart;
      }
    };
    prototype.drawArrays = function(mode, first, count, ...args) {
      const frame = state.activeFrame;
      const drawStart = performance.now();
      state.glDrawCalls += 1;
      const frameIndex = frame?.index ?? state.raf.length - 1;
      state.glFrames.add(frameIndex);
      state.frameDrawCalls.set(frameIndex, (state.frameDrawCalls.get(frameIndex) ?? 0) + 1);
      if (state.firstRenderAt === null) state.firstRenderAt = performance.now();
      if (mode === this.TRIANGLES) {
        state.triangles += count / 3;
        state.frameTriangles.set(frameIndex, (state.frameTriangles.get(frameIndex) ?? 0) + count / 3);
      }
      try {
        return originalDrawArrays.call(this, mode, first, count, ...args);
      } finally {
        if (frame) frame.drawMs += performance.now() - drawStart;
      }
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
    await session.call('Tracing.start', {
      categories: 'disabled-by-default-v8.gc,blink.user_timing',
      transferMode: 'ReturnAsStream',
    });
    const traceAnchorResult = await session.call('Runtime.evaluate', {
      expression: `(() => {
        const now = performance.now();
        performance.mark('__r16_trace_anchor__');
        return now;
      })()`,
      returnByValue: true,
    });
    const traceAnchorPageMs = Number(traceAnchorResult?.result?.value);
    await session.call('Runtime.evaluate', {
      expression: `window.__R16_PERF__?.reset(); window.__R16_PERF__?.scheduleInput(${JSON.stringify(segments)}, ${TICK_HZ});`,
      returnByValue: true,
    });
    await sleep(MEASUREMENT_SECONDS * 1000 + 100);
    const tracingComplete = session.waitForEvent('Tracing.tracingComplete');
    await session.call('Tracing.end');
    const traceEvent = await tracingComplete;
    const traceText = traceEvent.stream ? await readTracingStream(session, traceEvent.stream) : '';
    const events = traceEvents(traceText);
    const gcEvents = gcTraceEvents(events);
    const maxGcEvent = gcEvents.reduce(
      (maximum, event) => (!maximum || event.durationMs > maximum.durationMs ? event : maximum),
      null,
    );
    const traceAnchorTraceMs = traceAnchorMs(events);
    const result = await session.call('Runtime.evaluate', {
      expression: `(() => {
        const state = window.__R16_PERF__;
        const raf = state?.raf ?? [];
        const first = raf[0]?.now ?? state?.measurementStart ?? 0;
        const last = raf.at(-1)?.now ?? first;
        const elapsed = Math.max(0, last - (state?.measurementStart ?? first)) / 1000;
        const webglFrameCount = state?.glFrames?.size ?? 0;
        const frameIntervals = raf.slice(1).map((entry, index) => entry.now - raf[index].now);
        const fps = frameIntervals.filter((ms) => ms > 0).map((ms) => 1000 / ms);
        const percentile = (values, percent) => {
          if (!values.length) return 0;
          const sorted = [...values].sort((a, b) => a - b);
          const index = (sorted.length - 1) * percent / 100;
          const lower = Math.floor(index), upper = Math.ceil(index);
          return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
        };
        const renderTelemetry = window.__CLAY_RENDER_TELEMETRY__;
        const telemetryStart = state?.renderTelemetryStart;
        const telemetryEnd = renderTelemetry && Number.isFinite(renderTelemetry.renderedFrames)
          && Number.isFinite(renderTelemetry.vehicleTransformUpdates)
          && Number.isFinite(renderTelemetry.cameraUpdates)
          && Number.isFinite(renderTelemetry.characterAnimationFrames)
          ? {
            renderedFrames: renderTelemetry.renderedFrames,
            vehicleTransformUpdates: renderTelemetry.vehicleTransformUpdates,
            cameraUpdates: renderTelemetry.cameraUpdates,
            characterAnimationFrames: renderTelemetry.characterAnimationFrames,
          }
          : null;
        const telemetryDeltas = telemetryStart && telemetryEnd
          ? {
            renderedFrames: telemetryEnd.renderedFrames - telemetryStart.renderedFrames,
            vehicleTransformUpdates: telemetryEnd.vehicleTransformUpdates - telemetryStart.vehicleTransformUpdates,
            cameraUpdates: telemetryEnd.cameraUpdates - telemetryStart.cameraUpdates,
            characterAnimationFrames: telemetryEnd.characterAnimationFrames - telemetryStart.characterAnimationFrames,
          }
          : null;
        const telemetryDeltaValid = telemetryDeltas
          && Object.values(telemetryDeltas).every((value) => Number.isFinite(value) && value >= 0);
        const renderTelemetryStatus = !telemetryStart || !telemetryEnd
          ? 'missing_render_telemetry'
          : !telemetryDeltaValid
            ? 'invalid_counter_delta'
            : 'measured';
        const telemetryHz = telemetryDeltaValid && elapsed > 0
          ? {
            vehicleTransformUpdates: telemetryDeltas.vehicleTransformUpdates / elapsed,
            cameraUpdates: telemetryDeltas.cameraUpdates / elapsed,
            characterAnimationFrames: telemetryDeltas.characterAnimationFrames / elapsed,
          }
          : null;
        const telemetryRenderedFrames = telemetryDeltaValid ? telemetryDeltas.renderedFrames : null;
        const telemetryRatios = telemetryRenderedFrames > 0
          ? {
            vehicleTransformPerFrame: telemetryDeltas.vehicleTransformUpdates / telemetryRenderedFrames,
            cameraPerFrame: telemetryDeltas.cameraUpdates / telemetryRenderedFrames,
            characterAnimationPerFrame: telemetryDeltas.characterAnimationFrames / telemetryRenderedFrames,
          }
          : null;
        const navigation = performance.getEntriesByType('navigation')[0];
        const heap = state?.heapSamples ?? [];
        const drawCallsPerFrame = state?.frameDrawCalls ? [...state.frameDrawCalls.values()] : [];
        const trianglesPerFrame = state?.frameTriangles ? [...state.frameTriangles.values()] : [];
        const frameSamples = raf.slice(1).map((entry, index) => {
          const previous = raf[index];
          const frame = entry.frame ?? {};
          const callbackStart = Number(frame.start ?? entry.now);
          const callbackEnd = Number(frame.callbackEnd ?? callbackStart);
          const drawMs = Number(frame.drawMs ?? 0);
          const scriptWallMs = Number(frame.scriptMs ?? 0);
          return {
            frame_ordinal: index + 1,
            interval_start_ms: previous.now,
            interval_end_ms: entry.now,
            frame_time_ms: entry.now - previous.now,
            callback_start_ms: callbackStart,
            callback_end_ms: callbackEnd,
            draw_ms: drawMs,
            script_wall_ms: scriptWallMs,
          };
        }).filter((frame) => Number.isFinite(frame.frame_time_ms) && frame.frame_time_ms >= 0);
        const nearestRankIndex = frameSamples.length ? Math.min(frameSamples.length - 1, Math.ceil(frameSamples.length * 0.99) - 1) : -1;
        const nearestRankFrames = [...frameSamples].sort((left, right) => left.frame_time_ms - right.frame_time_ms);
        const p99Frame = nearestRankIndex >= 0 ? nearestRankFrames[nearestRankIndex] : null;
        return {
          canvas_count: document.querySelectorAll('canvas').length,
          raf_callbacks: raf.length,
          rendered_frames: webglFrameCount,
          gl_draw_calls: state?.glDrawCalls ?? 0,
          triangles: state?.triangles ?? 0,
          elapsed_s: elapsed,
          fps_p50: percentile(fps, 50),
          fps_p05: percentile(fps, 5),
          frame_time_p99_ms: percentile(frameIntervals, 99),
          long_frame_count: frameIntervals.filter((ms) => ms > 33).length,
          vehicle_transform_hz: telemetryHz?.vehicleTransformUpdates ?? null,
          camera_hz: telemetryHz?.cameraUpdates ?? null,
          character_anim_hz: telemetryHz?.characterAnimationFrames ?? null,
          character_anim_status: renderTelemetryStatus === 'measured'
            ? 'measured_render_telemetry'
            : renderTelemetryStatus,
          character_anim_updates: telemetryDeltas?.characterAnimationFrames ?? null,
          character_anim_measurement: {
            method: 'window.__CLAY_RENDER_TELEMETRY__ counter deltas / measurement elapsed',
            status: renderTelemetryStatus,
            elapsed_s: elapsed,
            counters_start: telemetryStart,
            counters_end: telemetryEnd,
            counter_deltas: telemetryDeltas,
          },
          render_telemetry_status: renderTelemetryStatus,
          render_telemetry_counters: telemetryDeltas,
          render_telemetry_ratios: telemetryRatios,
          first_interactive_s: navigation?.domContentLoadedEventEnd ? navigation.domContentLoadedEventEnd / 1000 : null,
          time_to_first_render_s: state?.firstRenderAt === null ? null : (state.firstRenderAt - state.documentStart) / 1000,
          heap_peak_mb: heap.length ? Math.max(...heap) : null,
          heap_growth_per_lap_mb: heap.length > 1 ? Math.max(0, heap.at(-1) - heap[0]) : null,
          draw_calls: drawCallsPerFrame.length ? Math.max(...drawCallsPerFrame) : 0,
          triangles_k: trianglesPerFrame.length ? Math.max(...trianglesPerFrame) / 1000 : 0,
          texture_memory_mb: (state?.textureBytes ?? 0) / (1024 * 1024),
          frame_breakdown: {
            method: 'nearest_rank_p99_frame_interval',
            sample_count: frameSamples.length,
            p99_frame: p99Frame,
          },
        };
      })()`,
      returnByValue: true,
    });
    const measured = result?.result?.value;
    if (!measured || measured.canvas_count < 1 || measured.rendered_frames < 1) {
      throw new Error(`headless renderer produced no measurable WebGL frames: ${JSON.stringify(measured)}`);
    }
    const traceOffsetMs = Number.isFinite(traceAnchorPageMs) && traceAnchorTraceMs !== null
      ? traceAnchorTraceMs - traceAnchorPageMs
      : null;
    const p99Frame = measured.frame_breakdown?.p99_frame;
    let frameBreakdown = {
      ...measured.frame_breakdown,
      trace_gc_events: gcEvents.length,
      trace_anchor: {
        status: traceOffsetMs === null ? 'unavailable' : 'aligned',
        page_now_ms: Number.isFinite(traceAnchorPageMs) ? traceAnchorPageMs : null,
        trace_ts_ms: traceAnchorTraceMs,
      },
    };
    if (p99Frame && traceOffsetMs !== null) {
      const intervalStartMs = p99Frame.interval_start_ms + traceOffsetMs;
      const intervalEndMs = p99Frame.interval_end_ms + traceOffsetMs;
      const callbackStartMs = p99Frame.callback_start_ms + traceOffsetMs;
      const callbackEndMs = p99Frame.callback_end_ms + traceOffsetMs;
      const gcMs = unionOverlapMs(gcEvents, intervalStartMs, intervalEndMs);
      const callbackGcMs = unionOverlapMs(gcEvents, callbackStartMs, callbackEndMs);
      const scriptMs = Math.max(0, p99Frame.script_wall_ms - callbackGcMs);
      const drawMs = p99Frame.draw_ms;
      const unattributedMs = Math.max(0, p99Frame.frame_time_ms - drawMs - scriptMs - gcMs);
      const share = (value) => p99Frame.frame_time_ms > 0 ? value / p99Frame.frame_time_ms * 100 : 0;
      frameBreakdown = {
        ...frameBreakdown,
        p99_frame: {
          ...p99Frame,
          script_ms: scriptMs,
          gc_ms: gcMs,
          unattributed_ms: unattributedMs,
          shares_pct: {
            draw: share(drawMs),
            script: share(scriptMs),
            gc: share(gcMs),
            unattributed: share(unattributedMs),
          },
        },
        attribution_note: 'draw_ms is JS-side WebGL submission time; script_ms excludes draw and trace-aligned GC; unattributed includes browser/vsync/GPU wait.',
      };
    } else {
      frameBreakdown = {
        ...frameBreakdown,
        attribution_note: 'GC could not be aligned to the p99 frame because the trace anchor was unavailable.',
      };
    }
    return {
      ...measured,
      chrome_path: chromePath,
      gc_pause_max_ms: gcPauseMaxMs(gcEvents),
      gc_pause_max_event: maxGcEvent,
      frame_breakdown: frameBreakdown,
      trace_gc_event_count: gcEvents.length,
    };
  } finally {
    session?.close();
    child.kill('SIGTERM');
    await new Promise((resolveExit) => child.once('exit', resolveExit));
    await new Promise((resolveServer) => server.close(resolveServer));
    await rm(userDataDir, { recursive: true, force: true });
  }
}

const measured = await measureBrowser();
const { chrome_path: chromePath, ...measurementMetrics } = measured;
const assets = await assetMetrics();
const build = {
  sha: process.env.PERF_BUILD_SHA ?? buildSha(),
  assets,
};
const report = {
  meta: {
    fixture: fixture.fixture,
    tick_hz: TICK_HZ,
    total_ticks: fixture.ticks,
    measurement_seconds: MEASUREMENT_SECONDS,
    build_sha: build.sha,
    build,
    environment: environmentMetadata(chromePath),
    seed: fixture.seed,
    device,
    device_note: 'Chrome headless ANGLE/SwiftShader proxy; not a real iPad/Android measurement',
    measurement_method: 'External requestAnimationFrame and WebGL draw instrumentation; GC duration from Chrome tracing v8.gc events; texture bytes from WebGL texture allocation calls.',
    render_telemetry: {
      global: '__CLAY_RENDER_TELEMETRY__',
      counters: ['renderedFrames', 'vehicleTransformUpdates', 'cameraUpdates', 'characterAnimationFrames'],
    },
  },
  metrics: {
    ...measurementMetrics,
    ...assets,
  },
};

const output = resolve(outputPath);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(`perf-probe: headless ${device} -> ${output}`);
