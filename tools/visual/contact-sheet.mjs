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
 *     [--manifest tools/visual/contact-sheet.manifest.json] \
 *     [--out-dir loop/round-17/artifacts] \
 *     [--seed 42] \
 *     [--repo-root .]
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
    outDir: resolve('loop/round-17/artifacts'),
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
      console.log(`Usage: node tools/visual/contact-sheet.mjs [options]
  --manifest <path>   pairing manifest (default: tools/visual/contact-sheet.manifest.json)
  --out-dir <path>    write contact-sheet.png + contact-sheet.key.json
  --seed <int>        override manifest.seed
  --repo-root <path>  resolve relative image paths (default: cwd)`);
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${a}`);
    }
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
      .png({ effort: 4 })
      .toBuffer();
    return { buf, source: 'file', path, placeholder: false };
  }
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="${CELL}">
  <rect width="100%" height="100%" fill="#8a8a8a"/>
  <rect x="16" y="16" width="${CELL - 32}" height="${CELL - 32}" fill="none" stroke="#444" stroke-width="4" stroke-dasharray="12 8"/>
  <text x="50%" y="42%" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#222">${escapeXml(kind)}</text>
  <text x="50%" y="54%" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#222">${escapeXml(label)}</text>
  <text x="50%" y="66%" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#555">placeholder</text>
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
  const cleaned = await sharp({
    create: { width: SHEET_W, height: SHEET_H, channels: 3, background: BG },
  })
    .composite(compositesForSheet)
    .png({ effort: 4 })
    .toBuffer();
  await writeFile(sheetPath, cleaned);
  await assertNoLeakedKeyMetadata(sheetPath, 'contact-sheet.key.json');

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
