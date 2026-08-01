"""Boundary tests for the BAR-FEEL verdict logic."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from feel import WINDOWS, build_verdict, calculate_metrics  # noqa: E402


def _metrics_with(metric_name: str, value: float | bool) -> dict[str, float | bool]:
    metrics: dict[str, float | bool] = {}
    for _, name, low, _, _ in WINDOWS:
        metrics[name] = True if isinstance(low, bool) else 0.0
    metrics[metric_name] = value
    return metrics


def _status(verdict: dict, metric_id: str) -> str:
    return next(check["status"] for check in verdict["checks"] if check["id"] == metric_id)


def _outside_low(low: float | bool, high: float | bool) -> float | bool:
    if isinstance(low, bool):
        return False
    width = float(high) - float(low)
    return float(low) - max(1.0, width * 10.0)


def _outside_high(low: float | bool, high: float | bool) -> float | bool:
    if isinstance(low, bool):
        return False
    width = float(high) - float(low)
    return float(high) + max(1.0, width * 10.0)


def test_every_window_accepts_both_closed_boundaries() -> None:
    for metric_id, metric_name, low, high, _ in WINDOWS:
        assert _status(build_verdict(_metrics_with(metric_name, low)), metric_id) == "PASS"
        assert _status(build_verdict(_metrics_with(metric_name, high)), metric_id) == "PASS"


def test_every_window_rejects_below_and_far_below() -> None:
    for metric_id, metric_name, low, high, _ in WINDOWS:
        value = _outside_low(low, high)
        assert _status(build_verdict(_metrics_with(metric_name, value)), metric_id) == "FAIL"
        if not isinstance(low, bool):
            assert _status(build_verdict(_metrics_with(metric_name, float(low) - 1000.0)), metric_id) == "FAIL"


def test_every_window_rejects_above_and_far_above() -> None:
    for metric_id, metric_name, low, high, _ in WINDOWS:
        value = _outside_high(low, high)
        if isinstance(low, bool):
            assert _status(build_verdict(_metrics_with(metric_name, value)), metric_id) == "FAIL"
        else:
            assert _status(build_verdict(_metrics_with(metric_name, value)), metric_id) == "FAIL"
            assert _status(build_verdict(_metrics_with(metric_name, float(high) + 1000.0)), metric_id) == "FAIL"


def test_priority_selects_single_largest_gap_and_keeps_core_45_visible() -> None:
    metrics = _metrics_with("time_to_50pct_topspeed_s", 1000.0)
    metrics["car_lengths_gained_tier2"] = 0.0
    verdict = build_verdict(metrics)
    assert verdict["verdict"] == "FAIL"
    assert verdict["largest_gap"] == {
        "id": "4.5",
        "delta": "actual=0, below lower bound 1.5",
        "priority_rank": 2,
    }


def test_simulated_telemetry_calculates_fixed_dt_and_nan_metrics() -> None:
    telemetry = {
        "meta": {
            "tick_hz": 120,
            "replay_byte_identical": True,
            "track_geometry": {"centerX": 0, "centerZ": 30, "radius": 30, "halfWidth": 6},
            "car_length": 2.4,
            "car_width": 1.4,
        },
        "frames": [
            {"t": 1 / 120, "tick": 1, "pos": [30, 0, 30], "vel": [0, 0, 12], "speed": 12, "yaw": 0, "yaw_rate": 0, "grounded": True, "surface": "asphalt", "throttle_input": 1, "drift_state": "none"},
            {"t": 2 / 120, "tick": 2, "pos": [30, 0, 30.1], "vel": [0, 0, 12], "speed": 12, "yaw": 0, "yaw_rate": 0, "grounded": True, "surface": "asphalt", "throttle_input": 1, "drift_state": "none"},
        ],
        "events": [],
    }
    metrics = calculate_metrics(telemetry)
    assert metrics["tick_dt_variance"] == 0.0
    assert metrics["replay_byte_identical"] is True
    assert metrics["nan_or_inf_frames"] == 0.0
