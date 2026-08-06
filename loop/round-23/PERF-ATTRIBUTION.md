# R23 perf attribution

The instrumented `perf-probe.mjs` commit is `e7cd3763d02ba47654decade0eee233588dc8967`.
Both runs used the same fixture (`lap-a`), the same `build/out`, and the same build SHA.

`frame_breakdown.p99_frame` is the nearest-rank p99 frame interval. `draw_ms` is
JS-side WebGL submission time, `script_ms` is callback time excluding draw and
trace-aligned GC, and `unattributed_ms` is the residual (browser scheduling,
vsync, or GPU wait). GC intervals are aligned to page time through a trace
anchor and unioned so nested GC trace events are not double-counted.

| environment | `frame_time_p99_ms` | nearest p99 frame | draw | script | GC | unattributed | max GC pause |
|---|---:|---:|---:|---:|---:|---:|---:|
| local M4 | 139.199 | 144.5 | 0.2 | 0.4 | 0.0 | 143.9 | 1.567 |
| container | 224.700 | 232.3 | 0.0 | 0.7 | 0.0 | 231.6 | 0.564 |

The earlier R22 `75.374ms` / `74.453ms` pair cannot be decomposed after the
fact because that artifact did not retain per-frame timings or the trace.
The instrumented rerun does not reproduce that GC-sized pause: in both formal
R23 runs, GC is not present in the nearest p99 frame and the residual dominates.

## 4.2 / 4.3 definition issue

No BAR or validator definition was changed. The current probe sets both
`vehicle_transform_hz` and `camera_hz` to the same `renderedHz` value
(`rendered_frames / elapsed`). This observes rendered WebGL frames, not actual
vehicle-transform or camera update events. Therefore it cannot distinguish a
correct 60 Hz update from a 12 Hz update rendered at 60 Hz; 4.2 and 4.3 are
currently aliases, not independent measurements. The required instrumentation
belongs in the render path and needs a BAR-level decision before the metric
definition is changed.
