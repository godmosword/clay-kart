#!/usr/bin/env python3
"""§6 高飽和禁令的機械檢查——對「標準文件自己指名的顏色」。

## 為什麼需要這支

R28 撞到一件事：`§5.5` 明文要求護欄用品牌橘 `#ff8c2b`,而那個值的 HSL 飽和度
恰好是 **1.000**,直接違反 `§6` 的上限 0.92。**標準自相矛盾**,而且是靠人在
實作時撞到才發現的。

修掉之後又留了第二個洞:我只改了 `palette.ts`,沒改 `BAR-VISUAL.md`,於是
`ui-hud` 的機械檢查有一段時間正在強制執行一個 `§6` 禁止的顏色。

兩次都是同一個形狀——**規範裡的顏色沒有人在檢查**。`material.ts` 的
`createClayMaterial` 已經在執行期夾制,但那只管得到程式碼路徑;文件裡寫死的
十六進位值不經過工廠,永遠不會被夾到。

所以這支檢查的對象是**文件**,不是程式。

## 它會怎麼失敗

把任何一個規範檔裡的顏色改回 `#ff8c2b` 就會 FAIL。這不是假設——
`--self-test` 會實際餵那個值進去確認擋得下來。
"""
import argparse
import colorsys
import pathlib
import re
import sys

# `§6` 的高飽和上限,與 `src/render/clay/material.ts` 的 MAX_SATURATION 同值。
MAX_SATURATION = 0.92

# 掃描對象:定義驗收標準的文件。程式碼不掃——那是 createClayMaterial 的責任。
DEFAULT_TARGETS = ("BAR-VISUAL.md", "CHARACTERS.md")

HEX = re.compile(r"#([0-9a-fA-F]{6})\b")

# 允許清單:語意上「本來就該是純的」而且不是黏土表面顏色的值。
# 每一條都要寫明理由——沒有理由的豁免會慢慢長成一張把檢查掏空的清單。
ALLOWED = {
    "ffffff": "§5.12 明文把純白列為『直接違規』的示例,是禁令本身不是配色",
}


def _srgb_to_linear(c: float) -> float:
    """sRGB 傳遞函式的反向。與 three.js `SRGBToLinear` 同一條式子。"""
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def saturation(hex6: str) -> float:
    """**線性空間**的 HSL 飽和度——刻意不是 sRGB 空間的。

    這一步很容易做錯,而且做錯之後檢查看起來完全正常。

    three.js 的 `Color.getHSL()` 預設回傳 `ColorManagement.workingColorSpace`
    (LinearSRGB)的 HSL,而 `material.ts` 的 `MAX_SATURATION = 0.92` 夾的就是
    那個值。如果這裡直接對 sRGB 分量算 HSL,兩邊的 0.92 **不是同一條線**:

        #c4544a  sRGB 空間 0.508   線性空間 0.779
        #f49862  sRGB 空間 0.869   線性空間 0.804

    差距大到足以讓一個顏色在文件檢查裡過、在執行期被夾,或者反過來。
    守衛跟它要守的東西定義不同,等於沒有守。
    """
    r, g, b = (_srgb_to_linear(int(hex6[i:i + 2], 16) / 255) for i in (0, 2, 4))
    return colorsys.rgb_to_hls(r, g, b)[2]


def scan(path: pathlib.Path) -> list[tuple[int, str, float]]:
    """回傳 (行號, 色碼, 飽和度) 的違規清單。"""
    out = []
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        for match in HEX.finditer(line):
            hex6 = match.group(1).lower()
            if hex6 in ALLOWED:
                continue
            s = saturation(hex6)
            if s > MAX_SATURATION:
                out.append((lineno, f"#{hex6}", s))
    return out


def self_test() -> int:
    """證偽測試:已知該擋的值必須真的被擋下來。

    沒有這一段,這支檢查就跟這個專案踩過三次的坑一樣——數字有在跑,
    但它不可能失敗。
    """
    cases = [
        ("ff8c2b", True, "R28 前的品牌橘,線性 s=1.000"),
        ("ffd866", True, "R28 前的點綴黃,線性 s=1.000"),
        ("f49862", False, "退飽和後的品牌橘,線性 s=0.804"),
        ("f5d581", False, "退飽和後的點綴黃,線性 s=0.800"),
        ("c4544a", False, "車身磚紅,線性 s=0.779（sRGB 空間只有 0.508——"
                          "用錯空間這條也會過,所以它證不了什麼；留著是為了"
                          "讓兩個空間的差距出現在輸出裡）"),
    ]
    failures = []
    for hex6, should_fail, why in cases:
        s = saturation(hex6)
        blocked = s > MAX_SATURATION
        mark = "擋下" if blocked else "放行"
        want = "擋下" if should_fail else "放行"
        ok = blocked == should_fail
        if not ok:
            failures.append(f"#{hex6} 應{want}卻{mark}(s={s:.3f})")
        print(f"  {'OK ' if ok else 'BAD'} #{hex6} s={s:.3f} → {mark}（{why}）")
    if failures:
        print("\nself-test FAIL:\n  " + "\n  ".join(failures))
        return 1
    print(f"\nself-test PASS（{len(cases)} 個案例,上限 {MAX_SATURATION}）")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("targets", nargs="*", default=list(DEFAULT_TARGETS))
    ap.add_argument("--self-test", action="store_true", help="只跑證偽測試")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    total = 0
    for name in args.targets:
        path = pathlib.Path(name)
        if not path.exists():
            print(f"FAIL 找不到 {name}", file=sys.stderr)
            return 2
        violations = scan(path)
        total += len(violations)
        if violations:
            for lineno, color, s in violations:
                print(f"FAIL {name}:{lineno} {color} 飽和度 {s:.3f} > {MAX_SATURATION}")
        else:
            print(f"OK   {name}")

    if total:
        print(f"\n§6 高飽和禁令:{total} 處違規。規範文件不得指名 §6 禁止的顏色。")
        return 1
    print(f"\n§6 高飽和禁令:0 處違規（上限 {MAX_SATURATION}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
