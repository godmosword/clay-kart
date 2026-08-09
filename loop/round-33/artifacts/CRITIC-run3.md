# R33 visual critic — run 3

## 1. Index check

The all-placeholder groups are `r0c0`, `r1c1`, `r2c1`, and `r5c1`.

## 2. Contact-sheet reading

This run used the same material hashes:

- `contact-sheet.png`: `292efc2b08c7876f831693d118e18afdc1257f4532f648b73e271676b7c39e3f`
- `game-scene.png`: `6cc2f61a7e9a0df4f135b5a2b483c539010bd3b3f96c2c8f167ea17cab316ee8`

| Group | Realtime render side | Score for realtime render | Current gap |
|---|---|---:|---|
| `r0c0` | both placeholder halves | — | Both sides are placeholders. |
| `r0c1` | right | 3/5 | The rendered road is matte and correctly sand/clay colored, but its surface reads as repeated fine rendering marks over a flat slab; the pressed-clay mass and grass seam are less convincing than §5.0 and §5.4 require. |
| `r1c0` | right | 3/5 | Segment breaks are visible and the alternating palette is correct, but the repeated blocks are too uniform and clean to read as individually hand-joined pieces under §5.0 and §5.5. |
| `r1c1` | both placeholder halves | — | Both sides are placeholders. |
| `r2c0` | left placeholder; no realtime render | — | One-sided reference material; no A/B score. |
| `r2c1` | both placeholder halves | — | Both sides are placeholders. |
| `r3c0` | right placeholder; no realtime render | — | One-sided reference material; no A/B score. |
| `r3c1` | left | 3/5 | The realtime car has a recognizable rounded toy form and a restrained matte palette, but its surface and attachments are simplified compared with the reference's visible seams and pressed marks (§5.0, §5.1). |
| `r4c0` | left; no reference half | mechanical only | The wheel is visibly thick and matte, with separate tire, cream ring, and red hub; no reference half is present for a 1–5 score. |
| `r4c1` | left; no reference half | mechanical only | The tree crown reads as a rounded mass with raised leaf-like forms; no reference half is present for a 1–5 score. |
| `r5c0` | left | 3/5 | The face has large eyes and an unmistakable smile, but the flat rectangular plate and simpler layered construction are distinguishable from the rounded, integrated clay face (§5.0, §5.3). |
| `r5c1` | both placeholder halves | — | Both sides are placeholders. |

The four scored groups are `r0c1`, `r1c0`, `r3c1`, and `r5c0`.

## 3. Game scene

- §5.3: the image is a rear view, not the required front-facing assembled view.
  The driver's face and smile cannot be seen, so this screenshot cannot establish
  that the face remains visible after assembly.
- A compact soft contact shadow is visible below the kart and stays close to the
  underside; it does not read as a long, hard projection.
- The alternating barriers are visibly separate from the road, and the road,
  grass, and curb boundaries remain readable through the bend.
- The scene lighting is shared and soft: the matte road, trees, curbs, and kart
  do not show conflicting hard highlights or a separate per-object light.

## 4. Confidence

I am least certain about the absolute score of `r0c1` and `r1c0`; both are
affected by the different framing and scale of the close-up photograph. The
direction of the gap is stable. The three scores for `r3c1` and `r5c0` are
more stable because the simplified geometry and facial layering are obvious.
