/** Shared headless runtime for telemetry tools. */
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Compile only the simulation and the shared tick contract into a disposable
 * ESM directory.  world.ts has a type-only @loader import, so TS2307 is the
 * expected standalone-compile diagnostic; the emitted runtime has no loader or
 * browser dependency.
 */
export async function loadSimulation() {
  const outDir = await mkdtemp(join(tmpdir(), 'clay-kart-sim-'));
  const sourceRoot = resolve(REPO_ROOT, 'src');
  const tsc = resolve(REPO_ROOT, 'node_modules/typescript/lib/tsc.js');
  const args = [
    tsc,
    resolve(sourceRoot, 'physics/world.ts'),
    resolve(sourceRoot, 'contract/sim.ts'),
    '--ignoreConfig',
    '--outDir', outDir,
    '--rootDir', sourceRoot,
    '--module', 'esnext',
    '--target', 'es2022',
    '--moduleResolution', 'bundler',
    '--skipLibCheck',
    '--noEmitOnError', 'false',
  ];
  try {
    execFileSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    const unexpected = output
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.includes('error TS2307'));
    if (unexpected.length > 0) {
      throw new Error(`simulation compile failed:\n${unexpected.join('\n')}`);
    }
  }

  const [physics, contract] = await Promise.all([
    import(pathToFileURL(join(outDir, 'physics/world.js')).href),
    import(pathToFileURL(join(outDir, 'contract/sim.js')).href),
  ]);
  return {
    createWorld: physics.createWorld,
    BASE_TOP_SPEED: physics.BASE_TOP_SPEED,
    CAR_LENGTH: physics.CAR_LENGTH,
    CAR_WIDTH: physics.CAR_WIDTH,
    TRACK_GEOMETRY: physics.TRACK_GEOMETRY,
    advance: contract.advance,
    TICK_HZ: contract.TICK_HZ,
    TICK_DT: contract.TICK_DT,
    outDir,
  };
}

export async function readFixture(fixturePath) {
  const resolved = resolve(fixturePath);
  const fixture = JSON.parse(await readFile(resolved, 'utf8'));
  if (fixture.fixture === undefined || fixture.seed === undefined || fixture.ticks === undefined) {
    throw new Error(`fixture must contain fixture, seed, and ticks: ${resolved}`);
  }
  if (!Number.isInteger(fixture.ticks) || fixture.ticks < 1) {
    throw new Error(`fixture ticks must be a positive integer: ${resolved}`);
  }
  if (!Array.isArray(fixture.input_segments) || fixture.input_segments.length === 0) {
    throw new Error(`fixture input_segments must be non-empty: ${resolved}`);
  }
  const segments = fixture.input_segments
    .map((segment) => ({
      start_tick: segment.start_tick,
      end_tick: segment.end_tick,
      input: { ...segment.input },
    }))
    .sort((a, b) => a.start_tick - b.start_tick);
  let cursor = 0;
  for (const segment of segments) {
    if (segment.start_tick !== cursor || segment.end_tick <= segment.start_tick) {
      throw new Error(`fixture segments must cover contiguous ticks from 0: ${resolved}`);
    }
    cursor = segment.end_tick;
  }
  if (cursor !== fixture.ticks) {
    throw new Error(`fixture segments end at ${cursor}, expected ${fixture.ticks}: ${resolved}`);
  }
  return { ...fixture, input_segments: segments, path: resolved };
}

export function inputAt(fixture, tick) {
  for (const segment of fixture.input_segments) {
    if (tick >= segment.start_tick && tick < segment.end_tick) return { ...segment.input };
  }
  throw new Error(`no fixture input for tick ${tick}`);
}

export function buildSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export { REPO_ROOT };
