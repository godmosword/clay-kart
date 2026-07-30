#!/usr/bin/env python3
"""驗證一份 VERDICT.json 是否符合 schema。

用法：
    python3 loop/schema/check.py loop/round-7/VERDICT.json

Lead 基礎設施 —— 不是 Codex 的 tools/validate/ 範圍。
這支腳本不得呼叫任何 LLM API。
"""
import json
import sys
from pathlib import Path

SCHEMA = Path(__file__).with_name("verdict.schema.json")


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2

    target = Path(argv[1])
    if not target.is_file():
        print(f"找不到檔案：{target}", file=sys.stderr)
        return 2

    try:
        from jsonschema import ValidationError, validate
    except ImportError:
        print("需要 jsonschema：pip install jsonschema", file=sys.stderr)
        return 2

    try:
        doc = json.loads(target.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"JSON 解析失敗 {target}: {exc}", file=sys.stderr)
        return 1

    try:
        validate(doc, json.loads(SCHEMA.read_text(encoding="utf-8")))
    except ValidationError as exc:
        path = "/".join(str(p) for p in exc.absolute_path) or "(root)"
        print(f"VERDICT 不合規 {target}\n  位置: {path}\n  原因: {exc.message}", file=sys.stderr)
        return 1

    gap = doc.get("largest_gap")
    print(f"ok  R{doc['round']} {doc['element']} → {doc['verdict']}"
          + (f" (largest_gap: {gap['id']})" if gap else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
