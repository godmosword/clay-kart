#!/usr/bin/env node

/**
 * Lead 專用整合工具。**只有 Lead 跑這支，builder 不要用。**
 *
 * ## 為什麼需要它
 *
 * R33 一個 session 內，git ref 被互相覆蓋了四次：
 *
 * 1. Lead 把 `ck-plumb` 同步到 main → Cursor `reset` 回 `origin/feat/plumb`
 *    把同步退掉，在落後 20 個 commit 的舊樹上完成整個任務
 * 2. Lead 第三次同步時 `reset --hard main`，**把 Cursor 的 commit 從分支上踩掉**
 *    （靠 reflog 才救回來）
 * 3. Lead 在 builder 的 worktree 目錄裡跑 `merge feat/visual`，等於自己併自己，
 *    整個 commit 沒進 main 而當下沒發現
 * 4. Codex `rebase` 重寫了 Lead 的四個 commit，過程中**掉了一個 355KB 的
 *    評審材料 PNG**——直接 merge 會把它從 main 刪掉
 *
 * 四次全部被抓到、全部救回、零遺失。但那是運氣加上每次都剛好有人在看。
 *
 * ## 它擋什麼（規則擋不住的那部分）
 *
 * 寫規則的問題是 agent 不讀，這個 session 已經證明過一次。所以改成一支
 * **會失敗**的腳本：檔案消失就中止，歷史被重寫就警告，不在 main 的 worktree
 * 裡跑就中止。失敗比被忽略的規則可靠。
 *
 * ## 用法
 *
 *   node tools/lead/integrate.mjs --branch feat/physics --dry-run
 *   node tools/lead/integrate.mjs --branch feat/physics --commits 3bff7bf,0b42880
 *   node tools/lead/integrate.mjs --branch feat/visual        # 線性就 ff-only
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const REPO = resolve(process.argv[2] === '--repo' ? process.argv[3] : '.');

function git(...args) {
  return execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' }).trim();
}

function parseArgs(argv) {
  const out = { branch: null, commits: null, dryRun: false, allowDelete: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--branch' && next) { out.branch = next; i++; }
    else if (a === '--commits' && next) { out.commits = next.split(',').map((s) => s.trim()).filter(Boolean); i++; }
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--allow-delete') out.allowDelete = true;
    else if (a === '--repo') i++;
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!out.branch) { usage(); throw new Error('missing required --branch'); }
  return out;
}

function usage() {
  console.log(`Usage: node tools/lead/integrate.mjs --branch <branch> [options]
  --branch <name>     REQUIRED. builder 分支，例如 feat/physics
  --commits a,b,c     只 cherry-pick 這幾個（分支被 rebase 過時用）
  --dry-run           只報告，不動任何 ref
  --allow-delete      允許整合刪檔（預設中止；請在訊息裡寫明理由）
  --repo <path>       倉庫路徑（預設 cwd）`);
}

/** 某個 tree 底下所有檔案的集合。 */
function filesAt(ref) {
  return new Set(git('ls-tree', '-r', '--name-only', ref).split('\n').filter(Boolean));
}

function main() {
  const args = parseArgs(process.argv);

  // ---- 前置檢查 ---------------------------------------------------------
  // 第 3 次事故：Lead 在 builder 的 worktree 目錄裡跑 merge，自己併自己。
  const head = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (head !== 'main') {
    throw new Error(
      `這支腳本必須在 main 的 worktree 裡跑，目前 HEAD 是 '${head}'。\n`
      + 'R33 事故 3：Lead 在 ck-visual 目錄裡跑 merge feat/visual，等於自己併自己，'
      + '整個 commit 沒進 main 而當下沒發現。',
    );
  }
  if (git('status', '--porcelain')) {
    throw new Error('main 的工作區不乾淨。先 commit 或 stash。');
  }

  const incoming = git('log', '--format=%h %s', `main..${args.branch}`).split('\n').filter(Boolean);
  if (incoming.length === 0) {
    console.log(`${args.branch} 沒有 main 以外的 commit，無事可做。`);
    return;
  }

  // ---- 偵測歷史重寫 -----------------------------------------------------
  // 第 4 次事故：Codex rebase 重寫了 Lead 的 commit。症狀是「同一個標題、
  // 不同的 sha，而原版已經在 main 裡」。
  const mainSubjects = new Map(
    git('log', '--format=%h%x00%s', '-200', 'main')
      .split('\n').filter(Boolean)
      .map((l) => { const [sha, subject] = l.split('\0'); return [subject, sha]; }),
  );
  const rewritten = [];
  for (const line of incoming) {
    const sha = line.slice(0, line.indexOf(' '));
    const subject = line.slice(line.indexOf(' ') + 1);
    const original = mainSubjects.get(subject);
    if (original && original !== sha) rewritten.push({ subject, original, rewritten: sha });
  }

  // ---- 檔案層檢查：整合會不會弄丟東西 -----------------------------------
  // 第 4 次事故的實際傷害：rebase 過程掉了一個 355KB 的評審材料 PNG，
  // 直接 merge 會把它從 main 刪掉。diff --stat 看得到，但那一行淹在 19 個
  // 檔案裡。這裡把它變成中止條件。
  const target = args.commits ? null : args.branch;
  const before = filesAt('main');
  const after = target ? filesAt(target) : null;
  const disappearing = after ? [...before].filter((f) => !after.has(f)) : [];

  // ---- 報告 -------------------------------------------------------------
  console.log(`\n整合 ${args.branch} → main\n`);
  console.log(`進來的 commit（${incoming.length}）:`);
  for (const l of incoming) console.log(`  ${l}`);

  if (rewritten.length > 0) {
    console.log(`\n⚠ 偵測到歷史重寫（${rewritten.length} 個）——同標題不同 sha，原版已在 main:`);
    for (const r of rewritten) console.log(`  ${r.original} → ${r.rewritten}  ${r.subject}`);
    console.log('  → 這代表對方 rebase 過已發布的 commit。建議改用 --commits 只挑它自己的工作。');
  }

  if (disappearing.length > 0) {
    console.log(`\n✗ 整合會讓 ${disappearing.length} 個檔案從 main 消失:`);
    for (const f of disappearing) console.log(`  ${f}`);
    if (!args.allowDelete) {
      throw new Error(
        '中止：整合不得靜靜刪檔。確認每一個都該刪，再加 --allow-delete，'
        + '並在 commit 訊息裡寫明理由。',
      );
    }
    console.log('  （--allow-delete 已指定，繼續）');
  }

  if (args.dryRun) {
    console.log('\n--dry-run：未動任何 ref。');
    return;
  }

  // ---- 執行 -------------------------------------------------------------
  const snapshot = git('rev-parse', 'main');
  console.log(`\nmain 目前在 ${snapshot.slice(0, 7)}，出事就 git reset --hard ${snapshot.slice(0, 7)}`);

  if (args.commits) {
    for (const c of args.commits) {
      console.log(`  cherry-pick ${c}`);
      git('cherry-pick', c);
    }
  } else {
    console.log('  merge --ff-only');
    git('merge', '--ff-only', args.branch);
  }

  // ---- 後置檢查 ---------------------------------------------------------
  // cherry-pick 的路徑沒辦法事前算出 tree，所以事後再比一次。
  const finalFiles = filesAt('main');
  const lost = [...before].filter((f) => !finalFiles.has(f));
  if (lost.length > 0 && !args.allowDelete) {
    console.log(`\n✗ 整合後有 ${lost.length} 個檔案不見了:`);
    for (const f of lost) console.log(`  ${f}`);
    throw new Error(`中止並請手動回退：git reset --hard ${snapshot.slice(0, 7)}`);
  }

  console.log(`\n✓ main 現在在 ${git('rev-parse', '--short', 'main')}，檔案零遺失。`);
}

try {
  main();
} catch (error) {
  console.error(`\n[integrate] ${error.message}`);
  process.exit(1);
}
