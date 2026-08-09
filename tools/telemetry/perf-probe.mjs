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

const cliArgs = process.argv.slice(2);
const sceneOnly = cliArgs.includes('--scene-only');
const positionalArgs = cliArgs.filter((argument) => argument !== '--scene-only');
const fixturePath = positionalArgs[0] ?? 'fixtures/lap-a.json';
const outputPath = positionalArgs[1] ?? 'loop/round-16/artifacts/perf-proxy.json';
const device = positionalArgs[2] ?? 'proxy';
const environment = positionalArgs[3] ?? process.env.PERF_ENV ?? 'local';
const MEASUREMENT_SECONDS = 5;
const HEAP_REQUIRED_LAPS = 5;
const HEAP_DRIVER_INPUT = {
  throttle: 1,
  // The page driver is keyboard-only: ArrowRight maps to the simulation's
  // steer=-1 in src/ui/player-input.ts and is the stable circular route.
  steer: 1,
  brake: false,
  reverse: false,
  drift: false,
  jump: false,
};
const FOUR_G_PROFILE = {
  name: '4g-4mbps-20ms',
  offline: false,
  latency_ms: 20,
  download_throughput_bps: 4 * 1024 * 1024 / 8,
  upload_throughput_bps: 1 * 1024 * 1024 / 8,
  connection_type: 'cellular4g',
  cdp_method: 'Network.emulateNetworkConditions',
};
const UNTHROTTLED_PROFILE = {
  offline: false,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
};
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
    firstRenderAt: null,
    documentStart: performance.now(),
    measurementStart: performance.now(),
    inputTimers: [],
    textureBytes: 0,
    textureContexts: new Map(),
    glRenderer: null,
    glVendor: null,
    glRendererSource: null,
    glContextType: null,
    renderTelemetryStart: null,
    heapRunning: false,
    heapSamples: [],
    frameHeapSamples: [],
    heapMeasurement: null,
    lapProbe: null,
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
    state.heapRunning = false;
    state.heapSamples = [];
    state.frameHeapSamples = [];
    state.heapMeasurement = null;
    state.lapProbe = null;
    state.measurementStart = performance.now();
    const telemetry = window.__CLAY_RENDER_TELEMETRY__;
    state.renderTelemetryStart = telemetry && Number.isFinite(telemetry.renderedFrames)
      && Number.isFinite(telemetry.vehicleTransformUpdates)
      && Number.isFinite(telemetry.cameraUpdates)
      && Number.isFinite(telemetry.characterAnimationInstances)
      && Number.isFinite(telemetry.characterAnimationFrames)
      ? {
        renderedFrames: telemetry.renderedFrames,
        vehicleTransformUpdates: telemetry.vehicleTransformUpdates,
        cameraUpdates: telemetry.cameraUpdates,
        characterAnimationInstances: telemetry.characterAnimationInstances,
        characterAnimationFrames: telemetry.characterAnimationFrames,
      }
      : null;
  };
  const readHeapBytes = () => performance.memory
    ? performance.memory.usedJSHeapSize
    : null;
  const captureGlInfo = (gl, contextType) => {
    if (!gl) return;
    let renderer = null;
    let vendor = null;
    let source = null;
    try {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
        source = 'WEBGL_debug_renderer_info.UNMASKED_RENDERER_WEBGL';
      } else {
        renderer = gl.getParameter(gl.RENDERER);
        vendor = gl.getParameter(gl.VENDOR);
        source = 'WebGLRenderingContext.RENDERER (debug extension unavailable)';
      }
    } catch {
      // Keep the renderer explicitly missing; launch flags are not evidence
      // that a hardware backend was actually selected.
    }
    if (typeof renderer === 'string' && renderer.length > 0) state.glRenderer = renderer;
    if (typeof vendor === 'string' && vendor.length > 0) state.glVendor = vendor;
    if (typeof source === 'string') state.glRendererSource = source;
    if (typeof contextType === 'string') state.glContextType = contextType;
  };
  const originalCanvasGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, ...args) {
    const context = originalCanvasGetContext.call(this, type, ...args);
    if (typeof type === 'string' && /webgl/i.test(type)) captureGlInfo(context, type);
    return context;
  };
  const readLapSnapshot = () => {
    const values = [...document.querySelectorAll('[data-role="clay-hud-value"]')];
    const lapText = values[0]?.textContent ?? '';
    const timeText = values[1]?.textContent ?? '';
    const lapMatch = lapText.match(/^(\d+)\/(\d+)$/);
    const current = lapMatch ? Number(lapMatch[1]) : null;
    const total = lapMatch ? Number(lapMatch[2]) : null;
    const time = Number.parseFloat(timeText);
    return Number.isInteger(current) && Number.isInteger(total) && Number.isFinite(time)
      ? { current, total, time }
      : null;
  };
  const finishHeapMeasurement = (status, now) => {
    state.heapRunning = false;
    const startBytes = state.heapSamples.find((sample) => Number.isFinite(sample)) ?? null;
    const endBytes = [...state.heapSamples].reverse().find((sample) => Number.isFinite(sample)) ?? null;
    const peakBytes = state.heapSamples.length ? Math.max(...state.heapSamples) : null;
    const deltaBytesRaw = startBytes !== null && endBytes !== null
      ? endBytes - startBytes
      : null;
    const deltaBytes = deltaBytesRaw === null ? null : Math.max(0, deltaBytesRaw);
    state.heapMeasurement = {
      ...state.heapMeasurement,
      status,
      endedAt: now,
      completedLaps: state.heapMeasurement?.completedLaps ?? 0,
      // Keep raw values: a zero delta can be a real zero or memory-info
      // quantization, and the byte values make that distinction auditable.
      heapStartBytes: startBytes,
      heapEndBytes: endBytes,
      heapPeakBytes: peakBytes,
      heapDeltaBytesRaw: deltaBytesRaw,
      heapDeltaBytes: deltaBytes,
      heapStartMb: startBytes === null ? null : startBytes / (1024 * 1024),
      heapEndMb: endBytes === null ? null : endBytes / (1024 * 1024),
      heapDeltaMb: deltaBytes === null ? null : deltaBytes / (1024 * 1024),
      heapSampleCount: state.heapSamples.length,
    };
  };
  state.beginLapHeapMeasurement = (targetLaps) => {
    const initial = readLapSnapshot();
    state.heapRunning = true;
    state.heapSamples = [];
    state.heapMeasurement = {
      status: 'running',
      targetLaps,
      completedLaps: 0,
      startedAt: performance.now(),
      endedAt: null,
      initial_snapshot: initial,
    };
    state.lapProbe = {
      lastCurrent: initial?.current ?? null,
      lastTime: initial?.time ?? null,
      stableFinalFrames: 0,
    };
    const initialHeap = readHeapBytes();
    if (initialHeap !== null) state.heapSamples.push(initialHeap);
  };
  const observeLapHeapMeasurement = () => {
    if (!state.heapRunning || !state.heapMeasurement || !state.lapProbe) return;
    const snapshot = readLapSnapshot();
    if (!snapshot) return;
    const now = performance.now();
    const probe = state.lapProbe;
    if (probe.lastCurrent !== null && snapshot.current > probe.lastCurrent) {
      state.heapMeasurement.completedLaps += snapshot.current - probe.lastCurrent;
    }
    if (snapshot.current === snapshot.total) {
      const timeStable = probe.lastTime !== null && Math.abs(snapshot.time - probe.lastTime) < 0.005;
      probe.stableFinalFrames = timeStable ? probe.stableFinalFrames + 1 : 0;
      // A finished SimSnapshot freezes currentTime. Require enough rendered
      // frames for that freeze, so a rounded two-decimal HUD value during a
      // live final lap is not mistaken for the finish line.
      if (probe.stableFinalFrames >= 45) {
        state.heapMeasurement.completedLaps = Math.max(
          state.heapMeasurement.completedLaps,
          snapshot.total,
        );
      }
    } else {
      probe.stableFinalFrames = 0;
    }
    probe.lastCurrent = snapshot.current;
    probe.lastTime = snapshot.time;
    const finalSnapshot = snapshot.current === snapshot.total
      && probe.stableFinalFrames >= 45;
    if (state.heapMeasurement.completedLaps >= state.heapMeasurement.targetLaps) {
      finishHeapMeasurement('complete', now);
    } else if (finalSnapshot && snapshot.total < state.heapMeasurement.targetLaps) {
      // A world with fewer total laps cannot satisfy the five-lap contract.
      // End the one continuous session from the SimSnapshot state instead of
      // navigating to a second page and disguising two short runs as five.
      finishHeapMeasurement('incomplete_five_lap_run', now);
    }
  };
  state.finishLapHeapMeasurement = (status) => finishHeapMeasurement(status, performance.now());
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
    const heap = readHeapBytes();
    if (heap !== null) {
      state.frameHeapSamples.push(heap);
      if (state.heapRunning) state.heapSamples.push(heap);
    }
    state.activeFrame = frame;
    try {
      return callback(timestamp);
    } finally {
      frame.callbackEnd = performance.now();
      frame.scriptMs = Math.max(0, frame.callbackEnd - frame.start - frame.drawMs);
      state.activeFrame = null;
      observeLapHeapMeasurement();
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

function heapDriverSegments() {
  return [{ start_tick: 0, input: { ...HEAP_DRIVER_INPUT } }];
}

async function evaluatePage(session, expression) {
  const result = await session.call('Runtime.evaluate', {
    expression,
    returnByValue: true,
  });
  return result?.result?.value;
}

const HARDWARE_GL_FLAGS = [
  '--enable-gpu',
  '--use-gl=angle',
  '--use-angle=metal',
  '--disable-software-rasterizer',
];
const SOFTWARE_GL_FLAGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
];

function chromeFlags(backend, userDataDir) {
  const glFlags = backend === 'hardware_gl' ? HARDWARE_GL_FLAGS : SOFTWARE_GL_FLAGS;
  return [
    '--headless=new',
    '--no-sandbox',
    '--disable-extensions',
    '--disable-background-networking',
    ...glFlags,
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ];
}

function rendererLooksSoftware(renderer) {
  return typeof renderer !== 'string'
    || renderer.length === 0
    || /swiftshader|software|llvmpipe|softpipe|basic render/i.test(renderer);
}

async function closeBrowserSession(browser) {
  if (!browser) return;
  browser.session?.close();
  if (browser.child.exitCode === null) browser.child.kill('SIGTERM');
  if (browser.child.exitCode === null) {
    await new Promise((resolveExit) => browser.child.once('exit', resolveExit));
  }
  await rm(browser.userDataDir, { recursive: true, force: true });
}

async function openBrowserSession(chromePath, serverPort, { sceneOnly, backend }) {
  const userDataDir = await mkdtemp(join(
    tmpdir(),
    sceneOnly ? 'clay-kart-r33-scene-chrome-' : 'clay-kart-r33-chrome-',
  ));
  const child = spawn(chromePath, chromeFlags(backend, userDataDir), {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let session = null;
  try {
    const debugPort = await waitForDevtoolsPort(child);
    const page = await waitForPageTarget(debugPort);
    session = new CdpSession(page.webSocketDebuggerUrl);
    await session.connect();
    await session.call('Page.enable');
    if (!sceneOnly) await session.call('Network.enable');
    await session.call('Runtime.enable');
    await session.call('Page.addScriptToEvaluateOnNewDocument', { source: browserProbeScript() });
    await session.call('Emulation.setDeviceMetricsOverride', {
      width: 800,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false,
    });
    if (!sceneOnly) {
      await session.call('Network.emulateNetworkConditions', {
        offline: FOUR_G_PROFILE.offline,
        latency: FOUR_G_PROFILE.latency_ms,
        downloadThroughput: FOUR_G_PROFILE.download_throughput_bps,
        uploadThroughput: FOUR_G_PROFILE.upload_throughput_bps,
        connectionType: FOUR_G_PROFILE.connection_type,
      });
    }
    await session.call('Page.navigate', { url: `http://127.0.0.1:${serverPort}/index.html` });
    await sleep(1500);
    const renderer = await evaluatePage(
      session,
      `(() => {
        const state = window.__R16_PERF__;
        return {
          canvas_count: document.querySelectorAll('canvas').length,
          rendered_frames: state?.glFrames?.size ?? 0,
          gl_renderer: state?.glRenderer ?? null,
          gl_vendor: state?.glVendor ?? null,
          gl_renderer_source: state?.glRendererSource ?? null,
          gl_context_type: state?.glContextType ?? null,
        };
      })()`,
    );
    if (!renderer || renderer.canvas_count < 1 || renderer.rendered_frames < 1) {
      throw new Error(`headless GL context unavailable: ${JSON.stringify(renderer)}`);
    }
    return {
      child,
      session,
      userDataDir,
      glRenderer: renderer.gl_renderer,
      glVendor: renderer.gl_vendor,
      glRendererSource: renderer.gl_renderer_source,
      glContextType: renderer.gl_context_type,
    };
  } catch (error) {
    await closeBrowserSession({ child, session, userDataDir });
    throw error;
  }
}

async function selectBrowserSession(chromePath, serverPort, { sceneOnly }) {
  const hardwareAttempt = {
    requested_backend: 'hardware_gl',
    requested_flags: HARDWARE_GL_FLAGS,
    status: 'unavailable',
    observed_renderer: null,
    conclusion: null,
  };
  let hardware = null;
  try {
    hardware = await openBrowserSession(chromePath, serverPort, {
      sceneOnly,
      backend: 'hardware_gl',
    });
    hardwareAttempt.observed_renderer = hardware.glRenderer;
    if (!rendererLooksSoftware(hardware.glRenderer)) {
      hardwareAttempt.status = 'selected';
      hardwareAttempt.conclusion = 'headless hardware GL selected for this measurement';
      return {
        ...hardware,
        renderBackend: 'hardware_gl',
        hardwareGlAttempt: hardwareAttempt,
      };
    }
    hardwareAttempt.conclusion = (
      'headless hardware GL flags produced a software renderer; the probe will report '
      + 'the software environment instead of treating it as hardware'
    );
    // A detected software backend is evidence of an environment limitation,
    // never an escape hatch that makes timing checks pass or disappear.
    await closeBrowserSession(hardware);
    hardware = null;
  } catch (error) {
    hardwareAttempt.conclusion = (
      `headless hardware GL unavailable: ${error instanceof Error ? error.message : String(error)}`
    );
    if (hardware) await closeBrowserSession(hardware);
  }

  const software = await openBrowserSession(chromePath, serverPort, {
    sceneOnly,
    backend: 'swiftshader_software',
  });
  return {
    ...software,
    renderBackend: 'swiftshader_software',
    hardwareGlAttempt: hardwareAttempt,
  };
}

async function measureHeapRace(session, serverPort, targetLaps) {
  await session.call('Page.navigate', {
    url: `http://127.0.0.1:${serverPort}/index.html?perfHeap=1`,
  });
  await sleep(1500);
  await evaluatePage(
    session,
    `window.__R16_PERF__?.reset(); window.__R16_PERF__?.beginLapHeapMeasurement(${targetLaps}); window.__R16_PERF__?.scheduleInput(${JSON.stringify(heapDriverSegments())}, ${TICK_HZ});`,
  );

  // The timeout only prevents a broken page from hanging the entire probe.
  // Completion is decided by the HUD's SimSnapshot-derived lap state, never by
  // this duration or by an estimated lap time.
  const timeoutMs = targetLaps * 30_000;
  const deadline = Date.now() + timeoutMs;
  let measurement = null;
  while (Date.now() < deadline) {
    await sleep(250);
    measurement = await evaluatePage(
      session,
      'window.__R16_PERF__?.heapMeasurement ?? null',
    );
    if (measurement?.status && measurement.status !== 'running') break;
  }
  if (measurement?.status === 'running' || !measurement) {
    measurement = await evaluatePage(
      session,
      "(() => { window.__R16_PERF__?.finishLapHeapMeasurement('timeout'); return window.__R16_PERF__?.heapMeasurement ?? null; })()",
    );
  }
  return measurement;
}

async function measureHeapLaps(session, serverPort) {
  // §5.2 is specifically a single continuous five-lap heap observation.
  // Keep the one Page.navigate inside measureHeapRace; never sum independent
  // sessions because navigation resets the heap under test.
  const targetLaps = HEAP_REQUIRED_LAPS;
  const run = await measureHeapRace(session, serverPort, targetLaps);
  const runs = [run ?? {
    status: 'missing_measurement',
    targetLaps,
    completedLaps: 0,
    heapDeltaMb: null,
  }];
  const lapsMeasured = runs.reduce(
    (total, run) => total + Math.max(0, Number(run?.completedLaps) || 0),
    0,
  );
  const perRunGrowth = runs
    .filter((run) => run?.status === 'complete'
      && Number(run.completedLaps) > 0
      && Number.isFinite(run.heapDeltaMb))
    .map((run) => run.heapDeltaMb / run.completedLaps);
  const fullRun = lapsMeasured >= HEAP_REQUIRED_LAPS
    && runs.length === 1
    && runs[0]?.status === 'complete'
    && runs[0].completedLaps >= HEAP_REQUIRED_LAPS;
  return {
    status: !fullRun
      ? 'incomplete_five_lap_run'
      : perRunGrowth.length === runs.length
        ? 'measured'
        : 'missing_heap_measurement',
    lapsMeasured,
    requiredLaps: HEAP_REQUIRED_LAPS,
    method: 'single continuous race-session heap delta divided by its SimSnapshot lap count',
    growthPerLapMb: fullRun && perRunGrowth.length === runs.length
      ? perRunGrowth.reduce((sum, value) => sum + value, 0) / perRunGrowth.length
      : null,
    runs,
  };
}

async function measureSceneOnly() {
  const chromePath = await findChrome();
  const { server, port: serverPort } = await startStaticServer();
  let browser = null;
  try {
    browser = await selectBrowserSession(chromePath, serverPort, { sceneOnly: true });
    const result = await browser.session.call('Runtime.evaluate', {
      expression: `(() => {
        const state = window.__R16_PERF__;
        const drawCallsPerFrame = state?.frameDrawCalls ? [...state.frameDrawCalls.values()] : [];
        const trianglesPerFrame = state?.frameTriangles ? [...state.frameTriangles.values()] : [];
        return {
          canvas_count: document.querySelectorAll('canvas').length,
          rendered_frames: state?.glFrames?.size ?? 0,
          draw_calls: drawCallsPerFrame.length ? Math.max(...drawCallsPerFrame) : 0,
          triangles_k: trianglesPerFrame.length ? Math.max(...trianglesPerFrame) / 1000 : 0,
          texture_memory_mb: (state?.textureBytes ?? 0) / (1024 * 1024),
          scene_only_source: 'post-load WebGL instrumentation; renderer.info is private to src/render/renderer.ts',
        };
      })()`,
      returnByValue: true,
    });
    const measured = result?.result?.value;
    if (!measured || measured.canvas_count < 1 || measured.rendered_frames < 1) {
      throw new Error(`scene-only metrics evaluation failed: ${JSON.stringify({
        measured,
        exception: result?.exceptionDetails ?? null,
      })}`);
    }
    return {
      ...measured,
      mode: 'scene-only',
      chrome_path: chromePath,
      render_backend: browser.renderBackend,
      gl_renderer: browser.glRenderer,
      gl_renderer_source: browser.glRendererSource,
      hardware_gl_attempt: browser.hardwareGlAttempt,
      measurement_seconds: 1.5,
      unsupported_metrics: [
        'fps_p50', 'fps_p05', 'frame_time_p99_ms', 'long_frame_count',
        'gc_pause_max_ms', 'character_anim_hz', 'vehicle_transform_hz', 'camera_hz',
        'heap_peak_mb', 'heap_growth_per_lap_mb', 'first_interactive_s',
        'time_to_first_render_s',
      ],
    };
  } finally {
    await closeBrowserSession(browser);
    await new Promise((resolveServer) => server.close(resolveServer));
  }
}

async function measureBrowser() {
  const chromePath = await findChrome();
  const { server, port: serverPort } = await startStaticServer();
  let browser = null;
  let session = null;
  try {
    browser = await selectBrowserSession(chromePath, serverPort, { sceneOnly: false });
    session = browser.session;
    const segments = fixtureSegmentsForWindow();
    // Network throttling belongs to §3.1/§3.4 load timing only. Disable it
    // before the short render window so §2/§4 are not network-throttled.
    await session.call('Network.emulateNetworkConditions', UNTHROTTLED_PROFILE);
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
          && Number.isFinite(renderTelemetry.characterAnimationInstances)
          && Number.isFinite(renderTelemetry.characterAnimationFrames)
          ? {
            renderedFrames: renderTelemetry.renderedFrames,
            vehicleTransformUpdates: renderTelemetry.vehicleTransformUpdates,
            cameraUpdates: renderTelemetry.cameraUpdates,
            characterAnimationInstances: renderTelemetry.characterAnimationInstances,
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
        const characterAnimationInstances = Number.isInteger(telemetryEnd?.characterAnimationInstances)
          && telemetryEnd.characterAnimationInstances > 0
          ? telemetryEnd.characterAnimationInstances
          : null;
        const rawCharacterAnimationHz = telemetryHz?.characterAnimationFrames ?? null;
        const rawCharacterAnimationPerFrame = telemetryRenderedFrames > 0
          ? telemetryDeltas.characterAnimationFrames / telemetryRenderedFrames
          : null;
        const characterAnimationHz = rawCharacterAnimationHz !== null
          && Number.isFinite(characterAnimationInstances)
          && characterAnimationInstances > 0
          ? rawCharacterAnimationHz / characterAnimationInstances
          : null;
        const characterAnimationPerFrame = rawCharacterAnimationPerFrame !== null
          && Number.isFinite(characterAnimationInstances)
          && characterAnimationInstances > 0
          ? rawCharacterAnimationPerFrame / characterAnimationInstances
          : null;
        const telemetryRatios = telemetryRenderedFrames > 0
          ? {
            vehicleTransformPerFrame: telemetryDeltas.vehicleTransformUpdates / telemetryRenderedFrames,
            cameraPerFrame: telemetryDeltas.cameraUpdates / telemetryRenderedFrames,
            characterAnimationPerFrame,
            characterAnimationPerFrameRaw: rawCharacterAnimationPerFrame,
          }
          : null;
        const fpsP05 = fps.length ? percentile(fps, 5) : null;
        const characterAnimationValidation = fpsP05 === null
          ? {
            mode: 'missing_fps_sampling',
            conclusion: 'character animation validation requires measured frame samples',
            fps_p05: null,
            character_anim_hz: characterAnimationHz,
            character_animation_per_frame: characterAnimationPerFrame,
          }
          : fpsP05 > 24
            ? {
            mode: 'hz_12_window',
            conclusion: '12Hz frequency is resolvable at this sampling rate',
            fps_p05: fpsP05,
            character_anim_hz: characterAnimationHz,
            character_animation_per_frame: characterAnimationPerFrame,
          }
          : fpsP05 > 12.63
            ? {
              mode: 'quantization_ratio_two_sided_window',
              conclusion: 'only quantization is tested; ratio is checked around the expected 12Hz sampling ratio',
              fps_p05: fpsP05,
              character_anim_hz: characterAnimationHz,
              character_animation_per_frame: characterAnimationPerFrame,
              expected_ratio: 12 / fpsP05,
              ratio_window: [0.85 * 12 / fpsP05, Math.min(0.95, 1.15 * 12 / fpsP05)],
            }
            : {
              mode: 'character_anim_unmeasurable_render_too_slow',
              conclusion: 'FAIL: render rate is too slow; ratio is saturated and cannot resolve animation frequency',
              fps_p05: fpsP05,
              character_anim_hz: characterAnimationHz,
              character_animation_per_frame: characterAnimationPerFrame,
              render_too_slow_threshold_fps: 12.63,
            };
        const navigation = performance.getEntriesByType('navigation')[0];
        const heap = state?.frameHeapSamples ?? [];
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
          character_anim_hz: characterAnimationHz,
          character_anim_status: renderTelemetryStatus === 'measured'
            ? 'measured_render_telemetry'
            : renderTelemetryStatus,
          character_anim_updates: telemetryDeltas?.characterAnimationFrames ?? null,
          character_anim_validation_mode: characterAnimationValidation.mode,
          character_anim_validation: characterAnimationValidation,
          character_anim_measurement: {
            method: 'window.__CLAY_RENDER_TELEMETRY__ counter deltas / measurement elapsed',
            status: renderTelemetryStatus,
            elapsed_s: elapsed,
            character_instances: characterAnimationInstances,
            character_animation_hz_per_instance: characterAnimationHz,
            character_animation_per_frame: characterAnimationPerFrame,
            counters_start: telemetryStart,
            counters_end: telemetryEnd,
            counter_deltas: telemetryDeltas,
          },
          render_telemetry_status: renderTelemetryStatus,
          render_telemetry_counters: telemetryDeltas,
          render_telemetry_ratios: telemetryRatios,
          first_interactive_s: navigation?.domContentLoadedEventEnd ? navigation.domContentLoadedEventEnd / 1000 : null,
          time_to_first_render_s: state?.firstRenderAt === null ? null : (state.firstRenderAt - state.documentStart) / 1000,
          heap_peak_mb: heap.length ? Math.max(...heap) / (1024 * 1024) : null,
          heap_growth_per_lap_mb: null,
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
      throw new Error(`headless renderer metrics evaluation failed: ${JSON.stringify({
        measured,
        exception: result?.exceptionDetails ?? null,
      })}`);
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
    const heapMeasurement = await measureHeapLaps(session, serverPort);
    return {
      ...measured,
      heap_growth_per_lap_mb: heapMeasurement.growthPerLapMb,
      heap_measurement_status: heapMeasurement.status,
      heap_measurement: heapMeasurement,
      chrome_path: chromePath,
      gc_pause_max_ms: gcPauseMaxMs(gcEvents),
      gc_pause_max_event: maxGcEvent,
      frame_breakdown: frameBreakdown,
      trace_gc_event_count: gcEvents.length,
      render_backend: browser.renderBackend,
      gl_renderer: browser.glRenderer,
      gl_renderer_source: browser.glRendererSource,
      hardware_gl_attempt: browser.hardwareGlAttempt,
    };
  } finally {
    await closeBrowserSession(browser);
    await new Promise((resolveServer) => server.close(resolveServer));
  }
}

const measured = sceneOnly ? await measureSceneOnly() : await measureBrowser();
const {
  chrome_path: chromePath,
  render_backend: renderBackend,
  gl_renderer: glRenderer,
  gl_renderer_source: glRendererSource,
  hardware_gl_attempt: hardwareGlAttempt,
  ...measurementMetrics
} = measured;
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
    render_backend: renderBackend,
    gl_renderer: glRenderer,
    gl_renderer_source: glRendererSource,
    hardware_gl_attempt: hardwareGlAttempt,
    seed: fixture.seed,
    device,
    device_note: renderBackend === 'swiftshader_software'
      ? `Chrome headless software renderer (${glRenderer ?? 'renderer unavailable'}); timing metrics are environment-limited`
      : `Chrome headless ${renderBackend} (${glRenderer ?? 'renderer unavailable'})`,
    mode: measured.mode ?? 'full',
    measurement_method: sceneOnly
      ? 'One post-load scene snapshot from external WebGL draw/triangle/texture instrumentation; renderer.info is private to src/render/renderer.ts.'
      : 'External requestAnimationFrame and WebGL draw instrumentation; GC duration from Chrome tracing v8.gc events; texture bytes from WebGL texture allocation calls.',
    ...(sceneOnly ? {} : { network_profile: FOUR_G_PROFILE }),
    render_measurement_network: sceneOnly ? 'unthrottled_no_network_emulation' : 'unthrottled_after_load',
    measurement_status: sceneOnly ? 'static_scene_only' : 'full_runtime_measurement',
    laps_required: HEAP_REQUIRED_LAPS,
    laps_measured: measurementMetrics.heap_measurement?.lapsMeasured ?? 0,
    heap_measurement_status: sceneOnly
      ? 'not_measured_scene_only'
      : measurementMetrics.heap_measurement?.status ?? 'missing_measurement',
    heap_growth_measurement: measurementMetrics.heap_measurement?.method ?? null,
    heap_lap_runs: measurementMetrics.heap_measurement?.runs ?? [],
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
if (renderBackend === 'swiftshader_software') {
  console.error(
    `perf-probe: headless hardware GL unavailable; reporting ${glRenderer ?? 'unknown'} as software-rendered environment`,
  );
}
console.log(`perf-probe: headless ${device} -> ${output}`);
