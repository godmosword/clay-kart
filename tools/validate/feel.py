#!/usr/bin/env python3
"""Deterministic BAR-FEEL §2–§8 and §12 validator.

Usage:
    python3 tools/validate/feel.py telemetry/lap-a.json \
        --output loop/round-N/VERDICT.json --round N

This module is intentionally pure Python: it reads JSON, performs numeric
checks, and never calls a network service or an LLM.
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
from pathlib import Path
from typing import Any

CAR_LENGTH = 2.4
BASE_TOP_SPEED = 24.0
DEFAULT_TICK_HZ = 120.0
WALL_STICK_SPEED_RATIO = 0.10

# The order and priority ranks mirror BAR-FEEL §9.  Lower rank wins before
# relative deviation is considered.
WINDOWS: tuple[tuple[str, str, float | bool, float | bool, int], ...] = (
    ("2.1", "tick_dt_variance", 0.0, 0.0, 1),
    ("2.2", "replay_byte_identical", True, True, 1),
    ("2.3", "max_penetration_depth", 0.0, 0.05, 1),
    ("2.4", "nan_or_inf_frames", 0.0, 0.0, 1),
    ("3.1", "time_to_50pct_topspeed_s", 0.55, 0.85, 3),
    ("3.2", "time_to_95pct_topspeed_s", 2.60, 3.40, 3),
    ("3.3", "top_speed_flat_us", 23.5, 24.5, 3),
    ("3.4", "coast_decel_us2", 4.0, 6.5, 3),
    ("3.5", "reverse_top_speed_ratio", 0.30, 0.42, 3),
    ("4.1", "drift_entry_min_speed_us", 9.0, 12.0, 7),
    ("4.2", "tier1_charge_time_s", 0.75, 0.95, 4),
    ("4.3", "tier2_charge_time_s", 1.90, 2.10, 4),
    ("4.4", "tier3_charge_time_s", 3.30, 3.70, 4),
    ("4.5", "car_lengths_gained_tier2", 1.5, 2.5, 2),
    ("4.6", "car_lengths_gained_tier1", 0.6, 1.1, 7),
    ("4.7", "car_lengths_gained_tier3", 2.8, 4.0, 7),
    ("4.8", "miniturbo_duration_tier2_s", 0.90, 1.20, 7),
    ("4.9", "drift_yaw_rate_ratio", 1.25, 1.60, 7),
    ("4.10", "drift_speed_retention", 0.88, 0.97, 7),
    ("5.1", "steer_response_lag_ms", 0.0, 50.0, 5),
    ("5.2", "turn_radius_at_95pct_u", 7.0, 9.5, 5),
    ("5.3", "yaw_settle_time_s", 0.15, 0.35, 5),
    ("5.4", "yaw_overshoot_ratio", 0.0, 0.12, 5),
    ("5.5", "grass_speed_penalty", 0.55, 0.70, 5),
    ("5.6", "dirt_speed_penalty", 0.80, 0.90, 5),
    ("5.7", "turn_radius_at_30pct_u", 3.5, 5.5, 5),
    ("5.8", "turn_radius_at_60pct_u", 5.5, 7.5, 5),
    ("5.9", "turn_radius_monotonic", True, True, 5),
    ("6.1", "wall_speed_retention", 0.55, 0.75, 6),
    ("6.2", "wall_head_on_retention", 0.05, 0.20, 6),
    ("6.3", "collision_recovery_time_s", 0.15, 0.45, 6),
    ("6.4", "kart_kart_impulse_symmetry", 0.92, 1.08, 6),
    ("6.5", "wall_stick_frames", 0.0, 3.0, 6),
    ("7.1", "air_control_yaw_rate_ratio", 0.20, 0.40, 8),
    ("7.2", "gravity_us2", 26.0, 34.0, 8),
    ("7.3", "landing_speed_retention", 0.90, 1.00, 8),
    ("7.4", "hard_landing_retention", 0.70, 0.85, 8),
    ("7.5", "airborne_to_grounded_latency_ticks", 0.0, 2.0, 8),
    ("8.1", "input_to_sim_latency_ticks", 0.0, 1.0, 9),
    ("8.2", "input_buffer_window_ms", 80.0, 130.0, 9),
    ("8.3", "throttle_deadzone", 0.0, 0.08, 9),
    ("8.4", "steer_deadzone", 0.05, 0.15, 9),
    ("12.1", "ai_lap_completion", True, True, 10),
    ("12.2", "ai_overtake_time_s", 1.0, 8.0, 10),
    ("12.3", "difficulty_lap_time_spread_s", 3.0, 20.0, 10),
    ("12.4", "rubberband_speed_bonus_ratio", 1.0, 1.15, 10),
)


def _finite(value: Any, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def _frames(doc: dict[str, Any]) -> list[dict[str, Any]]:
    return [frame for frame in doc.get("frames", []) if isinstance(frame, dict)]


def _events(doc: dict[str, Any], event_type: str | None = None) -> list[dict[str, Any]]:
    events = [event for event in doc.get("events", []) if isinstance(event, dict)]
    if event_type is not None:
        events = [event for event in events if event.get("type") == event_type]
    return events


def _meta(doc: dict[str, Any]) -> dict[str, Any]:
    value = doc.get("meta", {})
    return value if isinstance(value, dict) else {}


def _tick_dt(doc: dict[str, Any], frames: list[dict[str, Any]]) -> float:
    tick_hz = _finite(_meta(doc).get("tick_hz"), DEFAULT_TICK_HZ)
    if tick_hz <= 0:
        tick_hz = DEFAULT_TICK_HZ
    if len(frames) < 2:
        return 1.0 / tick_hz
    deltas = [_finite(b.get("t")) - _finite(a.get("t")) for a, b in zip(frames, frames[1:])]
    return statistics.fmean(deltas) if deltas else 1.0 / tick_hz


def _speed(frame: dict[str, Any]) -> float:
    return _finite(frame.get("speed"))


def _vec3(frame: dict[str, Any], key: str) -> tuple[float, float, float]:
    value = frame.get(key, [0.0, 0.0, 0.0])
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        return 0.0, 0.0, 0.0
    return tuple(_finite(item) for item in value)  # type: ignore[return-value]


def _longitudinal_speed(frame: dict[str, Any]) -> float:
    vx, _, vz = _vec3(frame, "vel")
    yaw = _finite(frame.get("yaw"))
    return vx * math.sin(yaw) + vz * math.cos(yaw)


def _baseline_item(doc: dict[str, Any], tier: int) -> dict[str, Any] | None:
    baselines = _meta(doc).get("baselines", {})
    if not isinstance(baselines, dict):
        return None
    item = baselines.get(str(tier), baselines.get(tier, {}))
    return item if isinstance(item, dict) else None


def _baseline(doc: dict[str, Any], tier: int) -> float | None:
    item = _baseline_item(doc, tier)
    if item is None:
        return None
    if item.get("measurement_status") == "wall_contaminated_measurement":
        return None
    if (
        _finite(item.get("contact_frames_in_window")) > 0
        or _finite(item.get("baseline_contact_frames_in_window")) > 0
    ):
        return None
    if "car_lengths_gained" in item:
        return _finite(item["car_lengths_gained"])
    if "drift_distance" not in item or "straight_distance" not in item:
        return None
    drift = _finite(item.get("drift_distance"))
    straight = _finite(item.get("straight_distance"))
    car_length = _finite(_meta(doc).get("car_length"), CAR_LENGTH)
    return (drift - straight) / car_length if car_length > 0 else None


def _baseline_contamination_reason(doc: dict[str, Any], tier: int) -> str | None:
    item = _baseline_item(doc, tier)
    if item is None:
        return None
    status = item.get("measurement_status")
    contact_frames = _finite(item.get("contact_frames_in_window"))
    baseline_contact_frames = _finite(item.get("baseline_contact_frames_in_window"))
    if status != "wall_contaminated_measurement" and contact_frames <= 0 and baseline_contact_frames <= 0:
        return None
    return (
        "environment=wall_contaminated_measurement; "
        f"tier={tier}; contact_frames_in_window={contact_frames:g}; "
        f"baseline_contact_frames_in_window={baseline_contact_frames:g}"
    )


def _event_value(events: list[dict[str, Any]], key: str, default: float = 0.0) -> float:
    values = []
    for event in events:
        data = event.get("data", {})
        if isinstance(data, dict) and key in data:
            values.append(_finite(data[key]))
    return statistics.fmean(values) if values else default


def _input_feedback_metrics(doc: dict[str, Any]) -> dict[str, float]:
    meta = _meta(doc)
    feedback = meta.get("input_feedback", {})
    if not isinstance(feedback, dict):
        return {
            "input_to_sim_latency_ticks": 0.0,
            "input_buffer_window_ms": 0.0,
            "throttle_deadzone": 0.0,
            "steer_deadzone": 0.0,
        }

    latency_probe = feedback.get("latency_probe", {})
    latency = 0.0
    if isinstance(latency_probe, dict):
        request_tick = _finite(latency_probe.get("request_tick"), math.nan)
        applied_tick = _finite(latency_probe.get("applied_tick"), math.nan)
        if math.isfinite(request_tick) and math.isfinite(applied_tick):
            latency = max(0.0, applied_tick - request_tick - 1.0)

    buffer_probe = feedback.get("buffer_probe", {})
    buffer_window = 0.0
    if isinstance(buffer_probe, dict):
        release_tick = _finite(buffer_probe.get("release_tick"), math.nan)
        activation = buffer_probe.get("activation_tick")
        activation_tick = _finite(activation, math.nan)
        condition_reached = buffer_probe.get("pulse_reached_reference_window") is True
        if (
            condition_reached
            and math.isfinite(release_tick)
            and math.isfinite(activation_tick)
            and activation_tick > release_tick
        ):
            tick_hz = _finite(meta.get("tick_hz"), DEFAULT_TICK_HZ)
            buffer_window = (activation_tick - release_tick) * 1000.0 / tick_hz if tick_hz > 0 else 0.0

    deadzones = {"throttle": 0.0, "steer": 0.0}
    probes = feedback.get("deadzone_probes", [])
    if isinstance(probes, list):
        for probe in probes:
            if not isinstance(probe, dict) or not isinstance(probe.get("samples"), list):
                continue
            field = probe.get("field")
            if field not in deadzones:
                continue
            zero_requests = []
            for sample in probe["samples"]:
                if not isinstance(sample, dict):
                    continue
                requested = sample.get("requested", {})
                effective = sample.get("effective", {})
                if not isinstance(requested, dict) or not isinstance(effective, dict):
                    continue
                requested_value = _finite(requested.get(field), math.nan)
                effective_value = _finite(effective.get(field), math.nan)
                if math.isfinite(requested_value) and math.isfinite(effective_value) and abs(effective_value) <= 1e-12:
                    zero_requests.append(abs(requested_value))
            if zero_requests:
                deadzones[field] = max(zero_requests)

    return {
        "input_to_sim_latency_ticks": latency,
        "input_buffer_window_ms": buffer_window,
        "throttle_deadzone": deadzones["throttle"],
        "steer_deadzone": deadzones["steer"],
    }


def _surface_speed_metrics(doc: dict[str, Any], frames: list[dict[str, Any]]) -> dict[str, float]:
    """Use deterministic surface probe records when the main fixture misses terrain zones."""
    measured: dict[str, float] = {}
    probes = _meta(doc).get("surface_probes", [])
    if isinstance(probes, list):
        for probe in probes:
            if not isinstance(probe, dict) or probe.get("surface") not in {"grass", "dirt"}:
                continue
            samples = probe.get("samples", [])
            references = probe.get("asphalt_reference_speeds", [])
            speeds = [
                _finite(sample.get("speed"))
                for sample in samples
                if isinstance(sample, dict) and math.isfinite(_finite(sample.get("speed"), math.nan))
            ] if isinstance(samples, list) else []
            asphalt_speeds = [
                _finite(speed)
                for speed in references
                if math.isfinite(_finite(speed, math.nan))
            ] if isinstance(references, list) else []
            if speeds and asphalt_speeds and statistics.fmean(asphalt_speeds) > 0:
                measured[str(probe["surface"])] = statistics.fmean(speeds) / statistics.fmean(asphalt_speeds)

    asphalt = [_speed(frame) for frame in frames if frame.get("surface") == "asphalt"]
    asphalt_mean = statistics.fmean(asphalt) if asphalt else 0.0
    for surface in ("grass", "dirt"):
        if surface not in measured:
            values = [_speed(frame) for frame in frames if frame.get("surface") == surface]
            measured[surface] = statistics.fmean(values) / asphalt_mean if values and asphalt_mean else 0.0
    return measured


def _ai_metrics(doc: dict[str, Any]) -> dict[str, float | bool]:
    """Read §12 only from named deterministic AI probe records."""
    metrics: dict[str, float | bool] = {
        "ai_lap_completion": False,
        "ai_overtake_time_s": 0.0,
        "difficulty_lap_time_spread_s": 0.0,
        "rubberband_speed_bonus_ratio": 0.0,
    }
    probes = _meta(doc).get("ai_probes", [])
    if not isinstance(probes, list):
        return metrics
    for probe in probes:
        if not isinstance(probe, dict):
            continue
        name = probe.get("name")
        if name == "ai-lap-completion":
            metrics["ai_lap_completion"] = probe.get("ai_lap_completion") is True
        elif name == "ai-overtake":
            metrics["ai_overtake_time_s"] = _finite(probe.get("overtake_time_s"))
        elif name == "ai-difficulty-spread":
            metrics["difficulty_lap_time_spread_s"] = _finite(probe.get("spread_s"))
        elif name == "ai-rubberband":
            # 12.4 is a measurement window: report the maximum physical speed
            # actually observed in the probe. The configured cap remains in
            # the artifact as diagnostics, but must not substitute for the
            # observed value when evaluating the contract.
            metrics["rubberband_speed_bonus_ratio"] = _finite(
                probe.get("observed_max_speed_ratio"), math.nan
            )
    return metrics


def _collision_events(doc: dict[str, Any]) -> list[dict[str, Any]]:
    events = _events(doc, "collision")
    probes = _meta(doc).get("collision_probes", [])
    if not isinstance(probes, list):
        return events
    for probe in probes:
        if not isinstance(probe, dict) or not isinstance(probe.get("events"), list):
            continue
        probe_name = probe.get("name")
        for event in probe["events"]:
            if not isinstance(event, dict) or event.get("type") != "collision":
                continue
            data = event.get("data", {})
            data = dict(data) if isinstance(data, dict) else {}
            data["probe"] = probe_name
            events.append({**event, "data": data})
    return events


def _kart_kart_events(doc: dict[str, Any]) -> list[dict[str, Any]]:
    events = _events(doc, "kart_kart_collision")
    probes = _meta(doc).get("kart_kart_probes", [])
    if not isinstance(probes, list):
        return events
    for probe in probes:
        if not isinstance(probe, dict) or not isinstance(probe.get("events"), list):
            continue
        probe_name = probe.get("name")
        for event in probe["events"]:
            if not isinstance(event, dict) or event.get("type") != "kart_kart_collision":
                continue
            data = event.get("data", {})
            data = dict(data) if isinstance(data, dict) else {}
            data["probe"] = probe_name
            events.append({**event, "data": data})
    return events


def _collision_metric(
    events: list[dict[str, Any]],
    key: str,
    *,
    angle_low: float | None = None,
    angle_high: float | None = None,
    first_impact_per_source: bool = False,
    probe_name: str | None = None,
) -> float:
    values = []
    seen_sources: set[Any] = set()
    for event in events:
        data = event.get("data", {})
        if not isinstance(data, dict) or data.get("phase") != "impact":
            continue
        if probe_name is not None and data.get("probe") != probe_name:
            continue
        source = data.get("probe", "fixture")
        if first_impact_per_source and source in seen_sources:
            continue
        if first_impact_per_source:
            seen_sources.add(source)
        angle = _finite(data.get("normal_angle_deg"), math.inf)
        if angle_low is not None and angle < angle_low:
            continue
        if angle_high is not None and angle > angle_high:
            continue
        raw = data.get(key)
        if raw is None:
            continue
        value = _finite(raw, math.nan)
        if math.isfinite(value):
            values.append(value)
    return statistics.median(values) if values else 0.0


def _landing_events(doc: dict[str, Any]) -> list[dict[str, Any]]:
    events = _events(doc, "landing")
    probes = _meta(doc).get("landing_probes", [])
    if not isinstance(probes, list):
        return events
    for probe in probes:
        if not isinstance(probe, dict) or not isinstance(probe.get("events"), list):
            continue
        probe_name = probe.get("name")
        for event in probe["events"]:
            if not isinstance(event, dict) or event.get("type") != "landing":
                continue
            data = event.get("data", {})
            data = dict(data) if isinstance(data, dict) else {}
            data["probe"] = probe_name
            events.append({**event, "data": data})
    return events


def _landing_metric(
    events: list[dict[str, Any]],
    key: str,
    *,
    angle_low: float | None = None,
    angle_high: float | None = None,
    probe_name: str | None = None,
) -> float:
    values = []
    named_values = []
    for event in events:
        data = event.get("data", {})
        if not isinstance(data, dict):
            continue
        angle = _finite(data.get("landing_angle_deg"), math.inf)
        if angle_low is not None and angle < angle_low:
            continue
        if angle_high is not None and angle > angle_high:
            continue
        raw = data.get(key)
        if raw is None:
            continue
        value = _finite(raw, math.nan)
        if math.isfinite(value):
            values.append(value)
            if probe_name is not None and data.get("probe") == probe_name:
                named_values.append(value)
    if probe_name is not None and named_values:
        values = named_values
    return statistics.median(values) if values else 0.0


def _nan_inf_frames(frames: list[dict[str, Any]]) -> int:
    count = 0
    for frame in frames:
        values: list[Any] = [frame.get("t"), frame.get("tick"), frame.get("speed"), frame.get("yaw"), frame.get("yaw_rate")]
        values.extend(frame.get("pos", []))
        values.extend(frame.get("vel", []))
        values.extend([frame.get("drift_charge"), frame.get("collision_impulse")])
        if any(isinstance(value, float) and not math.isfinite(value) for value in values):
            count += 1
    return count


def _drift_metrics(doc: dict[str, Any], frames: list[dict[str, Any]]) -> tuple[float, dict[int, float]]:
    drift_indices = [index for index, frame in enumerate(frames) if frame.get("drift_state") != "none"]
    drift_start = drift_indices[0] if drift_indices else None
    entry_speed = _speed(frames[drift_start - 1]) if drift_start and drift_start > 0 else 0.0
    charge_times: dict[int, float] = {}
    for tier in (1, 2, 3):
        if drift_start is None:
            charge_times[tier] = 0.0
        else:
            charged = next((frame for frame in frames[drift_start:] if int(frame.get("drift_tier", 0)) >= tier), None)
            charge_times[tier] = _finite(charged.get("t")) - _finite(frames[drift_start].get("t")) if charged else 0.0

    drift_coverage_probes = _meta(doc).get("drift_coverage_probes", [])
    tier3_probe = next(
        (
            probe for probe in drift_coverage_probes
            if isinstance(probe, dict) and probe.get("name") == "drift-tier-3"
        ),
        None,
    ) if isinstance(drift_coverage_probes, list) else None
    if tier3_probe is not None:
        charge_times[3] = _finite(tier3_probe["charge_time_s"])

    return entry_speed, charge_times


def calculate_metrics(doc: dict[str, Any]) -> dict[str, float | bool | None]:
    """Calculate every BAR-FEEL metric from a telemetry document."""
    frames = _frames(doc)
    meta = _meta(doc)
    dt = _tick_dt(doc, frames)
    speeds = [_speed(frame) for frame in frames]
    top_speed = max(speeds, default=0.0)

    if len(frames) >= 3:
        deltas = [_finite(b.get("t")) - _finite(a.get("t")) for a, b in zip(frames, frames[1:])]
        dt_variance = statistics.pvariance(deltas) if deltas else 0.0
        if max(deltas, default=0.0) - min(deltas, default=0.0) < 1e-12:
            dt_variance = 0.0
    else:
        dt_variance = 0.0

    penetration = 0.0
    geometry = meta.get("track_geometry", {})
    if not isinstance(geometry, dict):
        geometry = {}
    center_x = _finite(geometry.get("centerX"))
    center_z = _finite(geometry.get("centerZ"), 30.0)
    radius = _finite(geometry.get("radius"), 30.0)
    half_width = _finite(geometry.get("halfWidth"), 6.0)
    car_length = _finite(meta.get("car_length"), CAR_LENGTH)
    car_width = _finite(meta.get("car_width"), 1.4)
    kart_radius = math.hypot(car_length / 2, car_width / 2)
    inner = radius - half_width + kart_radius
    outer = radius + half_width - kart_radius
    for frame in frames:
        x, _, z = _vec3(frame, "pos")
        distance = math.hypot(x - center_x, z - center_z)
        penetration = max(penetration, max(0.0, inner - distance), max(0.0, distance - outer))

    t50 = next((_finite(frame.get("t")) for frame in frames if _speed(frame) >= 0.5 * BASE_TOP_SPEED), 0.0)
    t95 = next((_finite(frame.get("t")) for frame in frames if _speed(frame) >= 0.95 * BASE_TOP_SPEED), 0.0)

    coast_rates = []
    for previous, current in zip(frames, frames[1:]):
        if _finite(current.get("throttle_input"), 1.0) <= 0 and not current.get("brake", False):
            decel = (_speed(previous) - _speed(current)) / dt if dt > 0 else 0.0
            if decel >= 0:
                coast_rates.append(decel)
    coast_decel = statistics.median(coast_rates) if coast_rates else 0.0

    reverse_values = [-_longitudinal_speed(frame) for frame in frames]
    reverse_ratio = max(0.0, max(reverse_values, default=0.0)) / BASE_TOP_SPEED

    entry_speed, charge_times = _drift_metrics(doc, frames)

    release_events = _events(doc, "miniturbo_release")
    collision_events = _collision_events(doc)
    kart_kart_events = _kart_kart_events(doc)
    landing_events = _landing_events(doc)
    active_steer_frames = [
        frame for frame in frames if abs(_finite(frame.get("steer_input"))) > 0.05
    ]
    normal_yaw = [
        abs(_finite(frame.get("yaw_rate")))
        for frame in active_steer_frames
        if frame.get("drift_state") == "none"
    ]
    drift_yaw = [
        abs(_finite(frame.get("yaw_rate")))
        for frame in active_steer_frames
        if frame.get("drift_state") != "none"
    ]
    yaw_ratio = (statistics.fmean(drift_yaw) / statistics.fmean(normal_yaw)) if drift_yaw and normal_yaw and statistics.fmean(normal_yaw) > 0 else 0.0

    speed_retention = _finite(meta.get("drift_speed_retention"))
    if speed_retention == 0.0:
        speed_retention = _finite(meta.get("baselines", {}).get("speed_retention")) if isinstance(meta.get("baselines"), dict) else 0.0

    steer_changes = []
    for previous, current in zip(frames, frames[1:]):
        old = _finite(previous.get("steer_input"))
        new = _finite(current.get("steer_input"))
        if abs(new - old) > 1e-9:
            steer_changes.append((current, old, new))
    response_lags = []
    settle_times = []
    overshoots = []
    for index, previous in enumerate(frames[:-1]):
        old_steer = _finite(previous.get("steer_input"))
        new_steer = _finite(frames[index + 1].get("steer_input"))
        if abs(new_steer - old_steer) < 1e-9:
            continue
        window = frames[index + 1:index + 61]
        peak = max((abs(_finite(frame.get("yaw_rate"))) for frame in window), default=0.0)
        if peak > 0:
            target = peak * 0.63
            response = next((frame for frame in window if abs(_finite(frame.get("yaw_rate"))) >= target), None)
            if response is not None:
                response_lags.append(max(0.0, (_finite(response.get("t")) - _finite(previous.get("t"))) * 1000.0))
        if old_steer != 0 and new_steer == 0:
            before = abs(_finite(previous.get("yaw_rate")))
            after_window = frames[index + 1:index + 61]
            if before > 0:
                settled = next((frame for frame in after_window if abs(_finite(frame.get("yaw_rate"))) < before * 0.05), None)
                if settled is not None:
                    settle_times.append(max(0.0, _finite(settled.get("t")) - _finite(previous.get("t"))))
                post_sign = [abs(_finite(frame.get("yaw_rate"))) for frame in after_window if _finite(frame.get("yaw_rate")) * _finite(previous.get("yaw_rate")) < 0]
                overshoots.append(max(post_sign, default=0.0) / before)

    calibration_samples = meta.get("steering_radius_samples")
    radius_frames = calibration_samples if isinstance(calibration_samples, list) else frames

    def turn_radius_at_speed(target_ratio: float) -> float:
        low = top_speed * max(0.0, target_ratio - 0.05)
        high = top_speed * min(1.0, target_ratio + 0.05)
        candidates = [
            _speed(frame) / abs(_finite(frame.get("yaw_rate")))
            for frame in radius_frames
            if low <= _speed(frame) <= high
            and abs(_finite(frame.get("steer_input"))) >= 0.8
            and abs(_finite(frame.get("yaw_rate"))) > 1e-9
            and frame.get("grounded", True)
            and _finite(frame.get("collision_impulse")) <= 1e-9
        ]
        return statistics.median(candidates) if candidates else 0.0

    turn_radius_30 = turn_radius_at_speed(0.30)
    turn_radius_60 = turn_radius_at_speed(0.60)
    turn_radius_95 = turn_radius_at_speed(0.95)
    turn_radius_monotonic = (
        turn_radius_30 > 0
        and turn_radius_60 > 0
        and turn_radius_95 > 0
        and turn_radius_30 < turn_radius_60 < turn_radius_95
    )

    surface_metrics = _surface_speed_metrics(doc, frames)
    grass_penalty = surface_metrics["grass"]
    dirt_penalty = surface_metrics["dirt"]

    wall_stick_speed_threshold = BASE_TOP_SPEED * WALL_STICK_SPEED_RATIO
    max_stick = 0
    current_stick = 0
    # §6.5 measures sustained boundary contact at near-zero ground speed.  A
    # stationary contact deliberately has no new collision impulse, so this
    # must use direct wall-contact telemetry rather than impact telemetry.
    for frame in frames:
        if (
            frame.get("wall_contact") is True
            and _speed(frame) < wall_stick_speed_threshold
        ):
            current_stick += 1
            max_stick = max(max_stick, current_stick)
        else:
            current_stick = 0
    # The telemetry records the angle between incoming ground velocity and the
    # wall normal: 0° is head-on, 90° is tangent.  Use a 20–40° band for the
    # BAR's 30° wall scrape and <=15° for the head-on probe.
    wall_retention = _collision_metric(
        collision_events,
        "wall_speed_retention",
        angle_low=20.0,
        angle_high=40.0,
        probe_name="wall-30deg",
    )
    head_on_retention = _collision_metric(
        collision_events,
        "wall_speed_retention",
        angle_high=15.0,
        probe_name="wall-head-on",
    )
    recovery_time = _collision_metric(
        collision_events,
        "recovery_time_s",
        first_impact_per_source=True,
    )
    symmetry = _event_value(kart_kart_events, "impulse_symmetry")
    airborne = [frame for frame in frames if not frame.get("grounded", True)]
    grounded = [frame for frame in frames if frame.get("grounded", True)]
    air_yaw = statistics.fmean(abs(_finite(frame.get("yaw_rate"))) for frame in airborne) if airborne else 0.0
    ground_yaw = statistics.fmean(abs(_finite(frame.get("yaw_rate"))) for frame in grounded) if grounded else 0.0
    air_ratio = air_yaw / ground_yaw if ground_yaw > 0 else 0.0
    gravity_values = []
    for previous, current in zip(frames, frames[1:]):
        if not previous.get("grounded", True) and not current.get("grounded", True):
            _, previous_vy, _ = _vec3(previous, "vel")
            _, current_vy, _ = _vec3(current, "vel")
            gravity_values.append(-(current_vy - previous_vy) / dt if dt > 0 else 0.0)
    gravity = statistics.median(gravity_values) if gravity_values else _finite(meta.get("gravity_us2"))
    landing_retention = _landing_metric(
        landing_events,
        "speed_retention",
        angle_low=45.0,
        probe_name="smooth",
    )
    hard_landing_retention = _landing_metric(
        landing_events,
        "speed_retention",
        angle_high=45.0,
        probe_name="steep",
    )
    air_latency = _landing_metric(landing_events, "latency_ticks")
    input_feedback = _input_feedback_metrics(doc)
    ai_metrics = _ai_metrics(doc)

    metrics: dict[str, float | bool | None] = {
        "tick_dt_variance": 0.0 if abs(dt_variance) < 1e-24 else dt_variance,
        "replay_byte_identical": bool(meta.get("replay_byte_identical", False)),
        "max_penetration_depth": penetration,
        "nan_or_inf_frames": float(_nan_inf_frames(frames)),
        "time_to_50pct_topspeed_s": t50,
        "time_to_95pct_topspeed_s": t95,
        "top_speed_flat_us": top_speed,
        "coast_decel_us2": coast_decel,
        "reverse_top_speed_ratio": reverse_ratio,
        "drift_entry_min_speed_us": entry_speed,
        "tier1_charge_time_s": charge_times[1],
        "tier2_charge_time_s": charge_times[2],
        "tier3_charge_time_s": charge_times[3],
        "car_lengths_gained_tier1": _baseline(doc, 1),
        "car_lengths_gained_tier2": _baseline(doc, 2),
        "car_lengths_gained_tier3": _baseline(doc, 3),
        "miniturbo_duration_tier2_s": _event_value(release_events, "duration_s"),
        "drift_yaw_rate_ratio": yaw_ratio,
        "drift_speed_retention": speed_retention,
        "steer_response_lag_ms": statistics.median(response_lags) if response_lags else 0.0,
        "turn_radius_at_95pct_u": turn_radius_95,
        "yaw_settle_time_s": min(settle_times, default=0.0),
        "yaw_overshoot_ratio": max(overshoots, default=0.0),
        "grass_speed_penalty": grass_penalty,
        "dirt_speed_penalty": dirt_penalty,
        "turn_radius_at_30pct_u": turn_radius_30,
        "turn_radius_at_60pct_u": turn_radius_60,
        "turn_radius_monotonic": turn_radius_monotonic,
        "wall_speed_retention": wall_retention,
        "wall_head_on_retention": head_on_retention,
        "collision_recovery_time_s": recovery_time,
        "kart_kart_impulse_symmetry": symmetry,
        "wall_stick_frames": float(max_stick),
        "air_control_yaw_rate_ratio": air_ratio,
        "gravity_us2": gravity,
        "landing_speed_retention": landing_retention,
        "hard_landing_retention": hard_landing_retention,
        "airborne_to_grounded_latency_ticks": air_latency,
        "input_to_sim_latency_ticks": input_feedback["input_to_sim_latency_ticks"],
        "input_buffer_window_ms": input_feedback["input_buffer_window_ms"],
        "throttle_deadzone": input_feedback["throttle_deadzone"],
        "steer_deadzone": input_feedback["steer_deadzone"],
        "ai_lap_completion": ai_metrics["ai_lap_completion"],
        "ai_overtake_time_s": ai_metrics["ai_overtake_time_s"],
        "difficulty_lap_time_spread_s": ai_metrics["difficulty_lap_time_spread_s"],
        "rubberband_speed_bonus_ratio": ai_metrics["rubberband_speed_bonus_ratio"],
    }
    for tier in (1, 2, 3):
        metric_name = f"car_lengths_gained_tier{tier}"
        reason = _baseline_contamination_reason(doc, tier)
        if reason is not None:
            metrics[f"__{metric_name}_reason"] = reason
    return metrics


def _within(actual: float | bool | None, low: float | bool, high: float | bool) -> bool:
    if actual is None:
        return False
    if isinstance(low, bool):
        return actual is low
    value = _finite(actual, math.inf)
    return value >= float(low) and value <= float(high)


def _relative_gap(actual: float | bool | None, low: float | bool, high: float | bool) -> float:
    if actual is None:
        return math.inf
    if isinstance(low, bool):
        return 0.0 if actual is low else 1.0
    value = _finite(actual, math.inf)
    width = float(high) - float(low)
    if value < float(low):
        return (float(low) - value) / width if width else math.inf
    if value > float(high):
        return (value - float(high)) / width if width else math.inf
    return 0.0


def _delta(actual: float | bool | None, low: float | bool, high: float | bool) -> str:
    if actual is None:
        return "actual=missing; measurement required"
    if isinstance(low, bool):
        return f"actual={str(actual).lower()}; target={str(low).lower()}"
    value = _finite(actual, math.inf)
    if value < float(low):
        return f"actual={value:g}, below lower bound {float(low):g}"
    return f"actual={value:g}, above upper bound {float(high):g}"


def build_verdict(
    metrics: dict[str, float | bool | None],
    *,
    round_number: int = 3,
    artifact: str = "telemetry/lap-a.json",
    budget_remaining: int = 150000,
) -> dict[str, Any]:
    checks = []
    failures = []
    for metric_id, metric_name, low, high, priority in WINDOWS:
        actual = metrics.get(metric_name, 0.0 if not isinstance(low, bool) else False)
        if actual is None:
            actual_for_schema = False if isinstance(low, bool) else 0.0
            delta = str(
                metrics.get(f"__{metric_name}_reason")
                or "actual=missing; measurement required"
            )
            status = "FAIL"
        else:
            actual_for_schema = actual
            status = "PASS" if _within(actual, low, high) else "FAIL"
            delta = _delta(actual, low, high)
        check = {
            "id": metric_id,
            "metric": metric_name,
            "actual": actual_for_schema,
            "window": low if isinstance(low, bool) else [low, high],
            "status": status,
        }
        checks.append(check)
        if status == "FAIL":
            failures.append((priority, -_relative_gap(actual, low, high), metric_id, delta))

    failures.sort()
    verdict = "PASS" if not failures else "FAIL"
    largest_gap = None
    if failures:
        priority, _, metric_id, delta = failures[0]
        largest_gap = {"id": metric_id, "delta": delta, "priority_rank": priority}
    return {
        "round": round_number,
        "wave": "W2",
        "element": "feel-validator",
        "verdict": verdict,
        "bar_ref": "BAR-FEEL.md §2–§8, §12",
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
    parser.add_argument("telemetry", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--artifact", default=None)
    parser.add_argument("--round", type=int, required=True, dest="round_number")
    args = parser.parse_args(argv)
    doc = json.loads(args.telemetry.read_text(encoding="utf-8"))
    verdict = evaluate(doc, round_number=args.round_number, artifact=args.artifact or str(args.telemetry))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(verdict, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"feel: {verdict['verdict']} (largest_gap={verdict['largest_gap']['id'] if verdict['largest_gap'] else 'none'}) -> {args.output}")
    # A valid FAIL is a critic result, not a validator execution error.  The
    # machine-readable verdict carries the PASS/FAIL decision for the loop.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
