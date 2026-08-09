# BAR-FEEL R34/R35 clean tier-probe comparison

R34 is the committed pre-clean-measurement baseline (R34 equals R22 for the unchanged metrics). R35 uses the clean tier probes in `lap-a-r35-clean.json`; all three tier measurement windows are fixed at 240 ticks and report `contact_frames_in_window=0`.

| ID | Metric | R34 actual | R35 actual | Delta | R35 |
|---|---|---:|---:|---:|:---:|
| 2.1 | tick_dt_variance | 0 | 0.0 | +0 | PASS |
| 2.2 | replay_byte_identical | true | true | same | PASS |
| 2.3 | max_penetration_depth | 1.4210854715202004e-14 | 1.4210854715202004e-14 | +0 | PASS |
| 2.4 | nan_or_inf_frames | 0 | 0.0 | +0 | PASS |
| 3.1 | time_to_50pct_topspeed_s | 0.8166666666666667 | 0.8166666666666667 | +0 | PASS |
| 3.2 | time_to_95pct_topspeed_s | 3.25 | 3.25 | +0 | PASS |
| 3.3 | top_speed_flat_us | 23.651129145415545 | 23.651129145415545 | +0 | PASS |
| 3.4 | coast_decel_us2 | 5.356931114523 | 5.356931114523 | +0 | PASS |
| 3.5 | reverse_top_speed_ratio | 0.39999647294493657 | 0.39999647294493657 | +0 | PASS |
| 4.1 | drift_entry_min_speed_us | 10.52464672825986 | 10.52464672825986 | +0 | PASS |
| 4.2 | tier1_charge_time_s | 0.8583333333333334 | 0.8583333333333334 | +0 | PASS |
| 4.3 | tier2_charge_time_s | 2.0083333333333337 | 2.0083333333333333 | +0 | PASS |
| 4.4 | tier3_charge_time_s | 3.5083333333333333 | 3.5083333333333333 | +0 | PASS |
| 4.5 | car_lengths_gained_tier2 | 1.5603197783466292 | 1.8221872366182417 | +0.261867 | PASS |
| 4.6 | car_lengths_gained_tier1 | 0.6094193161358005 | 1.0984294333667854 | +0.48901 | PASS |
| 4.7 | car_lengths_gained_tier3 | 3.5947178526799948 | 3.116356716110141 | -0.478361 | PASS |
| 4.8 | miniturbo_duration_tier2_s | 1.0583333333333333 | 1.0583333333333333 | +0 | PASS |
| 4.9 | drift_yaw_rate_ratio | 1.4383758542160103 | 1.4383758542160103 | +0 | PASS |
| 4.10 | drift_speed_retention | 0.9697186324532083 | 0.9697186324532083 | +0 | PASS |
| 5.1 | steer_response_lag_ms | 8.33333333333286 | 8.33333333333286 | +0 | PASS |
| 5.2 | turn_radius_at_95pct_u | 8.447153448094879 | 8.43612105171371 | -0.0110324 | PASS |
| 5.3 | yaw_settle_time_s | 0.17499999999999982 | 0.17499999999999982 | +0 | PASS |
| 5.4 | yaw_overshoot_ratio | 0 | 0.0 | +0 | PASS |
| 5.5 | grass_speed_penalty | 0.6435420428806979 | 0.6435420428806979 | +0 | PASS |
| 5.6 | dirt_speed_penalty | 0.8794263054903919 | 0.8794263054903919 | +0 | PASS |
| 5.7 | turn_radius_at_30pct_u | 4.984649202094081 | 4.992102869181939 | +0.00745367 | PASS |
| 5.8 | turn_radius_at_60pct_u | 6.890051615003511 | 6.854127399677173 | -0.0359242 | PASS |
| 5.9 | turn_radius_monotonic | true | true | same | PASS |
| 6.1 | wall_speed_retention | 0.588189361783879 | 0.5906631456079496 | +0.00247378 | PASS |
| 6.2 | wall_head_on_retention | 0.19588542742629103 | 0.19588542742629103 | +0 | PASS |
| 6.3 | collision_recovery_time_s | 0.2791666666666666 | 0.1833333333333334 | -0.0958333 | FAIL |
| 6.4 | kart_kart_impulse_symmetry | 1 | 1.0 | +0 | PASS |
| 6.5 | wall_stick_frames | 2 | 2.0 | +0 | PASS |
| 7.1 | air_control_yaw_rate_ratio | 0.24166038031670278 | 0.24166038031670278 | +0 | PASS |
| 7.2 | gravity_us2 | 30 | 30.0 | +0 | PASS |
| 7.3 | landing_speed_retention | 1 | 1.0 | +0 | PASS |
| 7.4 | hard_landing_retention | 0.7645012038641997 | 0.7645012038641997 | +0 | PASS |
| 7.5 | airborne_to_grounded_latency_ticks | 0 | 0.0 | +0 | PASS |
| 8.1 | input_to_sim_latency_ticks | 0 | 0.0 | +0 | PASS |
| 8.2 | input_buffer_window_ms | 91.66666666666667 | 91.66666666666667 | +0 | PASS |
| 8.3 | throttle_deadzone | 0 | 0.0 | +0 | PASS |
| 8.4 | steer_deadzone | 0.07999999999999996 | 0.07999999999999996 | +0 | PASS |
| 12.1 | ai_lap_completion | true | true | same | PASS |
| 12.2 | ai_overtake_time_s | 3.6333333333333333 | 3.6333333333333333 | +0 | PASS |
| 12.3 | difficulty_lap_time_spread_s | 3.0166666666666675 | 3.0166666666666675 | +0 | PASS |
| 12.4 | rubberband_speed_bonus_ratio | 1.0032181019026873 | 1.0032181019026873 | +0 | PASS |

Result: 45 / 46 PASS. The only FAIL is §6.3 (`0.1833333333333334` below `[0.20, 0.45]`); §4.5, §4.6, and §4.7 are evaluated from the clean tier probes.
