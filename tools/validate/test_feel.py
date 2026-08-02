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


def test_drift_yaw_ratio_ignores_zero_steer_frames() -> None:
    def frame(tick: int, steer: float, drift_state: str, yaw_rate: float) -> dict:
        return {
            "t": tick / 120,
            "tick": tick,
            "pos": [30, 0, 30],
            "vel": [0, 0, 12],
            "speed": 12,
            "yaw": 0,
            "yaw_rate": yaw_rate,
            "steer_input": steer,
            "throttle_input": 1,
            "drift_state": drift_state,
            "grounded": True,
            "surface": "asphalt",
            "collision_impulse": 0,
        }

    telemetry = {
        "meta": {"tick_hz": 120, "replay_byte_identical": True},
        "frames": [
            frame(1, 0.3, "none", 0.5),
            frame(2, 0.0, "none", 0.0),
            frame(3, 0.0, "none", 0.0),
            frame(4, 0.3, "charging", 0.7),
        ],
        "events": [],
    }
    assert calculate_metrics(telemetry)["drift_yaw_rate_ratio"] == 1.4


def test_collision_metrics_use_angle_profiles_and_first_probe_impacts() -> None:
    def frame(tick: int) -> dict:
        return {
            "t": tick / 120,
            "tick": tick,
            "pos": [30, 0, 30],
            "vel": [0, 0, 12],
            "speed": 12,
            "yaw": 0,
            "yaw_rate": 0,
            "steer_input": 0,
            "throttle_input": 1,
            "drift_state": "none",
            "grounded": True,
            "surface": "asphalt",
            "collision_impulse": 0,
        }

    def collision(tick: int, angle: float, retention: float, recovery: float | None) -> dict:
        return {
            "tick": tick,
            "type": "collision",
            "data": {
                "phase": "impact",
                "normal_angle_deg": angle,
                "wall_speed_retention": retention,
                "recovery_time_s": recovery,
            },
        }

    telemetry = {
        "meta": {
            "tick_hz": 120,
            "replay_byte_identical": True,
            "collision_probes": [
                {
                    "name": "wall-30deg",
                    "events": [
                        collision(1, 30, 0.6, 0.1),
                        collision(2, 35, 0.7, 0.01),
                    ],
                },
                {
                    "name": "wall-head-on",
                    "events": [
                        collision(3, 10, 0.15, 0.4),
                        collision(4, 12, 0.2, None),
                    ],
                },
            ],
        },
        "frames": [frame(1), frame(2)],
        "events": [],
    }
    metrics = calculate_metrics(telemetry)
    assert metrics["wall_speed_retention"] == 0.6499999999999999
    assert metrics["wall_head_on_retention"] == 0.175
    assert metrics["collision_recovery_time_s"] == 0.25


def test_landing_metrics_use_measured_smooth_and_steep_probe_data() -> None:
    def landing(tick: int, angle: float, retention: float) -> dict:
        return {
            "tick": tick,
            "type": "landing",
            "data": {
                "landing_angle_deg": angle,
                "speed_retention": retention,
                "latency_ticks": 0,
            },
        }

    telemetry = {
        "meta": {
            "tick_hz": 120,
            "replay_byte_identical": True,
            "landing_probes": [
                {"name": "smooth", "events": [landing(80, 65, 0.98)]},
                {"name": "steep", "events": [landing(80, 25, 0.8)]},
            ],
        },
        "frames": [
            {"t": 1 / 120, "tick": 1, "pos": [30, 0, 30], "vel": [0, 0, 12], "speed": 12, "yaw": 0, "yaw_rate": 0, "grounded": True, "surface": "asphalt", "throttle_input": 1, "drift_state": "none"},
            {"t": 2 / 120, "tick": 2, "pos": [30, 0, 30.1], "vel": [0, 0, 12], "speed": 12, "yaw": 0, "yaw_rate": 0, "grounded": True, "surface": "asphalt", "throttle_input": 1, "drift_state": "none"},
        ],
        "events": [],
    }
    metrics = calculate_metrics(telemetry)
    assert metrics["landing_speed_retention"] == 0.98
    assert metrics["hard_landing_retention"] == 0.8
    assert metrics["airborne_to_grounded_latency_ticks"] == 0.0


def test_landing_metrics_fall_back_to_unlabelled_measured_events() -> None:
    telemetry = {
        "meta": {"tick_hz": 120},
        "frames": [],
        "events": [
            {
                "tick": 80,
                "type": "landing",
                "data": {"landing_angle_deg": 70, "speed_retention": 0.97, "latency_ticks": 1},
            },
            {
                "tick": 90,
                "type": "landing",
                "data": {"landing_angle_deg": 20, "speed_retention": 0.75, "latency_ticks": 1},
            },
        ],
    }
    metrics = calculate_metrics(telemetry)
    assert metrics["landing_speed_retention"] == 0.97
    assert metrics["hard_landing_retention"] == 0.75
    assert metrics["airborne_to_grounded_latency_ticks"] == 1.0
