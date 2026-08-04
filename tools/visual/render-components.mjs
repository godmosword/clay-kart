#!/usr/bin/env node
/**
 * W3 元件拍攝驅動器（`BAR-VISUAL §3`）。
 *
 * 把 `src/render/components/` 登記的元件用 `src/render/clay/` 的共用拍攝台
 * 算繪成規範圖，輸出到 `build/visual/`：
 *
 *   build/visual/<id>.png              contact sheet 用的 2×2 合成格
 *   build/visual/<id>.<view>.png       §3 的四角度細看圖
 *   build/visual/manifest.json         這次拍了什麼、哪些還沒實作
 *
 * 為什麼要 headless 瀏覽器：three.js 要 WebGL，Node 裡沒有。R16 的
 * `tools/telemetry/perf-probe.mjs` 已經證實 raw CDP + headless Chrome 這條
 * 路可行且不必新增 npm 依賴，這裡沿用同一套做法。
 *
 * 為什麼自己用 vite Node API 建一份臨時 bundle：元件程式碼是 TS 且用了
 * `@render` alias，瀏覽器不能直接吃。不動 `vite.config.ts`（那是 ck-plumb
 * 的範圍）也不動主應用的 build 產物，只在 temp 目錄裡建一份自己用的。
 *
 * Usage:
 *   node tools/visual/render-components.mjs [--out build/visual] [--only kart-body]
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');

function parseArgs(argv) {
  const options = { outDir: resolve(REPO_ROOT, 'build/visual'), only: null, diagnose: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--out' && next) {
      options.outDir = resolve(next);
      i += 1;
    } else if (arg === '--only' && next) {
      options.only = next;
      i += 1;
    } else if (arg === '--diagnose') {
      options.diagnose = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node tools/visual/render-components.mjs [--out <dir>] [--only <id>] [--diagnose]',
      );
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${arg}`);
    }
  }
  return options;
}

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
      // next candidate
    }
  }
  throw new Error('no Chrome/Chromium executable available for the component render harness');
}

/**
 * 建一份只給 harness 用的臨時 bundle。
 * 入口在 temp 目錄，但 root 指向 repo，才能解析 `src/` 與 node_modules。
 */
async function buildHarnessBundle(only) {
  const { build } = await import('vite');
  const stageDir = await mkdtemp(join(tmpdir(), 'clay-kart-r18-visual-'));
  const entryPath = join(stageDir, 'entry.js');
  const filter = only ? JSON.stringify(only) : 'null';

  await writeFile(
    entryPath,
    `import { captureComponent } from ${JSON.stringify(resolve(REPO_ROOT, 'src/render/clay/capture.ts'))};
import { COMPONENTS } from ${JSON.stringify(resolve(REPO_ROOT, 'src/render/components/registry.ts'))};
import { selfTestGlobalBanAuditor, violatesGlobalBans } from ${JSON.stringify(resolve(REPO_ROOT, 'src/render/clay/material.ts'))};

const only = ${filter};

/**
 * BAR-VISUAL §6 全域禁令的實際檢查。寫了驗證函式卻不跑，跟寫在文件裡
 * 沒有機制擋是一樣的——這裡對每個元件的每個材質都跑一次。
 */
function auditGlobalBans(id, group) {
  const findings = [];
  const seen = new Set();
  group.traverse((child) => {
    if (!child.isMesh || !child.material || seen.has(child.material)) return;
    seen.add(child.material);
    const violations = violatesGlobalBans(child.material);
    if (violations.length > 0) {
      findings.push({ component: id, mesh: child.name || '(unnamed)', violations });
    }
  });
  return findings;
}

async function run() {
  // 先確認稽核本身有效，再相信它對元件材質的判斷。
  const auditorSelfTestCases = selfTestGlobalBanAuditor();
  const captures = [];
  const skipped = [];
  const banViolations = [];
  let materialsAudited = 0;
  for (const entry of COMPONENTS) {
    if (only && entry.id !== only) continue;
    if (!entry.create) {
      // 未實作要明確標記，不能靜靜消失——「還沒做」跟「做了沒過」必須分得出來。
      skipped.push({ id: entry.id, scope: entry.scope, reason: 'not_implemented' });
      continue;
    }
    const group = entry.create();
    const seen = new Set();
    group.traverse((child) => {
      if (child.isMesh && child.material && !seen.has(child.material)) seen.add(child.material);
    });
    materialsAudited += seen.size;
    banViolations.push(...auditGlobalBans(entry.id, group));
    captures.push(await captureComponent(entry.id, group));
  }
  return { captures, skipped, banViolations, materialsAudited, auditorSelfTestCases };
}

// 診斷：貼圖是否真的有起伏、mesh 是否真的有 uv。
// 「圖算出來了但表面是平的」有好幾種可能原因（貼圖太平、缺 uv、取樣參數
// 錯），用看圖反推很慢，直接把事實印出來。
window.__R18_DIAG__ = (async () => {
  const { getClayTextures } = await import(${JSON.stringify(resolve(REPO_ROOT, 'src/render/clay/texture.ts'))});
  const { normalMap, roughnessMap } = getClayTextures(1);
  const stat = (texture, channel) => {
    const data = texture.image.data;
    let min = 255;
    let max = 0;
    let total = 0;
    for (let i = channel; i < data.length; i += 4) {
      const v = data[i];
      if (v < min) min = v;
      if (v > max) max = v;
      total += v;
    }
    return { min, max, mean: Math.round(total / (data.length / 4)) };
  };
  const geometryReport = [];
  for (const entry of COMPONENTS) {
    if (!entry.create) continue;
    const group = entry.create();
    let withUv = 0;
    let withoutUv = 0;
    group.traverse((child) => {
      if (!child.isMesh) return;
      if (child.geometry.getAttribute('uv')) withUv += 1;
      else withoutUv += 1;
    });
    geometryReport.push({ id: entry.id, meshesWithUv: withUv, meshesWithoutUv: withoutUv });
  }
  return {
    normalMap: { r: stat(normalMap, 0), g: stat(normalMap, 1), b: stat(normalMap, 2) },
    roughnessMap: { g: stat(roughnessMap, 1) },
    geometry: geometryReport,
  };
})();

window.__R18_VISUAL__ = run().then(
  (result) => ({ ok: true, ...result }),
  (error) => ({ ok: false, error: String(error && error.stack ? error.stack : error) }),
);
`,
    'utf8',
  );

  await writeFile(
    join(stageDir, 'index.html'),
    '<!doctype html><meta charset="utf-8"><title>clay-kart visual harness</title><script type="module" src="./entry.js"></script>',
    'utf8',
  );

  const outDir = join(stageDir, 'dist');
  await build({
    root: stageDir,
    logLevel: 'error',
    resolve: {
      alias: {
        '@contract': resolve(REPO_ROOT, 'src/contract'),
        '@physics': resolve(REPO_ROOT, 'src/physics'),
        '@render': resolve(REPO_ROOT, 'src/render'),
        '@ui': resolve(REPO_ROOT, 'src/ui'),
        '@loader': resolve(REPO_ROOT, 'src/loader'),
      },
    },
    build: { outDir, target: 'es2022', emptyOutDir: true, sourcemap: false },
  });

  return { stageDir, serveRoot: outDir };
}

function mimeType(path) {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'application/octet-stream';
}

async function startStaticServer(serveRoot) {
  const server = createServer(async (request, response) => {
    try {
      const requested = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
      const filePath = resolve(serveRoot, relative);
      if (filePath !== serveRoot && !filePath.startsWith(`${serveRoot}${sep}`)) {
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
      // Chrome still starting
    }
    await sleep(100);
  }
  throw new Error('Chrome exposed no page target');
}

class CdpSession {
  #socket;
  #nextId = 0;
  #pending = new Map();

  /**
   * 頁面端的錯誤與例外。WebGL shader 編譯失敗只會在這裡出聲——不收的話
   * 症狀是「圖片算出來了但物件是空的」，得靠看圖反推，很花時間。
   */
  pageErrors = [];

  /** 警告分開收：值得看到，但不該讓一次好的算繪整個失敗。 */
  pageWarnings = [];

  constructor(url) {
    this.#socket = new WebSocket(url);
    this.#socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.consoleAPICalled') {
        const type = message.params?.type;
        if (type === 'error' || type === 'warning') {
          const text = (message.params.args ?? [])
            .map((arg) => arg.value ?? arg.description ?? '')
            .join(' ');
          if (text.trim()) {
            const line = `console.${type}: ${text}`;
            if (type === 'error') this.pageErrors.push(line);
            else this.pageWarnings.push(line);
          }
        }
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

async function writeDataUrl(path, dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(base64, 'base64'));
}

async function main() {
  const options = parseArgs(process.argv);
  const { stageDir, serveRoot } = await buildHarnessBundle(options.only);
  const { server, port } = await startStaticServer(serveRoot);
  const chromePath = await findChrome();
  const userDataDir = await mkdtemp(join(tmpdir(), 'clay-kart-r18-chrome-'));

  const child = spawn(
    chromePath,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-extensions',
      '--disable-background-networking',
      // SwiftShader：CI 上沒有 GPU 也要拍得出來，且結果跨機器一致。
      '--use-gl=angle',
      '--use-angle=swiftshader',
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
    await session.call('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });

    // Page.navigate 在模組執行完之前就回來了，所以要等 global 真的出現。
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const probe = await session.call('Runtime.evaluate', {
        expression: 'typeof window.__R18_VISUAL__ !== "undefined"',
        returnByValue: true,
      });
      if (probe?.result?.value === true) {
        ready = true;
        break;
      }
      await sleep(100);
    }
    if (!ready) throw new Error('harness page never initialised __R18_VISUAL__');

    if (options.diagnose) {
      const diagnostics = await session.call('Runtime.evaluate', {
        expression: 'window.__R18_DIAG__',
        awaitPromise: true,
        returnByValue: true,
      });
      console.error(JSON.stringify(diagnostics?.result?.value ?? null, null, 2));
    }

    const result = await session.call('Runtime.evaluate', {
      expression: 'window.__R18_VISUAL__',
      awaitPromise: true,
      returnByValue: true,
    });
    const payload = result?.result?.value;
    if (!payload) throw new Error('harness page returned nothing');
    if (!payload.ok) throw new Error(`harness failed in page: ${payload.error}`);
    if (session.pageErrors.length > 0) {
      // shader 編譯失敗這類問題不會讓 capture 拋錯，只會讓物件默默不算繪——
      // 讓它直接失敗，不要交出一張看似成功的空圖。
      throw new Error(`page reported errors:\n  ${session.pageErrors.join('\n  ')}`);
    }
    for (const warning of session.pageWarnings) {
      console.error(`[render-components] ${warning}`);
    }
    if (payload.banViolations?.length > 0) {
      // §6 是全域禁令，不是建議。違反就不該產出可以送 critic 的圖。
      throw new Error(
        `BAR-VISUAL §6 violations:\n${payload.banViolations
          .map((finding) => `  ${finding.component}: ${finding.violations.join('; ')}`)
          .join('\n')}`,
      );
    }

    await mkdir(options.outDir, { recursive: true });
    const written = [];
    for (const capture of payload.captures) {
      await writeDataUrl(join(options.outDir, `${capture.id}.png`), capture.sheetCell);
      const views = [];
      for (const [view, dataUrl] of Object.entries(capture.views)) {
        const file = `${capture.id}.${view}.png`;
        await writeDataUrl(join(options.outDir, file), dataUrl);
        views.push(file);
      }
      written.push({ id: capture.id, sheetCell: `${capture.id}.png`, views });
    }

    const manifest = {
      generated_by: 'tools/visual/render-components.mjs',
      bar_ref: 'BAR-VISUAL.md §3',
      view_size: 512,
      sheet_cell_note: '512×512 composed of the four §3 views at 256×256 each (R18 decision)',
      global_bans_audited: {
        ref: 'BAR-VISUAL.md §6',
        materials_checked: payload.materialsAudited ?? 0,
        auditor_self_test_cases: payload.auditorSelfTestCases ?? 0,
        violations: payload.banViolations ?? [],
      },
      rendered: written,
      not_implemented: payload.skipped,
    };
    await writeFile(
      join(options.outDir, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          outDir: options.outDir,
          rendered: written.map((entry) => entry.id),
          notImplemented: payload.skipped.map((entry) => entry.id),
        },
        null,
        2,
      ),
    );
  } finally {
    session?.close();
    child.kill('SIGTERM');
    await new Promise((done) => child.once('exit', done));
    await new Promise((done) => server.close(done));
    await rm(userDataDir, { recursive: true, force: true });
    await rm(stageDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
