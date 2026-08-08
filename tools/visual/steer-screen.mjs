#!/usr/bin/env node
/**
 * 轉向螢幕空間回歸（R20 缺陷）＋多車可轉（R28／R33）。
 *
 * R33 裁決：這不是「單車 vs 多車」二選一——那是假選擇。一組斷言不該同時
 * 扛兩個對餘裕要求相反的目的，所以拆成兩條：
 *
 *   1. solo（`?solo=1`）：方向沒接反——契約回歸，預期 rate ~5、餘裕很厚
 *   2. multi（預設 bootstrap AI）：多車下玩家仍轉得動——貼門檻是誠實的
 *
 * 兩邊都用同一門檻 RATE_THRESHOLD=0.5；不要為了讓 multi 餘裕變厚去動物理
 * 或改門檻。把 rate 實測值印出來——薄餘裕看得見才不會靜靜漂。
 *
 * Usage:
 *   npm run build && node tools/visual/steer-screen.mjs
 *   npm run test:steer-screen
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

/** 目標模擬持鍵時長（秒，讀 probe.t）。牆鐘只當上限，不斷言牆鐘位移。 */
const TARGET_SIM_SECONDS = 0.45;
/**
 * 牆鐘等待上限——超過仍拿不到足夠 simDt 就失敗（模擬卡住）。
 * R28 接上 3 台 AI 後 SwiftShader 負載變高；8s 偶發只推進 ~0.2s sim。
 * 門檻仍看 simDt，加長只是給慢機器更多牆鐘，不放寬轉向斷言。
 */
const MAX_WALL_WAIT_MS = 20_000;
/**
 * 每模擬秒的橫向位移門檻（世界單位 / 模擬秒）。
 * solo 預期 ~5；multi 貼門檻（~0.8）是誠實的——兩邊共用同一數字。
 */
const RATE_THRESHOLD = 0.5;

const SCENARIOS = [
  {
    id: 'solo',
    query: 'solo=1',
    purpose: 'direction-contract',
    note: '單車：R20 轉向接反回歸；預期 rate ~5、餘裕很厚',
    /** POS 分母——單車場上只有玩家 */
    expectPosField: 1,
  },
  {
    id: 'multi',
    query: '',
    purpose: 'multi-kart-still-steers',
    note: '多車：玩家真實場景仍轉得動；貼門檻是誠實的',
    expectPosField: 4,
  },
];

const KEY_CODES = {
  ArrowUp: 38,
  ArrowLeft: 37,
  ArrowRight: 39,
};

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
  throw new Error('no Chrome/Chromium for steer-screen harness');
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

async function keyDown(session, code) {
  await session.call('Input.dispatchKeyEvent', {
    type: 'keyDown',
    code,
    key: code,
    windowsVirtualKeyCode: KEY_CODES[code],
    nativeVirtualKeyCode: KEY_CODES[code],
  });
}

async function keyUp(session, code) {
  await session.call('Input.dispatchKeyEvent', {
    type: 'keyUp',
    code,
    key: code,
    windowsVirtualKeyCode: KEY_CODES[code],
    nativeVirtualKeyCode: KEY_CODES[code],
  });
}

async function readProbe(session) {
  const result = await session.call('Runtime.evaluate', {
    expression: `(() => {
      const p = window.__CLAY_STEER_PROBE__;
      if (!p) return null;
      return p.latest();
    })()`,
    returnByValue: true,
  });
  return result?.result?.value ?? null;
}

async function readPosText(session) {
  const result = await session.call('Runtime.evaluate', {
    expression: `(() => {
      const values = [...document.querySelectorAll('[data-role="clay-hud-value"]')];
      // LAP TIME POS BEST —— POS 是第 3 個
      return (values[2]?.textContent || '').trim();
    })()`,
    returnByValue: true,
  });
  return result?.result?.value ?? '';
}

function screenLateral(start, end) {
  const dx = end.pos[0] - start.pos[0];
  const dy = end.pos[1] - start.pos[1];
  const dz = end.pos[2] - start.pos[2];
  const [rx, ry, rz] = start.camRight;
  return dx * rx + dy * ry + dz * rz;
}

/** 等到 probe.t 相對 baseline 至少前進 minDelta（確認 rAF／模擬在跑）。 */
async function waitForSimTick(session, baselineT, minDelta = 0.05, wallMs = MAX_WALL_WAIT_MS) {
  const deadline = Date.now() + wallMs;
  while (Date.now() < deadline) {
    const sample = await readProbe(session);
    if (sample?.pos && typeof sample.t === 'number' && sample.t - baselineT >= minDelta) {
      return sample;
    }
    await sleep(50);
  }
  throw new Error(
    `sim clock stalled (baseline t=${baselineT}, need +${minDelta} within ${wallMs}ms)`,
  );
}

async function runTrial(session, steerKey) {
  await keyDown(session, 'ArrowUp');
  await sleep(400);

  let start = null;
  for (let i = 0; i < 50; i++) {
    start = await readProbe(session);
    if (start?.pos && typeof start.t === 'number') break;
    await sleep(50);
  }
  if (!start?.pos || typeof start.t !== 'number') {
    throw new Error('steer probe never became ready');
  }
  start = await waitForSimTick(session, start.t, 0.05);

  await keyDown(session, steerKey);

  const deadline = Date.now() + MAX_WALL_WAIT_MS;
  let end = start;
  while (Date.now() < deadline) {
    await sleep(50);
    const sample = await readProbe(session);
    if (!sample?.pos || typeof sample.t !== 'number') continue;
    end = sample;
    if (end.t - start.t >= TARGET_SIM_SECONDS) break;
  }

  await keyUp(session, steerKey);
  await keyUp(session, 'ArrowUp');
  await sleep(100);

  const simDt = end.t - start.t;
  if (!(simDt >= TARGET_SIM_SECONDS * 0.8)) {
    throw new Error(
      `sim time did not advance enough under ${steerKey}: simDt=${simDt} (need ≥ ${TARGET_SIM_SECONDS * 0.8})`,
    );
  }
  const lateral = screenLateral(start, end);
  const rate = lateral / simDt;
  const yawDelta = end.yaw - start.yaw;
  return { steerKey, lateral, rate, simDt, yawDelta };
}

function gameUrl(port, scenarioQuery) {
  const params = new URLSearchParams({ steerProbe: '1' });
  if (scenarioQuery) {
    for (const part of scenarioQuery.split('&')) {
      if (!part) continue;
      const [k, v] = part.split('=');
      params.set(k, v ?? '');
    }
  }
  return `http://127.0.0.1:${port}/index.html?${params.toString()}`;
}

async function waitReady(session, url) {
  await session.call('Page.navigate', { url });
  let readyProbe = null;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    readyProbe = await readProbe(session);
    if (readyProbe?.pos && typeof readyProbe.t === 'number') break;
    await sleep(100);
  }
  if (!readyProbe?.pos || typeof readyProbe.t !== 'number') {
    throw new Error(`probe not ready for ${url}`);
  }
  await waitForSimTick(session, readyProbe.t, 0.05);
}

async function runScenario(session, port, scenario) {
  const url = gameUrl(port, scenario.query);
  const trials = [];
  for (const steerKey of ['ArrowRight', 'ArrowLeft']) {
    await waitReady(session, url);
    trials.push(await runTrial(session, steerKey));
  }

  const right = trials.find((t) => t.steerKey === 'ArrowRight');
  const left = trials.find((t) => t.steerKey === 'ArrowLeft');
  if (!right || !left) throw new Error(`${scenario.id}: missing trials`);

  // 重載一次確認場上車數（POS 分母）對得上場景
  await waitReady(session, url);
  await sleep(200);
  const posText = await readPosText(session);

  const failures = [];
  if (!(right.rate > RATE_THRESHOLD)) {
    failures.push(
      `${scenario.id}/ArrowRight: expected lateral/simDt > ${RATE_THRESHOLD}, got ${right.rate.toFixed(4)} ` +
        `(lateral=${right.lateral.toFixed(4)}, simDt=${right.simDt.toFixed(4)}, yawΔ=${right.yawDelta.toFixed(4)})`,
    );
  }
  if (!(left.rate < -RATE_THRESHOLD)) {
    failures.push(
      `${scenario.id}/ArrowLeft: expected lateral/simDt < ${-RATE_THRESHOLD}, got ${left.rate.toFixed(4)} ` +
        `(lateral=${left.lateral.toFixed(4)}, simDt=${left.simDt.toFixed(4)}, yawΔ=${left.yawDelta.toFixed(4)})`,
    );
  }
  if (!(Math.sign(right.rate) === 1 && Math.sign(left.rate) === -1)) {
    failures.push(
      `${scenario.id}: expected opposite screen rate signs, got right=${right.rate.toFixed(4)} left=${left.rate.toFixed(4)}`,
    );
  }
  const fieldMatch = String(posText).match(/^\d+\/(\d+)$/);
  const field = fieldMatch ? Number(fieldMatch[1]) : null;
  if (field !== scenario.expectPosField) {
    failures.push(
      `${scenario.id}: POS field want ${scenario.expectPosField}, got ${JSON.stringify(posText)} ` +
        `(solo 應 1/1、multi 應 n/4——確認 ?solo=1 有關掉 AI）`,
    );
  }

  return {
    id: scenario.id,
    purpose: scenario.purpose,
    note: scenario.note,
    pos: posText,
    right: { rate: right.rate, lateral: right.lateral, simDt: right.simDt, yawDelta: right.yawDelta },
    left: { rate: left.rate, lateral: left.lateral, simDt: left.simDt, yawDelta: left.yawDelta },
    failures,
  };
}

async function main() {
  const { server, port } = await startStaticServer();
  const chromePath = await findChrome();
  const userDataDir = await mkdtemp(join(tmpdir(), 'clay-kart-steer-screen-'));

  const child = spawn(
    chromePath,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-extensions',
      '--disable-background-networking',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--window-size=1280,720',
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
      width: 1280,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const scenarios = [];
    for (const scenario of SCENARIOS) {
      scenarios.push(await runScenario(session, port, scenario));
    }

    if (session.pageErrors.length > 0) {
      throw new Error(`page reported errors:\n  ${session.pageErrors.join('\n  ')}`);
    }

    const failures = scenarios.flatMap((s) => s.failures);
    const byId = Object.fromEntries(
      scenarios.map((s) => [
        s.id,
        {
          purpose: s.purpose,
          note: s.note,
          pos: s.pos,
          right: s.right,
          left: s.left,
        },
      ]),
    );

    const report = {
      ok: failures.length === 0,
      rateThreshold: RATE_THRESHOLD,
      targetSimSeconds: TARGET_SIM_SECONDS,
      ...byId,
      failures,
    };
    console.log(JSON.stringify(report, null, 2));
    if (failures.length > 0) {
      console.error('\nsteer-screen regression: FAIL');
      for (const f of failures) console.error(' -', f);
      process.exitCode = 1;
    } else {
      console.error('\nsteer-screen regression: PASS (solo direction + multi still-steers)');
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
