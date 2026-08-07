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
    metrics = calculate_metrics({"metrics": {"character_anim_hz": 12}})

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
        },
    }))

    assert all(
        check["status"] == "PASS"
        for check in verdict["checks"]
        if check["id"] in {"4.1", "4.2", "4.3"}
    )


def test_missing_gc_and_texture_measurements_are_explicit_failures():
    verdict = build_verdict(calculate_metrics({
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
