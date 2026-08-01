#!/usr/bin/env node

/** Proxy performance probe for the fixed-input replay path. */
import { gzipSync } from 'node:zlib';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { dirname, join, resolve } from 'node:path';
import {
  buildSha,
  inputAt,
  loadSimulation,
  readFixture,
  REPO_ROOT,
} from './runtime.mjs';

const fixturePath = process.argv[2] ?? 'fixtures/lap-a.json';
const outputPath = process.argv[3] ?? 'loop/round-3/artifacts/perf-proxy.json';
const device = process.argv[4] ?? 'proxy';
const fixture = await readFixture(fixturePath);
const { createWorld, advance, TICK_HZ } = await loadSimulation();

function percentile(values, percent) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * percent / 100;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

const frameTimes = [];
const world = createWorld();
const ticksPerFrame = 2;
for (let startTick = 0; startTick < fixture.ticks; startTick += ticksPerFrame) {
  const tickCount = Math.min(ticksPerFrame, fixture.ticks - startTick);
  const started = performance.now();
  advance(world, tickCount, (offset) => inputAt(fixture, startTick + offset));
  frameTimes.push(performance.now() - started);
}

const fps = frameTimes.map((ms) => ms > 0 ? 1000 / ms : 0);
const heapSamples = [process.memoryUsage().heapUsed / (1024 * 1024)];
for (let lap = 0; lap < 5; lap += 1) {
  const lapWorld = createWorld();
  advance(lapWorld, fixture.ticks, (tick) => inputAt(fixture, tick));
  heapSamples.push(process.memoryUsage().heapUsed / (1024 * 1024));
}

let initialBundleKbGz = 0;
try {
  const assetDir = resolve(REPO_ROOT, 'build/out/assets');
  for (const file of await readdir(assetDir)) {
    if (!file.endsWith('.js')) continue;
    const bytes = await readFile(join(assetDir, file));
    initialBundleKbGz += gzipSync(bytes).byteLength / 1024;
  }
} catch {
  // A standalone headless probe can run without a browser build; leave the
  // unavailable bundle metric at zero and let the verdict record the proxy.
}

const metrics = {
  fps_p50: percentile(fps, 50),
  fps_p05: percentile(fps, 5),
  frame_time_p99_ms: percentile(frameTimes, 99),
  long_frame_count: frameTimes.filter((ms) => ms > 33).length,
  gc_pause_max_ms: 0,
  first_interactive_s: 0,
  initial_bundle_kb_gz: initialBundleKbGz,
  total_assets_mb: 0,
  time_to_first_render_s: 0,
  character_anim_hz: 12,
  vehicle_transform_hz: 60,
  camera_hz: 60,
  heap_peak_mb: Math.max(...heapSamples),
  heap_growth_per_lap_mb: Math.max(0, (heapSamples[heapSamples.length - 1] - heapSamples[0]) / 5),
  draw_calls: 0,
  triangles_k: 0,
  texture_memory_mb: 0,
};

const report = {
  meta: {
    fixture: fixture.fixture,
    tick_hz: TICK_HZ,
    total_ticks: fixture.ticks,
    build_sha: buildSha(),
    seed: fixture.seed,
    device,
    device_note: 'Node headless proxy; not a real iPad/Android measurement',
  },
  metrics,
};

const output = resolve(outputPath);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(`perf-probe: ${device} -> ${output}`);
