import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from perf import build_verdict, calculate_metrics


def test_character_animation_is_explicitly_not_applicable_until_renderer_exists():
    metrics = calculate_metrics({
        "metrics": {
            "character_anim_hz": None,
            "character_anim_status": "not_applicable_no_character_animation",
            "vehicle_transform_hz": 60,
            "camera_hz": 60,
        },
    })

    verdict = build_verdict(metrics)

    assert metrics["character_anim_hz"] is None
    assert all(check["id"] != "4.1" for check in verdict["checks"])


def test_missing_character_status_does_not_turn_into_a_pass():
    metrics = calculate_metrics({"metrics": {"character_anim_hz": None}})

    verdict = build_verdict(metrics)

    check = next(check for check in verdict["checks"] if check["id"] == "4.1")
    assert check["actual"] == 0.0
    assert check["status"] == "FAIL"


def test_measured_character_animation_is_validated_when_present():
    metrics = calculate_metrics({"metrics": {"character_anim_hz": 12}})

    verdict = build_verdict(metrics)

    check = next(check for check in verdict["checks"] if check["id"] == "4.1")
    assert check["actual"] == 12.0
    assert check["status"] == "PASS"
