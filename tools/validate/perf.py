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
REQUIRED_MEASUREMENTS = frozenset({
    "gc_pause_max_ms",
    "texture_memory_mb",
    "heap_growth_per_lap_mb",
    "first_interactive_s",
    "time_to_first_render_s",
})

ANIMATION_SAMPLE_FPS_THRESHOLD = 24.0
ANIMATION_SLOW_RENDER_FPS_THRESHOLD = 12.63
# A symmetric ±15% measurement band around 12/f catches both a frozen
# animation (ratio=0) and an unquantized per-frame animation (ratio=1) while
# leaving normal frame-scheduling jitter room.
ANIMATION_RATIO_LOW_FACTOR = 0.85
ANIMATION_RATIO_HIGH_FACTOR = 1.15
ANIMATION_RATIO_MAX = 0.95
ANIMATION_MODE_HZ = "hz_12_window"
ANIMATION_MODE_RATIO = "quantization_ratio_two_sided_window"
ANIMATION_MODE_UNMEASURABLE = "character_anim_unmeasurable_render_too_slow"
ANIMATION_MODE_MISSING = "missing_fps_or_render_ratio"
SCENE_ONLY_METRICS = frozenset({"draw_calls", "triangles_k", "texture_memory_mb"})

SOFTWARE_RENDER_BACKEND = "swiftshader_software"
BACKEND_LIMITED_METRICS = frozenset({"2.1", "2.2", "2.3", "2.4", "4.2", "4.3"})


def _has_full_heap_lap_measurement(doc: dict[str, Any]) -> bool:
    meta = doc.get("meta")
    if not isinstance(meta, dict):
        return False
    try:
        laps_measured = float(meta.get("laps_measured"))
    except (TypeError, ValueError):
        return False
    return (
        math.isfinite(laps_measured)
        and laps_measured >= 5
        and meta.get("heap_measurement_status") == "measured"
        and isinstance(meta.get("heap_growth_measurement"), str)
        and bool(meta["heap_growth_measurement"])
    )


def _has_four_g_profile(doc: dict[str, Any]) -> bool:
    meta = doc.get("meta")
    profile = meta.get("network_profile") if isinstance(meta, dict) else None
    if not isinstance(profile, dict):
        return False
    required = {
        "name",
        "latency_ms",
        "download_throughput_bps",
        "upload_throughput_bps",
        "connection_type",
        "cdp_method",
    }
    if not required.issubset(profile):
        return False
    try:
        latency = float(profile["latency_ms"])
        download = float(profile["download_throughput_bps"])
        upload = float(profile["upload_throughput_bps"])
    except (TypeError, ValueError):
        return False
    return (
        math.isfinite(latency)
        and math.isfinite(download)
        and math.isfinite(upload)
        and latency >= 0
        and download > 0
        and upload > 0
        and profile["cdp_method"] == "Network.emulateNetworkConditions"
    )


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


def _character_animation_ratio(values: dict[str, Any]) -> float | None:
    direct = values.get("character_animation_per_frame")
    if direct is None:
        ratios = values.get("render_telemetry_ratios")
        if isinstance(ratios, dict):
            direct = ratios.get("characterAnimationPerFrame")
    return _required_finite(direct)


def calculate_metrics(doc: dict[str, Any]) -> dict[str, Any]:
    values = doc.get("metrics", doc)
    if not isinstance(values, dict):
        values = {}
    metrics: dict[str, Any] = {}
    meta = doc.get("meta")
    scene_only = isinstance(meta, dict) and meta.get("mode") == "scene-only"
    if isinstance(meta, dict):
        metrics["render_backend"] = meta.get("render_backend")
        metrics["gl_renderer"] = meta.get("gl_renderer")
    fps_p05 = _required_finite(values.get("fps_p05"))
    animation_ratio = _character_animation_ratio(values)
    if scene_only or fps_p05 is None:
        animation_mode = ANIMATION_MODE_MISSING
    elif fps_p05 > ANIMATION_SAMPLE_FPS_THRESHOLD:
        animation_mode = ANIMATION_MODE_HZ
    elif fps_p05 > ANIMATION_SLOW_RENDER_FPS_THRESHOLD:
        animation_mode = ANIMATION_MODE_RATIO
    else:
        animation_mode = ANIMATION_MODE_UNMEASURABLE
    metrics["character_animation_per_frame"] = animation_ratio
    metrics["character_anim_validation_mode"] = animation_mode
    for _, metric, _, _, _ in WINDOWS:
        raw = values.get(metric)
        if scene_only:
            metrics[metric] = _required_finite(raw) if metric in SCENE_ONLY_METRICS else None
            continue
        measured = (
            metric not in {"heap_growth_per_lap_mb", "first_interactive_s", "time_to_first_render_s"}
            or (
                metric == "heap_growth_per_lap_mb"
                and _has_full_heap_lap_measurement(doc)
            )
            or (
                metric in {"first_interactive_s", "time_to_first_render_s"}
                and _has_four_g_profile(doc)
            )
        )
        if not measured:
            metrics[metric] = None
        elif metric in REQUIRED_MEASUREMENTS:
            metrics[metric] = _required_finite(raw)
        else:
            metrics[metric] = _finite(raw)
    return metrics


def _character_animation_check(
    metrics: dict[str, Any],
) -> tuple[str, Any, float, float, bool, str | None]:
    mode = metrics.get("character_anim_validation_mode")
    if mode == ANIMATION_MODE_HZ:
        return "character_anim_hz", metrics.get("character_anim_hz"), 11.5, 12.5, False, None
    if mode == ANIMATION_MODE_RATIO:
        fps_p05 = metrics["fps_p05"]
        expected_ratio = 12.0 / fps_p05
        return (
            "character_animation_per_frame",
            metrics.get("character_animation_per_frame"),
            ANIMATION_RATIO_LOW_FACTOR * expected_ratio,
            min(ANIMATION_RATIO_MAX, ANIMATION_RATIO_HIGH_FACTOR * expected_ratio),
            False,
            None,
        )
    if mode == ANIMATION_MODE_UNMEASURABLE:
        # The ratio is saturated below the resolvable sampling rate. This is
        # an unconditional environment FAIL, never a detection-based pass.
        fps_p05 = metrics["fps_p05"]
        ratio = metrics.get("character_animation_per_frame")
        ratio_text = "missing" if ratio is None else f"{ratio:g}"
        backend = metrics.get("render_backend")
        backend_text = f"; render_backend={backend}" if backend else ""
        return (
            "character_animation_per_frame",
            ratio,
            1.0,
            1.0,
            True,
            "environment=character_anim_unmeasurable_render_too_slow; "
            f"fps_p05={fps_p05:g} <= {ANIMATION_SLOW_RENDER_FPS_THRESHOLD:g}; "
            f"ratio={ratio_text} is saturated and cannot resolve animation frequency"
            f"{backend_text}",
        )
    return "character_anim_hz", None, 11.5, 12.5, False, None


def _backend_limited_reason(metric_id: str, metrics: dict[str, Any]) -> str | None:
    # Detecting SwiftShader is an environment diagnosis, never a PASS or a
    # skip. Keep the check failed so this artifact cannot certify app timing.
    if metric_id not in BACKEND_LIMITED_METRICS:
        return None
    if metrics.get("render_backend") != SOFTWARE_RENDER_BACKEND:
        return None
    renderer = metrics.get("gl_renderer") or "unknown"
    return (
        f"environment=render_backend:{SOFTWARE_RENDER_BACKEND}; "
        f"gl_renderer={renderer}; {metric_id} was measured with software rendering, "
        "so application performance is unknown"
    )


def _relative_gap(actual: float, low: float, high: float) -> float:
    if actual < low:
        return (low - actual) / (high - low)
    if actual > high:
        return (actual - high) / (high - low)
    return 0.0


def build_verdict(
    metrics: dict[str, Any],
    *,
    round_number: int = 3,
    artifact: str = "loop/round-3/artifacts/perf-proxy.json",
    budget_remaining: int = 0,
) -> dict[str, Any]:
    checks = []
    failures = []
    for metric_id, metric_name, low, high, priority in WINDOWS:
        environment_failure = False
        environment_reason = None
        if metric_id == "4.1":
            metric_name, actual, low, high, environment_failure, environment_reason = _character_animation_check(metrics)
        else:
            actual = metrics.get(metric_name)
            environment_reason = _backend_limited_reason(metric_id, metrics)
            environment_failure = environment_reason is not None
        if actual is None:
            # Keep the schema's numeric `actual` field while making the
            # missing measurement visible in the failure explanation.  This
            # is deliberately not treated as a measured zero.
            actual_for_schema = 0.0
            status = "FAIL"
            delta = environment_reason or "actual=missing; measurement required"
            failures.append((priority, -math.inf, metric_id, delta))
        else:
            actual_for_schema = actual
            status = "FAIL" if environment_failure else ("PASS" if low <= actual <= high else "FAIL")
            if environment_reason:
                delta = environment_reason
            elif actual < low:
                delta = f"actual={actual:g}, below lower bound {low:g}"
            else:
                delta = f"actual={actual:g}, above upper bound {high:g}"
            if status == "FAIL":
                gap = -math.inf if environment_failure else -_relative_gap(actual, low, high)
                failures.append((priority, gap, metric_id, delta))
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
    animation_mode = metrics.get("character_anim_validation_mode", ANIMATION_MODE_MISSING)
    return {
        "round": round_number,
        "wave": "W2",
        "element": "perf-validator",
        "verdict": verdict,
        "bar_ref": f"BAR-PERF.md §2–§5; §4.1 mode={animation_mode}",
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
