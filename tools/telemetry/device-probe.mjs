#!/usr/bin/env node

/**
 * Real-device performance probe prototype.
 *
 * Android: adb forward -> Chrome's localabstract:chrome_devtools_remote -> CDP.
 * iOS:    ios_webkit_debug_proxy -> Safari Web Inspector target -> CDP-shaped WS.
 *
 * The two transports deliberately share the same page-side probe. This keeps
 * the artifact shape comparable without pretending that desktop Chrome is a
 * valid BAR-PERF device measurement.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFixture } from './runtime.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');
const DEFAULT_PORT = 4173;
const DEFAULT_CDP_PORT = 9222;
const DEFAULT_DURATION_S = 5;
const TICK_HZ = 120;

function usage() {
  console.log(`Usage:
  device-probe.mjs android --url URL [options]
  device-probe.mjs ios --url URL [options]
  device-probe.mjs check android|ios

Options:
  --url URL             page to measure; with --serve, defaults to build/out/index.html
  --serve               serve build/out on the LAN and use its address as --url
  --port N              LAN server port (default: ${DEFAULT_PORT})
  --duration N          measurement duration in seconds (default: ${DEFAULT_DURATION_S})
  --output PATH         write JSON instead of printing it
  --serial ID           Android adb serial
  --udid ID             iOS device UDID for ios_webkit_debug_proxy
  --proxy PATH          iOS ios_webkit_debug_proxy executable
  --cdp-port N          local forwarded/proxy port (default: ${DEFAULT_CDP_PORT})
  --target URL          select a tab by URL substring
  --fixture PATH        fixed input fixture (default: fixtures/lap-a.json)
  --no-open             do not ask Android to open --url
  --help                show this help

Prerequisites:
  Android: adb, Chrome with USB debugging enabled on the device.
  iOS: ios_webkit_debug_proxy, a trusted device, and Safari > Advanced > Web Inspector.
`);
}

function parseArgs(argv) {
  const [kind, ...rest] = argv;
  if (kind === '--help' || kind === '-h') return { help: true };
  if (kind === 'check') {
    return { kind, checkKind: rest[0] };
  }
  const options = {
    kind,
    port: DEFAULT_PORT,
    cdpPort: DEFAULT_CDP_PORT,
    duration: DEFAULT_DURATION_S,
    serve: false,
    open: true,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--serve') {
      options.serve = true;
      continue;
    }
    if (arg === '--no-open') {
      options.open = false;
      continue;
    }
    const [key, inlineValue] = arg.split('=', 2);
    const takesValue = new Set([
      '--url', '--port', '--duration', '--output', '--serial', '--udid',
      '--proxy', '--cdp-port', '--target', '--adb', '--fixture',
    ]);
    if (!takesValue.has(key)) throw new Error(`unknown argument: ${arg}`);
    const value = inlineValue ?? rest[++index];
    if (value === undefined) throw new Error(`${key} needs a value`);
    if (key === '--port') options.port = positiveInteger(value, key);
    else if (key === '--cdp-port') options.cdpPort = positiveInteger(value, key);
    else if (key === '--duration') options.duration = positiveNumber(value, key);
    else if (key === '--url') options.url = value;
    else if (key === '--output') options.output = value;
    else if (key === '--serial') options.serial = value;
    else if (key === '--udid') options.udid = value;
    else if (key === '--proxy') options.proxy = value;
    else if (key === '--target') options.target = value;
    else if (key === '--adb') options.adb = value;
    else if (key === '--fixture') options.fixture = value;
  }
  return options;
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 65535) {
    throw new Error(`${name} must be a positive port number`);
  }
  return number;
}

function positiveNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 3600) {
    throw new Error(`${name} must be in (0, 3600]`);
  }
  return number;
}

function executableAvailable(command) {
  if (command.includes('/') || command.includes('\\')) {
    return spawnSync('test', ['-x', command], { stdio: 'ignore' }).status === 0;
  }
  return spawnSync('sh', ['-c', 'command -v "$1"', 'device-probe', command], { stdio: 'ignore' }).status === 0;
}

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || (!allowFailure && result.status !== 0)) {
    const detail = result.error?.message ?? `${result.stderr ?? ''}`.trim();
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return {
    status: result.status ?? 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function parseAndroidDevices(text) {
  return text
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state, ...properties] = line.split(/\s+/);
      return { serial, state, properties };
    });
}

function chooseAndroidDevice(adb, requestedSerial) {
  const listed = parseAndroidDevices(run(adb, ['devices', '-l']).stdout);
  const devices = listed.filter((device) => device.state === 'device');
  if (requestedSerial) {
    const match = devices.find((device) => device.serial === requestedSerial);
    if (!match) throw new Error(`Android device ${requestedSerial} is not online; adb devices: ${JSON.stringify(listed)}`);
    return match.serial;
  }
  if (devices.length !== 1) {
    throw new Error(`expected exactly one online Android device; found ${JSON.stringify(listed)}`);
  }
  return devices[0].serial;
}

function localLanAddress() {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  throw new Error('could not find a non-loopback IPv4 address for the mobile device');
}

function mimeType(path) {
  const extension = extname(path);
  if (extension === '.html') return 'text/html; charset=utf-8';
  if (extension === '.js') return 'text/javascript; charset=utf-8';
  if (extension === '.css') return 'text/css; charset=utf-8';
  if (extension === '.json' || extension === '.map') return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

async function startLanServer(port) {
  const root = resolve(REPO_ROOT, 'build/out');
  await access(resolve(root, 'index.html'));
  const server = createServer(async (request, response) => {
    try {
      const requestPath = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
      const path = resolve(root, relative);
      if (path !== root && !path.startsWith(`${root}${sep}`)) {
        response.writeHead(403);
        response.end('forbidden');
        return;
      }
      const body = await readFile(path);
      response.writeHead(200, { 'cache-control': 'no-store', 'content-type': mimeType(path) });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end('not found');
    }
  });
  await new Promise((resolveServer, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', resolveServer);
  });
  const url = `http://${localLanAddress()}:${port}/index.html`;
  return { server, url };
}

async function waitForJson(baseUrl, path, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}${path}`);
      if (response.ok) return await response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 150));
  }
  throw new Error(`timed out waiting for ${baseUrl}${path}${lastError ? ` (${lastError.message})` : ''}`);
}

class JsonWsSession {
  #socket;
  #nextId = 0;
  #pending = new Map();

  constructor(url) {
    this.#socket = new WebSocket(url);
    this.#socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id === undefined) return;
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

function remoteProbeScript(durationMs, inputSegments) {
  return `(() => {
    const state = window.__CLAY_KART_DEVICE_PROBE__ ??= {
      frames: [], drawCalls: 0, triangles: 0, active: false,
      renderTelemetryStart: null, renderTelemetryEnd: null,
      rafInstalled: false, glInstalled: false,
      inputTimers: [],
      characterAnimationInstances: null,
    };
    if (!state.rafInstalled) {
      const originalRaf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) => originalRaf((timestamp) => {
        if (state.active) state.frames.push({ timestamp, now: performance.now() });
        return callback(timestamp);
      });
      state.rafInstalled = true;
    }
    if (!state.glInstalled) {
      const patchGl = (prototype) => {
        if (!prototype || prototype.__clayKartDeviceProbe) return;
        Object.defineProperty(prototype, '__clayKartDeviceProbe', { value: true });
        for (const name of ['drawElements', 'drawArrays']) {
          const original = prototype[name];
          if (!original) continue;
          prototype[name] = function(mode, ...args) {
            if (state.active) {
              state.drawCalls += 1;
              const count = name === 'drawElements' ? Number(args[0]) : Number(args[1]);
              if (mode === this.TRIANGLES && Number.isFinite(count)) state.triangles += count / 3;
            }
            return original.call(this, mode, ...args);
          };
        }
      };
      patchGl(window.WebGLRenderingContext?.prototype);
      patchGl(window.WebGL2RenderingContext?.prototype);
      state.glInstalled = true;
    }
    state.frames = [];
    state.drawCalls = 0;
    state.triangles = 0;
    const animationCanvas = document.querySelector('canvas[data-character-animation-instances]');
    const animationInstanceCount = Number(animationCanvas?.dataset.characterAnimationInstances);
    state.characterAnimationInstances = Number.isInteger(animationInstanceCount)
      && animationInstanceCount > 0
      ? animationInstanceCount
      : null;
    const snapshotRenderTelemetry = () => {
      const telemetry = window.__CLAY_RENDER_TELEMETRY__;
      return telemetry && Number.isFinite(telemetry.renderedFrames)
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
    state.renderTelemetryStart = snapshotRenderTelemetry();
    state.renderTelemetryEnd = null;
    for (const timer of state.inputTimers ?? []) clearTimeout(timer);
    state.inputTimers = [];
    const held = new Set();
    const codesFor = (input) => {
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
    const applyInput = (input) => {
      const next = codesFor(input);
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
    for (const segment of ${JSON.stringify(inputSegments)}) {
      const timer = setTimeout(() => applyInput(segment.input), segment.start_tick * 1000 / ${TICK_HZ});
      state.inputTimers.push(timer);
    }
    state.startedAt = performance.now();
    state.active = true;
    setTimeout(() => {
      state.active = false;
      for (const code of held) window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
      held.clear();
      state.renderTelemetryEnd = snapshotRenderTelemetry();
      state.finishedAt = performance.now();
    }, ${Math.ceil(durationMs)});
    return { started: true, href: location.href, startedAt: state.startedAt };
  })()`;
}

function summarizeRemote(measurement, kind, transport, url, fixtureName) {
  const frameTimes = measurement.frames.slice(1).map((entry, index) => entry.now - measurement.frames[index].now)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const fps = frameTimes.filter((value) => value > 0).map((value) => 1000 / value);
  const percentile = (values, percent) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = (sorted.length - 1) * percent / 100;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  };
  const first = measurement.frames[0]?.now ?? measurement.startedAt;
  const last = measurement.frames.at(-1)?.now ?? first;
  const elapsed = Math.max(0, last - first) / 1000;
  const fpsP50 = percentile(fps, 50);
  const fpsP05 = percentile(fps, 5);
  const telemetryStart = measurement.renderTelemetryStart;
  const telemetryEnd = measurement.renderTelemetryEnd;
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
  const characterAnimationInstances = Number.isFinite(measurement.characterAnimationInstances)
    && measurement.characterAnimationInstances > 0
    ? measurement.characterAnimationInstances
    : null;
  const characterAnimationHz = telemetryHz?.characterAnimationFrames !== null
    && telemetryHz?.characterAnimationFrames !== undefined
    && characterAnimationInstances !== null
    ? telemetryHz.characterAnimationFrames / characterAnimationInstances
    : null;
  const rawCharacterAnimationPerFrame = telemetryRenderedFrames > 0
    ? telemetryDeltas.characterAnimationFrames / telemetryRenderedFrames
    : null;
  const characterAnimationPerFrame = rawCharacterAnimationPerFrame !== null && characterAnimationInstances !== null
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
  const characterAnimationValidation = fpsP05 > 24
    ? {
      mode: 'hz_12_window',
      conclusion: '12Hz frequency is resolvable at this sampling rate',
      fps_p05: fpsP05,
      character_anim_hz: characterAnimationHz,
      character_animation_per_frame: characterAnimationPerFrame,
    }
    : {
      mode: 'quantization_ratio_proves_quantization_only',
      conclusion: 'only quantization is tested; 12Hz frequency is not resolvable at this sampling rate',
      fps_p05: fpsP05,
      character_anim_hz: characterAnimationHz,
      character_animation_per_frame: characterAnimationPerFrame,
      max_per_frame_ratio: 0.95,
    };
  return {
    meta: {
      fixture: fixtureName,
      tick_hz: TICK_HZ,
      measurement_seconds: elapsed,
      device: kind,
      device_note: 'real device transport; run only after confirming the target URL and device identity',
      transport,
      target_url: url,
      measurement_method: 'remote requestAnimationFrame/WebGL instrumentation over device inspector protocol',
      render_telemetry: {
        global: '__CLAY_RENDER_TELEMETRY__',
        counters: ['renderedFrames', 'vehicleTransformUpdates', 'cameraUpdates', 'characterAnimationFrames'],
      },
    },
    metrics: {
      fps_p50: fpsP50,
      fps_p05: fpsP05,
      frame_time_p99_ms: percentile(frameTimes, 99),
      long_frame_count: frameTimes.filter((value) => value > 33).length,
      gc_pause_max_ms: null,
      character_anim_hz: characterAnimationHz,
      character_anim_status: renderTelemetryStatus === 'measured'
        ? 'measured_render_telemetry'
        : renderTelemetryStatus,
      character_anim_updates: telemetryDeltas?.characterAnimationFrames ?? null,
      character_anim_validation_mode: characterAnimationValidation.mode,
      character_anim_validation: characterAnimationValidation,
      vehicle_transform_hz: telemetryHz?.vehicleTransformUpdates ?? null,
      camera_hz: telemetryHz?.cameraUpdates ?? null,
      render_telemetry_status: renderTelemetryStatus,
      render_telemetry_counters: telemetryDeltas,
      render_telemetry_ratios: telemetryRatios,
      heap_peak_mb: null,
      heap_growth_per_lap_mb: null,
      draw_calls: Number(measurement.drawCalls ?? 0),
      triangles_k: Number(measurement.triangles ?? 0) / 1000,
      texture_memory_mb: null,
      first_interactive_s: null,
      initial_bundle_kb_gz: null,
      total_assets_mb: null,
      time_to_first_render_s: null,
    },
    measurement: {
      frame_count: measurement.frames.length,
      render_telemetry_status: renderTelemetryStatus,
      render_telemetry_start: telemetryStart,
      render_telemetry_end: telemetryEnd,
      render_telemetry_deltas: telemetryDeltas,
      unsupported_metrics: ['gc_pause_max_ms', 'texture_memory_mb', 'heap_peak_mb', 'heap_growth_per_lap_mb', 'load timings'],
    },
  };
}

async function connectTarget(baseUrl, targetSelector) {
  const targets = await waitForJson(baseUrl, '/json/list');
  const target = targets.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl && (!targetSelector || entry.url.includes(targetSelector)));
  if (!target) throw new Error(`no inspectable page target found at ${baseUrl}; open the game tab first`);
  const session = new JsonWsSession(target.webSocketDebuggerUrl);
  await session.connect();
  await session.call('Runtime.enable').catch(() => {});
  await session.call('Page.enable').catch(() => {});
  return { session, target };
}

async function check(kind, options) {
  if (!['android', 'ios'].includes(kind)) {
    throw new Error('check expects android or ios');
  }
  if (kind === 'android') {
    const adb = options.adb ?? 'adb';
    const available = executableAvailable(adb);
    let devices = [];
    let error = null;
    if (available) {
      try {
        devices = parseAndroidDevices(run(adb, ['devices', '-l']).stdout);
      } catch (caught) {
        error = caught.message;
      }
    } else {
      error = 'adb not found';
    }
    return { transport: 'adb+chrome-cdp', available: available && devices.some((device) => device.state === 'device'), adb: available, devices, error };
  }
  const proxy = options.proxy ?? 'ios_webkit_debug_proxy';
  return {
    transport: 'ios-webkit-debug-proxy+safari-inspector',
    available: executableAvailable(proxy),
    proxy,
    error: executableAvailable(proxy) ? null : 'ios_webkit_debug_proxy not found; install/build the proxy and trust the iOS device',
  };
}

async function main(options) {
  if (!['android', 'ios'].includes(options.kind)) {
    usage();
    throw new Error('first argument must be android, ios, or check');
  }
  if (options.serve) {
    const served = await startLanServer(options.port);
    options.url = served.url;
    options.server = served.server;
  }
  if (!options.url) throw new Error('--url is required unless --serve is used');
  const fixture = await readFixture(resolve(REPO_ROOT, options.fixture ?? 'fixtures/lap-a.json'));
  const maxTick = Math.ceil(options.duration * TICK_HZ) + 1;
  const inputSegments = fixture.input_segments
    .filter((segment) => segment.start_tick <= maxTick)
    .map((segment) => ({ ...segment, end_tick: Math.min(segment.end_tick, maxTick) }))
    .filter((segment) => segment.end_tick > segment.start_tick);

  let transport;
  let cleanup = () => {};
  let session = null;
  try {
    if (options.kind === 'android') {
      const adb = options.adb ?? 'adb';
      if (!executableAvailable(adb)) throw new Error('adb not found; install Android SDK Platform-Tools and enable USB debugging');
      const serial = chooseAndroidDevice(adb, options.serial);
      run(adb, ['-s', serial, 'forward', `tcp:${options.cdpPort}`, 'localabstract:chrome_devtools_remote']);
      cleanup = () => { run(adb, ['-s', serial, 'forward', '--remove', `tcp:${options.cdpPort}`], { allowFailure: true }); };
      transport = `adb+chrome-cdp:${serial}`;
      if (options.open) run(adb, ['-s', serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', options.url], { allowFailure: true });
    } else {
      const proxy = options.proxy ?? 'ios_webkit_debug_proxy';
      if (!executableAvailable(proxy)) {
        throw new Error('ios_webkit_debug_proxy not found; enable Safari Web Inspector and install the proxy before running the iOS prototype');
      }
      const proxyArgs = ['-c', `${options.udid ?? 'all'}:${options.cdpPort}`];
      const child = spawn(proxy, proxyArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', (chunk) => process.stderr.write(`[ios-proxy] ${chunk}`));
      child.stderr.on('data', (chunk) => process.stderr.write(`[ios-proxy] ${chunk}`));
      cleanup = () => child.kill('SIGTERM');
      transport = `ios-webkit-debug-proxy:${options.udid ?? 'all'}`;
    }

    const baseUrl = `http://127.0.0.1:${options.cdpPort}`;
    const connected = await connectTarget(baseUrl, options.target);
    session = connected.session;
    const { target } = connected;
    const pageUrl = target.url;
    if (options.url && pageUrl !== options.url && !pageUrl.includes(new URL(options.url).host)) {
      await session.call('Page.navigate', { url: options.url }).catch(() => {});
      await new Promise((resolveSleep) => setTimeout(resolveSleep, 500));
    }
    await session.call('Runtime.evaluate', {
      expression: remoteProbeScript(options.duration * 1000, inputSegments),
      returnByValue: true,
      awaitPromise: false,
    });
    await new Promise((resolveSleep) => setTimeout(resolveSleep, options.duration * 1000 + 300));
    const result = await session.call('Runtime.evaluate', {
      expression: 'JSON.stringify(window.__CLAY_KART_DEVICE_PROBE__ ?? null)',
      returnByValue: true,
    });
    const remote = JSON.parse(result?.result?.value ?? 'null');
    if (!remote || !Array.isArray(remote.frames) || remote.frames.length < 2) {
      throw new Error(`remote page returned no usable rAF samples: ${JSON.stringify(remote)}`);
    }
    const report = summarizeRemote(remote, options.kind, transport, options.url, fixture.fixture);
    const output = JSON.stringify(report, null, 2) + '\n';
    if (options.output) {
      const outputPath = resolve(options.output);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, output, 'utf8');
      console.log(`device-probe: ${options.kind} -> ${outputPath}`);
    } else {
      process.stdout.write(output);
    }
  } finally {
    session?.close();
    cleanup();
    options.server?.close();
  }
}

const parsed = parseArgs(process.argv.slice(2));
if (parsed.help) {
  usage();
} else if (parsed.kind === 'check') {
  const result = await check(parsed.checkKind, parsed);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.available ? 0 : 2;
} else {
  try {
    await main(parsed);
  } catch (error) {
    console.error(`device-probe: ${error.message}`);
    process.exitCode = 1;
  }
}
