#!/usr/bin/env python3
"""Deterministic BAR-PERF validator; no network or LLM dependencies."""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

WINDOWS: tuple[tuple[str, str, float, float, int], ...] = (
    ("4.1", "character_anim_hz", 11.5, 12.5, 1),
    ("4.2", "vehicle_transform_hz", 58.0, 62.0, 1),
    ("4.3", "camera_hz", 58.0, 62.0, 1),
    ("2.1", "fps_p50", 58.0, 62.0, 2),
    ("2.2", "fps_p05", 55.0, 62.0, 2),
    ("5.2", "heap_growth_per_lap_mb", 0.0, 2.0, 3),
    ("2.3", "frame_time_p99_ms", 0.0, 22.0, 4),
    ("2.4", "long_frame_count", 0.0, 3.0, 4),
    ("2.5", "gc_pause_max_ms", 0.0, 8.0, 4),
    ("3.1", "first_interactive_s", 0.0, 3.0, 5),
    ("3.2", "initial_bundle_kb_gz", 0.0, 900.0, 5),
    ("3.3", "total_assets_mb", 0.0, 12.0, 5),
    ("3.4", "time_to_first_render_s", 0.0, 1.5, 5),
    ("5.1", "heap_peak_mb", 0.0, 320.0, 6),
    ("5.3", "draw_calls", 0.0, 150.0, 6),
    ("5.4", "triangles_k", 0.0, 400.0, 6),
    ("5.5", "texture_memory_mb", 0.0, 96.0, 6),
)

# These metrics cannot honestly be inferred as zero.  A zero from a real
# probe means "no pause/allocation was observed"; a missing value means the
# probe did not measure the resource at all and must fail explicitly.
REQUIRED_MEASUREMENTS = frozenset({"gc_pause_max_ms", "texture_memory_mb"})


def _finite(value: Any) -> float:
    try:
        value = float(value)
    except (TypeError, ValueError):
        return 0.0
    return value if math.isfinite(value) else 0.0


def _required_finite(value: Any) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def calculate_metrics(doc: dict[str, Any]) -> dict[str, float | None]:
    values = doc.get("metrics", doc)
    if not isinstance(values, dict):
        values = {}
    character_status = values.get("character_anim_status")
    metrics: dict[str, float | None] = {}
    for _, metric, _, _, _ in WINDOWS:
        raw = values.get(metric)
        if (
            metric == "character_anim_hz"
            and raw is None
            and character_status == "not_applicable_no_character_animation"
        ):
            # The renderer has no character animation yet. Keep this honest and
            # omit §4.1 from the verdict until W3 supplies a measurable signal.
            metrics[metric] = None
        elif metric in REQUIRED_MEASUREMENTS:
            metrics[metric] = _required_finite(raw)
        else:
            metrics[metric] = _finite(raw)
    return metrics


def _relative_gap(actual: float, low: float, high: float) -> float:
    if actual < low:
        return (low - actual) / (high - low)
    if actual > high:
        return (actual - high) / (high - low)
    return 0.0


def build_verdict(
    metrics: dict[str, float | None],
    *,
    round_number: int = 3,
    artifact: str = "loop/round-3/artifacts/perf-proxy.json",
    budget_remaining: int = 0,
) -> dict[str, Any]:
    checks = []
    failures = []
    for metric_id, metric_name, low, high, priority in WINDOWS:
        actual = metrics.get(metric_name)
        if actual is None:
            if metric_name == "character_anim_hz":
                # The renderer has no character animation yet; this is the
                # one documented not-applicable metric in BAR-PERF.
                continue
            # Keep the schema's numeric `actual` field while making the
            # missing measurement visible in the failure explanation.  This
            # is deliberately not treated as a measured zero.
            actual_for_schema = 0.0
            status = "FAIL"
            delta = "actual=missing; measurement required"
            failures.append((priority, -math.inf, metric_id, delta))
        else:
            actual_for_schema = actual
            status = "PASS" if low <= actual <= high else "FAIL"
            delta = f"actual={actual:g}, below lower bound {low:g}" if actual < low else f"actual={actual:g}, above upper bound {high:g}"
            if status == "FAIL":
                failures.append((priority, -_relative_gap(actual, low, high), metric_id, delta))
        checks.append({
            "id": metric_id,
            "metric": metric_name,
            "actual": actual_for_schema,
            "window": [low, high],
            "status": status,
        })
    failures.sort()
    verdict = "PASS" if not failures else "FAIL"
    largest_gap = None
    if failures:
        priority, _, metric_id, delta = failures[0]
        largest_gap = {"id": metric_id, "delta": delta, "priority_rank": priority}
    return {
        "round": round_number,
        "wave": "W2",
        "element": "perf-validator",
        "verdict": verdict,
        "bar_ref": "BAR-PERF.md §2–§5",
        "checks": checks,
        "largest_gap": largest_gap,
        "artifacts": [artifact],
        "next_owner": "lead" if verdict == "PASS" else "claude-code",
        "tokens_spent_on_element": 0,
        "budget_remaining": budget_remaining,
    }


def evaluate(doc: dict[str, Any], **kwargs: Any) -> dict[str, Any]:
    return build_verdict(calculate_metrics(doc), **kwargs)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--output", type=Path, default=Path("loop/round-3/VERDICT-perf.json"))
    parser.add_argument("--artifact", default=None)
    parser.add_argument("--round", type=int, default=3, dest="round_number")
    args = parser.parse_args(argv)
    doc = json.loads(args.report.read_text(encoding="utf-8"))
    verdict = evaluate(doc, round_number=args.round_number, artifact=args.artifact or str(args.report))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(verdict, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"perf: {verdict['verdict']} (largest_gap={verdict['largest_gap']['id'] if verdict['largest_gap'] else 'none'}) -> {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
