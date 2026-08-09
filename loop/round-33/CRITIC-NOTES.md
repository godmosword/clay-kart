# R33 visual critic — three-run summary

The prompt file was not modified. All three run records used the same material
hashes:

- `contact-sheet.png`: `292efc2b08c7876f831693d118e18afdc1257f4532f648b73e271676b7c39e3f`
- `game-scene.png`: `6cc2f61a7e9a0df4f135b5a2b483c539010bd3b3f96c2c8f167ea17cab316ee8`

The §1.2 index check was correct in all three runs: `r0c0`, `r1c1`, `r2c1`,
and `r5c1` were identified as the four all-placeholder groups.

## Scored groups

| Group | run 1 | run 2 | run 3 | Median | Window | Result |
|---|---:|---:|---:|---:|---:|---|
| `r0c1` | 3 | 3 | 3 | 3 | 4–5 | FAIL |
| `r1c0` | 3 | 4 | 3 | 3 | 4–5 | FAIL |
| `r3c1` | 3 | 3 | 3 | 3 | 4–5 | FAIL |
| `r5c0` | 3 | 3 | 3 | 3 | 4–5 | FAIL |

All four scored groups have cross-run spread below 2 points, so the median is
usable under the pre-committed reading rule. The stable gap is that the
realtime renders have the intended rounded, matte clay direction but remain
visibly simpler and more regular than the close-up hand-shaped photographs:
surface marks, pressed seams, and irregular joins are less legible.

The one unstable absolute judgment is `r1c0` (3/4/3); its segment gaps are
clear, but segment regularity makes the boundary between 3 and 4 sensitive to
how strongly the close-up reference texture is weighted. Its preference
direction is unchanged.

## Unscored groups

`r2c0`, `r3c0`, `r4c0`, and `r4c1` do not have valid A/B pairs and were not
given 1–5 scores. Their visible halves were reported in each raw run and are
mechanical/coverage observations only. The four all-placeholder groups were
also skipped as required.

## Assembled scene

`game-scene.png` is a rear-following view. It shows a compact soft contact
shadow, readable road/grass/curb assembly, and coherent soft daylight. It does
not show the front of the kart, so it cannot establish the assembled-state
front-facing §5.3 requirement that the driver's eyes and smile remain visible.

Raw records: `artifacts/CRITIC-run1.md`, `artifacts/CRITIC-run2.md`,
`artifacts/CRITIC-run3.md`.
