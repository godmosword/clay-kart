import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from perf import build_verdict, calculate_metrics


def test_character_animation_is_required_when_renderer_is_present():
    metrics = calculate_metrics({
        "metrics": {
            "character_anim_hz": None,
            "character_anim_status": "not_applicable_no_character_animation",
            "vehicle_transform_hz": 60,
            "camera_hz": 60,
        },
    })

    verdict = build_verdict(metrics)

    assert metrics["character_anim_hz"] == 0.0
    check = next(check for check in verdict["checks"] if check["id"] == "4.1")
    assert check["status"] == "FAIL"


def test_missing_character_status_does_not_turn_into_a_pass():
    metrics = calculate_metrics({"metrics": {"character_anim_hz": None}})

    verdict = build_verdict(metrics)

    check = next(check for check in verdict["checks"] if check["id"] == "4.1")
    assert check["actual"] == 0.0
    assert check["status"] == "FAIL"


def test_missing_render_telemetry_fails_all_three_section_four_checks():
    verdict = build_verdict(calculate_metrics({
        "metrics": {
            "vehicle_transform_hz": None,
            "camera_hz": None,
            "character_anim_hz": None,
        },
    }))

    for metric_id in ("4.1", "4.2", "4.3"):
        check = next(check for check in verdict["checks"] if check["id"] == metric_id)
        assert check["status"] == "FAIL"


def test_missing_rendered_frames_does_not_synthesize_section_four_rates():
    verdict = build_verdict(calculate_metrics({
        "metrics": {
            "render_telemetry_counters": {
                "vehicleTransformUpdates": 120,
                "cameraUpdates": 120,
                "characterAnimationFrames": 24,
            },
            "vehicle_transform_hz": None,
            "camera_hz": None,
            "character_anim_hz": None,
        },
    }))

    for metric_id in ("4.1", "4.2", "4.3"):
        check = next(check for check in verdict["checks"] if check["id"] == metric_id)
        assert check["actual"] == 0.0
        assert check["status"] == "FAIL"


def test_measured_character_animation_is_validated_when_present():
    metrics = calculate_metrics({"metrics": {"character_anim_hz": 12, "fps_p05": 60}})

    verdict = build_verdict(metrics)

    check = next(check for check in verdict["checks"] if check["id"] == "4.1")
    assert check["actual"] == 12.0
    assert check["status"] == "PASS"


def test_measured_render_telemetry_rates_pass_section_four():
    verdict = build_verdict(calculate_metrics({
        "metrics": {
            "character_anim_hz": 12,
            "vehicle_transform_hz": 60,
            "camera_hz": 60,
            "fps_p05": 60,
        },
    }))

    assert all(
        check["status"] == "PASS"
        for check in verdict["checks"]
        if check["id"] in {"4.1", "4.2", "4.3"}
    )


def test_missing_gc_and_texture_measurements_are_explicit_failures():
    verdict = build_verdict(calculate_metrics({
        "meta": {
            "laps_measured": 5,
            "heap_measurement_status": "measured",
            "heap_growth_measurement": "single continuous race-session heap delta divided by its SimSnapshot lap count",
            "network_profile": {
                "name": "4g-4mbps-20ms",
                "latency_ms": 20,
                "download_throughput_bps": 524288,
                "upload_throughput_bps": 131072,
                "connection_type": "cellular4g",
                "cdp_method": "Network.emulateNetworkConditions",
            },
        },
        "metrics": {
            "character_anim_hz": 12,
            "character_anim_status": "not_applicable_no_character_animation",
            "vehicle_transform_hz": 60,
            "camera_hz": 60,
            "fps_p50": 60,
            "fps_p05": 60,
            "heap_growth_per_lap_mb": 1,
            "frame_time_p99_ms": 1,
            "long_frame_count": 0,
            "first_interactive_s": 1,
            "initial_bundle_kb_gz": 1,
            "total_assets_mb": 1,
            "time_to_first_render_s": 1,
            "heap_peak_mb": 1,
            "draw_calls": 1,
            "triangles_k": 1,
        },
    }))

    for metric_id in ("2.5", "5.5"):
        check = next(check for check in verdict["checks"] if check["id"] == metric_id)
        assert check["actual"] == 0.0
        assert check["status"] == "FAIL"
    assert verdict["largest_gap"]["id"] == "2.5"
    assert "measurement required" in verdict["largest_gap"]["delta"]


def test_measured_zero_for_gc_and_texture_is_a_real_pass():
    verdict = build_verdict(calculate_metrics({
        "metrics": {
            "gc_pause_max_ms": 0,
            "texture_memory_mb": 0,
        },
    }))

    for metric_id in ("2.5", "5.5"):
        check = next(check for check in verdict["checks"] if check["id"] == metric_id)
        assert check["actual"] == 0.0
        assert check["status"] == "PASS"


def test_heap_growth_is_missing_until_five_simulation_laps_are_recorded():
    verdict = build_verdict(calculate_metrics({
        "meta": {
            "laps_measured": 4,
            "heap_measurement_status": "incomplete_five_lap_run",
            "heap_growth_measurement": "single continuous race-session heap delta divided by its SimSnapshot lap count",
        },
        "metrics": {"heap_growth_per_lap_mb": 0.1},
    }))

    check = next(check for check in verdict["checks"] if check["id"] == "5.2")
    assert check["actual"] == 0.0
    assert check["status"] == "FAIL"


def test_load_timings_require_a_recorded_four_g_profile():
    verdict = build_verdict(calculate_metrics({
        "metrics": {
            "first_interactive_s": 0.1,
            "time_to_first_render_s": 0.1,
        },
    }))

    for metric_id in ("3.1", "3.4"):
        check = next(check for check in verdict["checks"] if check["id"] == metric_id)
        assert check["actual"] == 0.0
        assert check["status"] == "FAIL"


def test_load_timings_are_valid_with_recorded_four_g_profile():
    verdict = build_verdict(calculate_metrics({
        "meta": {
            "network_profile": {
                "name": "4g-4mbps-20ms",
                "latency_ms": 20,
                "download_throughput_bps": 524288,
                "upload_throughput_bps": 131072,
                "connection_type": "cellular4g",
                "cdp_method": "Network.emulateNetworkConditions",
            },
        },
        "metrics": {
            "first_interactive_s": 0.1,
            "time_to_first_render_s": 0.1,
        },
    }))

    for metric_id in ("3.1", "3.4"):
        check = next(check for check in verdict["checks"] if check["id"] == metric_id)
        assert check["actual"] == 0.1
        assert check["status"] == "PASS"


def test_high_render_rate_uses_the_hz_window_for_character_animation():
    verdict = build_verdict(calculate_metrics({
        "metrics": {
            "fps_p05": 60,
            "character_anim_hz": 12,
            "character_animation_per_frame": 0.8,
        },
    }))

    check = next(check for check in verdict["checks"] if check["id"] == "4.1")
    assert check["metric"] == "character_anim_hz"
    assert check["window"] == [11.5, 12.5]
    assert check["status"] == "PASS"
    assert "mode=hz_12_window" in verdict["bar_ref"]


def test_low_render_rate_uses_the_quantization_ratio_window():
    verdict = build_verdict(calculate_metrics({
        "metrics": {
            "fps_p05": 20,
            "character_anim_hz": 9,
            "render_telemetry_ratios": {
                "characterAnimationPerFrame": 0.6,
            },
        },
    }))

    check = next(check for check in verdict["checks"] if check["id"] == "4.1")
    assert check["metric"] == "character_animation_per_frame"
    assert check["window"] == [0.51, 0.69]
    assert check["actual"] == 0.6
    assert check["status"] == "PASS"
    assert "mode=quantization_ratio_two_sided_window" in verdict["bar_ref"]


def test_zero_animation_ratio_fails_the_two_sided_ratio_window():
    verdict = build_verdict(calculate_metrics({
        "metrics": {
            "fps_p05": 20,
            "character_animation_per_frame": 0.0,
        },
    }))

    check = next(check for check in verdict["checks"] if check["id"] == "4.1")
    assert check["window"] == [0.51, 0.69]
    assert check["status"] == "FAIL"


def test_section_four_one_has_three_non_overlapping_sampling_segments():
    fast = build_verdict(calculate_metrics({
        "metrics": {"fps_p05": 24.01, "character_anim_hz": 12},
    }))
    fast_check = next(check for check in fast["checks"] if check["id"] == "4.1")
    assert fast_check["metric"] == "character_anim_hz"
    assert fast_check["window"] == [11.5, 12.5]
    assert fast_check["status"] == "PASS"

    ratio = build_verdict(calculate_metrics({
        "metrics": {"fps_p05": 24.0, "character_animation_per_frame": 0.5},
    }))
    ratio_check = next(check for check in ratio["checks"] if check["id"] == "4.1")
    assert ratio_check["window"] == [0.425, 0.575]
    assert ratio_check["status"] == "PASS"

    too_slow = build_verdict(calculate_metrics({
        "metrics": {"fps_p05": 12.63, "character_animation_per_frame": 1.0},
    }))
    too_slow_check = next(check for check in too_slow["checks"] if check["id"] == "4.1")
    assert too_slow_check["window"] == [1.0, 1.0]
    assert too_slow_check["status"] == "FAIL"
    assert "character_anim_unmeasurable_render_too_slow" in too_slow["largest_gap"]["delta"]
    assert "fps_p05=12.63" in too_slow["largest_gap"]["delta"]


def test_swiftshader_temporal_failures_are_attributed_to_the_environment():
    verdict = build_verdict(calculate_metrics({
        "meta": {
            "render_backend": "swiftshader_software",
            "gl_renderer": "ANGLE (SwiftShader Device (Subzero))",
        },
        "metrics": {
            "fps_p50": 60,
            "fps_p05": 60,
            "frame_time_p99_ms": 10,
            "long_frame_count": 0,
            "vehicle_transform_hz": 60,
            "camera_hz": 60,
            "character_anim_hz": 12,
        },
    }))

    for metric_id in ("2.1", "2.2", "2.3", "2.4", "4.2", "4.3"):
        check = next(check for check in verdict["checks"] if check["id"] == metric_id)
        assert check["status"] == "FAIL"
    assert "render_backend:swiftshader_software" in verdict["largest_gap"]["delta"]
    assert "application performance is unknown" in verdict["largest_gap"]["delta"]


def test_smooth_animation_ratio_one_fails_at_high_render_rate():
    verdict = build_verdict(calculate_metrics({
        "metrics": {
            "fps_p05": 60,
            "character_anim_hz": 60,
            "character_animation_per_frame": 1.0,
        },
    }))

    check = next(check for check in verdict["checks"] if check["id"] == "4.1")
    assert check["status"] == "FAIL"


def test_smooth_animation_ratio_one_fails_at_low_render_rate():
    verdict = build_verdict(calculate_metrics({
        "metrics": {
            "fps_p05": 20,
            "character_anim_hz": 20,
            "character_animation_per_frame": 1.0,
        },
    }))

    check = next(check for check in verdict["checks"] if check["id"] == "4.1")
    assert check["metric"] == "character_animation_per_frame"
    assert check["status"] == "FAIL"


def test_scene_only_artifact_only_verdicts_static_scene_metrics():
    verdict = build_verdict(calculate_metrics({
        "meta": {"mode": "scene-only"},
        "metrics": {
            "draw_calls": 100,
            "triangles_k": 200,
            "texture_memory_mb": 10,
            "fps_p50": 60,
            "character_anim_hz": 12,
            "vehicle_transform_hz": 60,
            "camera_hz": 60,
            "heap_growth_per_lap_mb": 0,
        },
    }))

    statuses = {check["id"]: check["status"] for check in verdict["checks"]}
    assert statuses["5.3"] == "PASS"
    assert statuses["5.4"] == "PASS"
    assert statuses["5.5"] == "PASS"
    for metric_id in ("2.1", "2.2", "2.3", "2.4", "2.5", "4.1", "4.2", "4.3", "5.1", "5.2"):
        assert statuses[metric_id] == "FAIL"


def test_scene_only_missing_static_metric_is_not_a_zero_pass():
    verdict = build_verdict(calculate_metrics({
        "meta": {"mode": "scene-only"},
        "metrics": {"draw_calls": 100, "triangles_k": 200},
    }))

    texture_check = next(check for check in verdict["checks"] if check["id"] == "5.5")
    assert texture_check["actual"] == 0.0
    assert texture_check["status"] == "FAIL"
