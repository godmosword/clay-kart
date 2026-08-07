#!/usr/bin/env python3
"""產生送交視覺 critic 的 BAR-VISUAL.md 副本，移除會破壞盲測的章節。

用法：
    python3 loop/schema/redact-bar-visual.py BAR-VISUAL.md /tmp/critic/BAR-VISUAL.md

**為什麼需要這支腳本：** R25 的第一次嘗試是用寫死的行號
`sed -n '1,279p'` 切的——那個數字在 R21 是對的，但文件從那之後長了
`§1.1`／`§1.2`，同一個行號變成切在 `§5` 中間。結果送給 critic 的副本
**缺了整節 `§6 全域禁令`**（`§5.x` 明文說「個別條款不覆寫 §5.0 與 §6」），
同時 `§1.1`／`§1.2` 反而被留了進去——那兩節有上一輪的分數表與
「暫緩組兩側都是佔位框」的索引校驗碼機制，正是不該讓 critic 看到的東西。

三個 critic session 已經帶著那份副本跑起來才被發現。改成按章節切，
並在送出前驗證。

移除的東西與理由：

- `§7` 與其所有子節：`§7.1` 是參考半邊的配對表（逐項列出來源檔案與裁切
  座標），照著讀完盲測就不盲了；`§7.2`–`§7.4` 是稽核與量測記錄，同樣是
  製作端資訊
- `§1.x` 全部：評分流程本身的說明（三輪中位數、索引校驗碼、機械驗收），
  含上一輪的分數。critic 不需要知道自己被跑幾次，更不該看到上一輪的分數。
  **R25 補：`§1.3` 列出「哪五個元件沒有參考半邊」——那等於把 `§1.2` 的索引
  校驗碼資訊直接送給 critic，而 `§1.2` 本身是刻意剝除的。改成整批剝除 `§1.x`，
  不再逐節列舉，才不會每加一節就要記得更新這裡**

保留的東西：`§0` 黃金樣本、`§0.5` 相機偏離、`§1` 評分方式、`§2` 評分尺度、
`§3` 拍攝規範、`§4` 元件清單、`§5` 全部美學條款、`§6` 全域禁令。

Lead 基礎設施 —— 不呼叫任何 LLM API。
"""
from __future__ import annotations

import re
import sys

# 這些章節整節移除（含其下所有子節，直到下一個同級或更高級標題）
DROP_SECTIONS = (
    re.compile(r'^## §7\b'),
    re.compile(r'^### §7\.'),
    re.compile(r'^### §1\.\d'),   # §1.x 全部：評分流程的 meta，一律不給 critic
)

# 送出的副本必須含有這些章節，缺一即為切錯
REQUIRED = ('## §0 ', '## §1 ', '## §2 ', '## §3 ', '## §4 ', '## §5 ', '## §6 ')

# 這些字樣若出現在副本裡，代表配對答案或評分機制外洩
FORBIDDEN = ('裁切', '暫緩', '校驗', '中位數', 'run1', '§7.1', '§7.2',
             '沒有參考半邊', '機械驗收', 'mechanical_checks_passed')

FOOTER = """
## §7 參考圖

（本節與 §7.1–§7.4 為製作端資訊，與評分無關，已於送交評審時移除。）
§1.1／§1.2 為評分流程說明，同樣與判斷無關，一併移除。
"""


def redact_body(text: str) -> str:
    """只做移除，不加頁尾——驗證要對本文做，不能把頁尾自己的說明當成外洩。"""
    out: list[str] = []
    skipping = False
    for line in text.split('\n'):
        if any(p.match(line) for p in DROP_SECTIONS):
            skipping = True
            continue
        # 遇到下一個 `## ` 頂層標題就結束跳過（子節 `### ` 不解除）
        if skipping and re.match(r'^## ', line):
            skipping = False
        if not skipping:
            out.append(line)
    return '\n'.join(out).rstrip('\n') + '\n'


def redact(text: str) -> str:
    return redact_body(text) + FOOTER


def verify(text: str) -> list[str]:
    problems = []
    for head in REQUIRED:
        if head not in text:
            problems.append(f'缺少章節：{head.strip()}')
    for word in FORBIDDEN:
        for i, line in enumerate(text.split('\n'), 1):
            # §1 本文提到 key 檔不得外洩是原始協定的一部分，不算洩漏
            if word in line and 'contact-sheet.key.json' not in line:
                problems.append(f'第 {i} 行疑似外洩「{word}」：{line.strip()[:60]}')
                break
    return problems


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    text = open(argv[1], encoding='utf-8').read()
    body = redact_body(text)
    problems = verify(body)
    result = body + FOOTER
    if problems:
        print('redact: 送出前驗證未通過', file=sys.stderr)
        for p in problems:
            print('  - ' + p, file=sys.stderr)
        return 1
    open(argv[2], 'w', encoding='utf-8').write(result)
    kept = [l for l in result.split('\n') if re.match(r'^## §', l)]
    print(f'redact: {argv[2]} 已產生，保留 {len(kept)} 個章節')
    for k in kept:
        print('  ' + k)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
