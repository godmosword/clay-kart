#!/usr/bin/env node
/**
 * W3 contact sheet 生成器（BAR-VISUAL.md §1 / §3）。
 *
 * 12 組並排圖，每組左右各一張（ref / ours），左右與組序皆以種子打亂。
 * 對照表寫到 contact-sheet.key.json（*.key.json 已被 .gitignore 排除）。
 *
 * 配對（哪個元件對哪張 refs/clay 圖）是設計判斷——本腳本不猜測，
 * 只讀 manifest。缺圖用標籤 placeholder，缺配對則在報告裡標 unpaired。
 *
 * Usage:
 *   node tools/visual/contact-sheet.mjs \
 *     --out-dir loop/round-25/artifacts \
 *     [--manifest tools/visual/contact-sheet.manifest.json] \
 *     [--seed 42] \
 *     [--repo-root .]
 *
 * `--out-dir` 必填（R25）：舊預設 `loop/round-17/artifacts` 曾靜默覆寫
 * 已提交的歷史 artifact。
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const CELL = 512;
const PAIRS_PER_ROW = 2;
const PAIR_ROWS = 6; // 12 groups
const SHEET_W = CELL * 2 * PAIRS_PER_ROW; // 2048
const SHEET_H = CELL * PAIR_ROWS; // 3072
const BG = { r: 0x8a, g: 0x8a, b: 0x8a, alpha: 1 };

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST = resolve(HERE, 'contact-sheet.manifest.json');

function parseArgs(argv) {
  const out = {
    manifest: DEFAULT_MANIFEST,
    outDir: null,
    seed: null,
    repoRoot: resolve('.'),
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--manifest' && next) {
      out.manifest = resolve(next);
      i++;
    } else if (a === '--out-dir' && next) {
      out.outDir = resolve(next);
      i++;
    } else if (a === '--seed' && next) {
      out.seed = Number(next);
      i++;
    } else if (a === '--repo-root' && next) {
      out.repoRoot = resolve(next);
      i++;
    } else if (a === '--help' || a === '-h') {
      console.log(`Usage: node tools/visual/contact-sheet.mjs --out-dir <path> [options]
  --out-dir <path>    REQUIRED. write contact-sheet.png + contact-sheet.key.json
  --manifest <path>   pairing manifest (default: tools/visual/contact-sheet.manifest.json)
  --seed <int>        override manifest.seed
  --repo-root <path>  resolve relative image paths (default: cwd)`);
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${a}`);
    }
  }
  if (!out.outDir) {
    throw new Error(
      'missing required --out-dir <path> (refusing to default to a historical round artifacts dir)',
    );
  }
  return out;
}

/** Deterministic PRNG (mulberry32). Same seed → same shuffle. */
function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function resolvePath(repoRoot, p) {
  if (p == null || p === '') return null;
  return isAbsolute(p) ? p : resolve(repoRoot, p);
}

async function loadTile(path, label, kind) {
  if (path && (await exists(path))) {
    const buf = await sharp(path)
      .resize(CELL, CELL, { fit: 'cover', position: 'centre' })
      .removeAlpha()
      // `palette: false` 見下方合成處的長註解。**這裡也要**——每張 tile 在
      // 合成前就各自被量化過一次，所以只修合成那一段不夠：改完之後每個半邊
      // 仍然恰好卡在 256 色，就是被這一行壓的。
      .png({ palette: false, compressionLevel: 9 })
      .toBuffer();
    return { buf, source: 'file', path, placeholder: false };
  }
  // **佔位圖不得帶任何來源資訊。** R31 之前這裡印著 `${kind}`（`REF`／`OURS`）
  // 與元件名，等於把對照表直接畫進圖裡——`§1` 說「標籤對照表絕對不得進入
  // critic 的可讀範圍」，而 key 檔被 gitignore 的同時，同一份資訊從像素洩出來。
  //
  // R31 三個獨立 critic 全部讀到了它，其中一個把七格的 `ref`／`ours` 逐格
  // 列出來，**與 key 檔 7/7 完全相符**。單邊佔位的格子更糟：佔位那半邊的標籤
  // 用排除法直接指認另一半邊的來源。
  //
  // 現在佔位圖是一塊不帶字的灰底，`ref` 與 `ours` 的佔位圖**逐位元相同**。
  // 缺圖這件事 critic 本來就看得見，不需要也不應該告訴他是哪一邊缺。
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="${CELL}">
  <rect width="100%" height="100%" fill="#8a8a8a"/>
  <rect x="16" y="16" width="${CELL - 32}" height="${CELL - 32}" fill="none" stroke="#444" stroke-width="4" stroke-dasharray="12 8"/>
</svg>`;
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return { buf, source: 'placeholder', path: path ?? null, placeholder: true };
}

function escapeXml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function assertNoLeakedKeyMetadata(pngPath, keyBasename) {
  const meta = await sharp(pngPath).metadata();
  const blob = JSON.stringify(meta);
  if (blob.includes(keyBasename) || blob.includes('.key.json')) {
    throw new Error(`contact sheet metadata leaks key filename: ${blob.slice(0, 400)}`);
  }
  // sharp strips most text by default; still refuse if any text chunks mention paths we care about
  if (meta.exif || meta.iptc || meta.xmp) {
    throw new Error('contact sheet unexpectedly retained exif/iptc/xmp; refusing to ship');
  }
}

/**
 * 拒絕出貨被量化成調色盤的對比表。
 *
 * R17–R29 每一張表都是 colour type 3（256 色調色盤），沒有人發現，因為
 * 「有產出一張 2048×3072 的 PNG」這件事本身看起來完全正常。肇因是
 * `.png({ effort: 4 })`——sharp 的 `effort` 會順手把 `palette` 設成 true。
 *
 * 註解擋不住這種事：下一個人只要為了壓檔案大小再加一個選項，同樣的事就會
 * 再發生一次。所以直接讀回 IHDR 檢查 colour type。
 *
 * colour type 2 = truecolour RGB。3 = palette。
 */
async function assertNotPalettised(pngPath) {
  const buf = await readFile(pngPath);
  if (buf.length < 26 || buf.readUInt32BE(0) !== 0x89504e47) {
    throw new Error(`not a PNG: ${pngPath}`);
  }
  // 2 = truecolour RGB、6 = truecolour + alpha。兩者都是每通道 8 bit 的全彩，
  // 都可以接受。要擋的是 3（調色盤）與 0/4（灰階）。
  //
  // 第一版寫成 `!== 2`，實測直接把合法的 RGBA 擋下來——`palette: false` 之後
  // sharp 因為合成來源帶 alpha 而輸出 colour type 6。守衛太嚴會被下一個人
  // 順手放寬，那比沒有守衛更糟，所以判準要對準真正要擋的東西。
  const ACCEPTED = new Set([2, 6]);
  const colourType = buf.readUInt8(25);
  if (!ACCEPTED.has(colourType)) {
    throw new Error(
      `contact sheet must be truecolour (PNG colour type 2 or 6), got ${colourType}`
      + (colourType === 3
        ? '。調色盤量化會把算繪半邊壓到數十色，逼出抖動，而抖動看起來就是'
          + ' §6 禁止的程序化雜訊——評分因此評的是編碼器不是材質。'
        : ''),
    );
  }
}

/**
 * 拒絕出貨「容器是全彩、內容早就被量化」的對比表。
 *
 * `assertNotPalettised()` 只讀 IHDR 的 colour type——**它檢查的是容器**。
 * R32 就從那個縫隙漏過去了:我修掉 `contact-sheet.mjs` 的兩處量化，卻漏了
 * `ref-tiles.mjs`,於是參考半邊在被合成之前就各自壓成 256 色。最終合成圖是
 * RGBA,守衛照樣放行。
 *
 * 而且那比 R31 更糟。R31 是**兩邊同等**受害;單邊量化等於專門對其中一組製造
 * `§6`「程序化雜訊」的偽陽性——這次剛好偏向我們，下次可能反過來。
 *
 * 所以改成數實際的相異色。門檻取 300:算繪半邊實測 814–2697、參考半邊
 * 30k–50k,而任何一次 256 色量化都會落在 256 以下。純色佔位圖(2 色)排除。
 */
function assertHalvesNotQuantised(pixels, width, slots, cell) {
  const MIN_DISTINCT = 300;
  const problems = [];
  const countHalf = (x0, y0) => {
    const seen = new Set();
    for (let y = y0; y < y0 + cell; y += 2) {
      for (let x = x0; x < x0 + cell; x += 2) {
        const i = (y * width + x) * 3;
        seen.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
      }
    }
    return seen.size;
  };
  for (const slot of slots) {
    for (const [index, kind] of [slot.left, slot.right].entries()) {
      const placeholder = kind === 'ref' ? slot.refPlaceholder : slot.oursPlaceholder;
      if (placeholder) continue;
      const n = countHalf(slot.col * cell * 2 + index * cell, slot.row * cell);
      if (n < MIN_DISTINCT) {
        problems.push(`${slot.component} 的 ${kind} 半邊只有 ${n} 種顏色`);
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `對比表有半邊在合成前就被量化(門檻 ${MIN_DISTINCT} 色):\n  `
      + problems.join('\n  ')
      + '\n量化會逼出抖動,而抖動看起來就是 §6 禁止的程序化雜訊——'
      + '評分因此評的是編碼器不是材質。檢查產生那半邊的工具有沒有 palette 量化。',
    );
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const raw = JSON.parse(await readFile(args.manifest, 'utf8'));
  if (!Array.isArray(raw.components) || raw.components.length !== 12) {
    throw new Error(`manifest.components must list exactly 12 entries (BAR-VISUAL §4), got ${raw.components?.length}`);
  }

  const seed = Number.isFinite(args.seed) ? args.seed : Number(raw.seed ?? 0);
  if (!Number.isFinite(seed)) throw new Error('seed must be a finite number');

  const rand = mulberry32(seed >>> 0);
  const components = raw.components.map((c) => {
    if (!c?.id) throw new Error('each component needs id');
    return {
      id: String(c.id),
      ref: resolvePath(args.repoRoot, c.ref ?? null),
      ours: resolvePath(args.repoRoot, c.ours ?? null),
      note: c.note ?? null,
    };
  });

  // Shuffle group order, then independently flip left/right per group
  const order = shuffleInPlace(
    components.map((_, i) => i),
    rand,
  );

  const composites = [];
  const slots = [];
  const unpaired = [];

  for (let slot = 0; slot < order.length; slot++) {
    const comp = components[order[slot]];
    const refTile = await loadTile(comp.ref, comp.id, 'REF');
    const oursTile = await loadTile(comp.ours, comp.id, 'OURS');

    const refOnLeft = rand() < 0.5;
    const left = refOnLeft ? refTile : oursTile;
    const right = refOnLeft ? oursTile : refTile;

    const pair = await sharp({
      create: { width: CELL * 2, height: CELL, channels: 3, background: BG },
    })
      .composite([
        { input: left.buf, left: 0, top: 0 },
        { input: right.buf, left: CELL, top: 0 },
      ])
      .png()
      .toBuffer();

    composites.push(pair);

    const paired = Boolean(comp.ref && comp.ours && !refTile.placeholder && !oursTile.placeholder);
    if (!paired) {
      unpaired.push({
        id: comp.id,
        missingRef: !comp.ref || refTile.placeholder,
        missingOurs: !comp.ours || oursTile.placeholder,
        note: comp.note,
      });
    }

    const row = Math.floor(slot / PAIRS_PER_ROW);
    const col = slot % PAIRS_PER_ROW;
    slots.push({
      index: slot,
      row,
      col,
      component: comp.id,
      left: refOnLeft ? 'ref' : 'ours',
      right: refOnLeft ? 'ours' : 'ref',
      refPath: comp.ref ? relative(args.repoRoot, comp.ref) : null,
      oursPath: comp.ours ? relative(args.repoRoot, comp.ours) : null,
      refPlaceholder: refTile.placeholder,
      oursPlaceholder: oursTile.placeholder,
      paired,
    });
  }

  await mkdir(args.outDir, { recursive: true });
  const sheetPath = resolve(args.outDir, 'contact-sheet.png');
  const keyPath = resolve(args.outDir, 'contact-sheet.key.json');

  const compositesForSheet = composites.map((input, slot) => ({
    input,
    left: (slot % PAIRS_PER_ROW) * CELL * 2,
    top: Math.floor(slot / PAIRS_PER_ROW) * CELL,
  }));

  // Do not call keepMetadata / withMetadata — default encode strips EXIF/IPTC/XMP.
  // Never embed filenames or key paths into the PNG.
  // **`palette: false` 是必要的，不是預設。**
  //
  // 這裡原本是 `.png({ effort: 4 })`。sharp 的文件寫明 `effort` 這個選項
  // **會把 `palette` 設成 true**——一個看起來只調 CPU 用量的參數，把 R17 以來
  // 每一張對比表都量化成 256 色。
  //
  // 24 個半邊共用那 256 色，實測我們的算繪半邊被壓成：
  //
  //     track-barriers  1475 個相異色 → 24
  //     foliage         4025          → 62
  //
  // 而黏土渲染的全部重點就是壓痕的細微明暗。壓成二十幾色之後只能靠**抖動**
  // 近似漸層，而那個抖動看起來就是 `§6` 禁止的「程序化雜訊當表面細節」。
  // R31 有兩個 critic 因此把我們的半邊判到 2 分，理由寫的是「亂數點噪」。
  //
  // 不對稱在於：參考半邊是高對比高飽和的實拍照片，量化後幾乎無損。
  // **這張表因此系統性地摧毀了它自己要評的那個性質，而且只摧毀一邊。**
  const cleaned = await sharp({
    create: { width: SHEET_W, height: SHEET_H, channels: 3, background: BG },
  })
    .composite(compositesForSheet)
    .png({ palette: false, compressionLevel: 9 })
    .toBuffer();
  await writeFile(sheetPath, cleaned);
  await assertNoLeakedKeyMetadata(sheetPath, 'contact-sheet.key.json');
  await assertNotPalettised(sheetPath);
  // 容器檢查完再檢查內容——R32 證明前者攔不住後者。
  const { data: sheetPixels, info: sheetInfo } = await sharp(cleaned)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assertHalvesNotQuantised(sheetPixels, sheetInfo.width, slots, CELL);

  const sheetHash = createHash('sha256').update(cleaned).digest('hex');
  const key = {
    version: 1,
    seed,
    sheet: {
      width: SHEET_W,
      height: SHEET_H,
      cell: CELL,
      pairsPerRow: PAIRS_PER_ROW,
      sha256: sheetHash,
      // intentionally NO absolute paths; relative only inside key (gitignored)
      file: 'contact-sheet.png',
    },
    warning:
      'CRITIC MUST NOT READ THIS FILE. Pairing labels live only here. Contact sheet PNG has no labels.',
    slots,
    unpaired,
    generatedAt: new Date().toISOString(),
  };

  await writeFile(keyPath, `${JSON.stringify(key, null, 2)}\n`, 'utf8');

  const pairedCount = slots.filter((s) => s.paired).length;
  console.log(
    JSON.stringify(
      {
        ok: true,
        sheet: sheetPath,
        key: keyPath,
        seed,
        paired: pairedCount,
        unpaired: unpaired.length,
        unpairedIds: unpaired.map((u) => u.id),
        sha256: sheetHash,
      },
      null,
      2,
    ),
  );

  if (unpaired.length > 0) {
    console.error(
      `\n[contact-sheet] ${unpaired.length}/12 groups lack a real ref↔ours pair. ` +
        `Script ran with placeholders. Pairing is a Lead decision — see loop/BACKLOG.md (R17).`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
