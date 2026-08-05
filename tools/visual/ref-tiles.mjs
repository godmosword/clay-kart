#!/usr/bin/env node
/**
 * 把 `ref-pairing.json` 的裁決算成 contact sheet 可以直接吃的參考半邊。
 *
 * `contact-sheet.mjs` 的 `ref` 只吃一個檔案路徑,沒有裁切概念;而 `refs/clay/`
 * 幾乎都是整場景合成圖,元件級的參考半邊必須先裁出來。所以裁切這一步放在
 * 這裡,`contact-sheet.mjs` 一行都不用改 —— 那支是 ck-plumb 在 R17 建立的,
 * 共用目錄不代表可以互改(R18 裁決)。
 *
 * 這支腳本做三件 `contact-sheet.mjs` 不該做的事:
 *
 * 1. **裁切**:座標來自 Lead 裁決,不是腳本猜的
 * 2. **壓平 alpha 到中性灰**:`cloud-a.png` 有透明背景,直接 `removeAlpha()`
 *    會得到未定義的底色,`§3` 要求的是 `#8a8a8a` 無漸層
 * 3. **擋放大**:來源不足 512² 就放大會糊,糊掉的那一半 critic 一眼就分得出來
 *    不是同一個來源 —— 那會讓盲測失去意義。超過 `max_upscale` 直接失敗,
 *    不悄悄交出一張糊圖
 *
 * Usage:
 *   node tools/visual/ref-tiles.mjs [--pairing <json>] [--out build/visual/refs] [--repo-root .]
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const DEFAULT_PAIRING = resolve(HERE, 'ref-pairing.json');

function parseArgs(argv) {
  const options = {
    pairing: DEFAULT_PAIRING,
    outDir: resolve(REPO_ROOT, 'build/visual/refs'),
    repoRoot: REPO_ROOT,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--pairing' && next) {
      options.pairing = resolve(next);
      i += 1;
    } else if (arg === '--out' && next) {
      options.outDir = resolve(next);
      i += 1;
    } else if (arg === '--repo-root' && next) {
      options.repoRoot = resolve(next);
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node tools/visual/ref-tiles.mjs [--pairing <json>] [--out <dir>] [--repo-root <dir>]',
      );
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${arg}`);
    }
  }
  return options;
}

function resolveSource(repoRoot, path) {
  return isAbsolute(path) ? path : resolve(repoRoot, path);
}

async function main() {
  const options = parseArgs(process.argv);
  const pairing = JSON.parse(await readFile(options.pairing, 'utf8'));
  const tileSize = Number(pairing.tile_size ?? 512);
  const maxUpscale = Number(pairing.max_upscale ?? 1.4);
  const background = pairing.background ?? '#8a8a8a';

  if (!Array.isArray(pairing.components) || pairing.components.length !== 12) {
    throw new Error(
      `pairing must list exactly 12 components (BAR-VISUAL §4), got ${pairing.components?.length}`,
    );
  }

  await mkdir(options.outDir, { recursive: true });

  const written = [];
  const deferred = [];

  for (const entry of pairing.components) {
    if (!entry?.id) throw new Error('each component needs an id');
    if (entry.deferred) {
      deferred.push({ id: entry.id, reason: entry.deferred });
      continue;
    }
    if (!entry.source) throw new Error(`${entry.id}: needs either source or deferred`);

    const sourcePath = resolveSource(options.repoRoot, entry.source);
    const image = sharp(sourcePath);
    const metadata = await image.metadata();

    let pipeline = image;
    let sourceEdge = Math.min(metadata.width, metadata.height);

    if (entry.crop) {
      const { x, y, size } = entry.crop;
      if (x + size > metadata.width || y + size > metadata.height) {
        throw new Error(
          `${entry.id}: crop ${x},${y},${size} falls outside ${metadata.width}×${metadata.height}`,
        );
      }
      pipeline = pipeline.extract({ left: x, top: y, width: size, height: size });
      sourceEdge = size;
    }

    const upscale = tileSize / sourceEdge;
    if (upscale > maxUpscale) {
      throw new Error(
        `${entry.id}: source edge ${sourceEdge}px would upscale ${upscale.toFixed(2)}× to ` +
          `${tileSize}px (limit ${maxUpscale}×). A blurry reference half is worse than none — ` +
          `pick another source or mark the group deferred.`,
      );
    }

    const buffer = await pipeline
      // 先壓平再縮放:縮放會把透明邊緣跟未定義底色混在一起。
      .flatten({ background })
      .resize(tileSize, tileSize, { fit: 'cover', position: 'centre' })
      .png({ effort: 4 })
      .toBuffer();

    const file = join(options.outDir, `${entry.id}.png`);
    await writeFile(file, buffer);
    written.push({
      id: entry.id,
      source: entry.source,
      crop: entry.crop ?? null,
      sourceEdge,
      scale: Number(upscale.toFixed(3)),
    });
  }

  const report = {
    generated_by: 'tools/visual/ref-tiles.mjs',
    bar_ref: 'BAR-VISUAL.md §7.1',
    tile_size: tileSize,
    background,
    paired: written,
    deferred,
  };
  await writeFile(join(options.outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir: options.outDir,
        paired: written.map((entry) => entry.id),
        deferred: deferred.map((entry) => entry.id),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(String(error.message ?? error));
  process.exit(1);
});
