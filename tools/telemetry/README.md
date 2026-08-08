# Real-device telemetry prototype

`device-probe` is the first real-device path for BAR-PERF. It reads the shared
`window.__CLAY_RENDER_TELEMETRY__` counters for vehicle transforms, camera
updates, and character animation frames, then changes only the transport:

| target | transport | device-side prerequisite |
|---|---|---|
| Android Chrome | `adb forward` → `localabstract:chrome_devtools_remote` → CDP | USB debugging enabled and the device trusted |
| iPad/iPhone Safari | `ios_webkit_debug_proxy` → Safari Web Inspector target | Safari Web Inspector enabled, trusted device, proxy installed |

Build first, then let the tool serve the build on the LAN:

```sh
npm run build
tools/telemetry/device-probe android --serve --duration 5 --output /tmp/perf-android.json
```

For iOS, open the served URL in Safari if the proxy cannot navigate the
target itself, then run:

```sh
tools/telemetry/device-probe ios --url http://MAC-LAN-IP:4173/index.html \
  --udid DEVICE_UDID --duration 5 --output /tmp/perf-ios.json
```

Use `device-probe check android` or `device-probe check ios` for a
non-measuring prerequisite check. The prototype intentionally leaves metrics
that need render-path events or browser-specific memory APIs as `null`; those
must remain visible FAILs in `perf.py`, never proxy passes.

For a cheap static-scene regression check (no network emulation, input, heap
run, FPS window, or lap measurement), run:

```sh
node tools/telemetry/perf-probe.mjs fixtures/lap-a.json \
  /tmp/perf-scene-only.json proxy local --scene-only
```

`scene-only` reports draw calls, triangles, and texture bytes from the
post-load WebGL instrumentation. `renderer.info` is private inside the
render worktree, so the artifact records this source explicitly. `perf.py`
only evaluates the static §5.3–§5.5 checks for this mode; every runtime check
remains an explicit missing-measurement FAIL.

The iOS route is a bridge to the same Safari Web Inspector connection exposed
by Safari's Develop menu. Apple documents enabling Web Inspector on the device
under Safari → Advanced → Web Inspector; `ios_webkit_debug_proxy` supplies the
scriptable target bridge used here.
