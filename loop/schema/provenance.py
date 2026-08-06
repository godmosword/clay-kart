#!/usr/bin/env python3
"""驗證每一份 artifact 宣稱的 build_sha 都真的存在於這個 rev 的歷史裡。

用法：
    python3 loop/schema/provenance.py            # 檢查 HEAD
    python3 loop/schema/provenance.py --rev abc1234

抓的是「證據上了 main、程式碼沒上」這一類疏漏（loop/BACKLOG.md 記為第四種
變體，R22 與 R23 連兩輪發生）。前三種變體看起來都是「缺東西」會觸發追問，
這一種看起來是「做完了而且全綠」——main 上有一份判決，而 main 自己跑不出來。

現有的兩道檢查都抓不到它：`git status --short` 會是乾淨的（程式碼確實
commit 了，只是在分支上），`merge-base --is-ancestor` 顯示分支未併入在
builder 還沒收尾的輪次裡是正常狀態、不構成警訊。

這支腳本問的是不同的問題：**這份 artifact 說它是用哪個 commit 產生的，
那個 commit 在這裡嗎？**

Lead 基礎設施 —— 不是 Codex 的 tools/validate/ 範圍。
這支腳本不得呼叫任何 LLM API。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys


def _git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], check=True, capture_output=True, text=True
    ).stdout


def _artifact_paths(rev: str) -> list[str]:
    listing = _git("ls-tree", "-r", "--name-only", rev)
    return sorted(
        path
        for path in listing.splitlines()
        if path.startswith("loop/round-")
        and "/artifacts/" in path
        and path.endswith(".json")
    )


def _build_sha(rev: str, path: str) -> str | None:
    try:
        doc = json.loads(_git("show", f"{rev}:{path}"))
    except (subprocess.CalledProcessError, json.JSONDecodeError):
        return None
    meta = doc.get("meta")
    if not isinstance(meta, dict):
        return None
    sha = meta.get("build_sha")
    return sha if isinstance(sha, str) and sha else None


def _is_ancestor(sha: str, rev: str) -> bool | None:
    """True/False，若該 sha 這個 repo 裡根本不存在則回 None。"""
    exists = subprocess.run(
        ["git", "cat-file", "-e", f"{sha}^{{commit}}"], capture_output=True
    )
    if exists.returncode != 0:
        return None
    result = subprocess.run(
        ["git", "merge-base", "--is-ancestor", sha, rev], capture_output=True
    )
    return result.returncode == 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rev", default="HEAD")
    args = parser.parse_args(argv)
    rev = args.rev

    paths = _artifact_paths(rev)
    if not paths:
        print(f"provenance: 在 {rev} 底下沒有找到任何 loop/round-*/artifacts/*.json")
        return 0

    missing_sha: list[str] = []
    orphaned: list[tuple[str, str]] = []
    unknown: list[tuple[str, str]] = []
    ok = 0

    for path in paths:
        sha = _build_sha(rev, path)
        if sha is None:
            missing_sha.append(path)
            continue
        ancestry = _is_ancestor(sha, rev)
        if ancestry is None:
            unknown.append((path, sha))
        elif ancestry:
            ok += 1
        else:
            orphaned.append((path, sha))

    print(f"provenance @ {rev}: {ok} 份 artifact 的 build_sha 已在歷史中")

    if missing_sha:
        # 不算失敗：早期輪次的 artifact 沒有這個欄位。列出來讓缺口看得見，
        # 而不是靜靜跳過——沉默的假陰性比吵雜的假陽性危險。
        print(f"\n沒有 meta.build_sha（無法驗證，非失敗）：{len(missing_sha)} 份")
        for path in missing_sha:
            print(f"  - {path}")

    for path, sha in unknown:
        print(f"\n無法解析的 build_sha（commit 不在這個 repo）：\n  - {path}\n    {sha}")

    if orphaned:
        print(f"\n證據在、程式碼不在：{len(orphaned)} 份")
        for path, sha in orphaned:
            print(f"  - {path}")
            print(f"    build_sha {sha[:12]} 不是 {rev} 的祖先")
        print(
            "\n這份 artifact 宣稱的程式碼不在這個 rev 的歷史裡，"
            "代表判決無法從這裡重現。把對應分支併進來，或說明為什麼不用。"
        )

    return 1 if (orphaned or unknown) else 0


if __name__ == "__main__":
    sys.exit(main())
