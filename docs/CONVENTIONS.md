# Shared conventions

Everything in this app agrees on the definitions in `src/cube/geometry.ts` and `src/cube/moves.ts`. Read
those two files first; this page only summarises them and fixes the interfaces between the parts.

## Cube state

- A state is a `Uint8Array` of 216 facelets. Index = `face * 36 + row * 6 + col`.
- Faces are in the order **U R F D L B** (0..5). Each face is read row by row as seen from outside:
  - U: seen from above with F at the bottom of the view (row 0 touches B, col 0 touches L)
  - R: seen from the right with U on top (col 0 touches F)
  - F: seen from the front with U on top (col 0 touches L)
  - D: seen from below with F at the top of the view (row 0 touches F, col 0 touches L)
  - L: seen from the left with U on top (col 0 touches B)
  - B: seen from behind with U on top (col 0 touches R)
- A facelet value is a colour id 0..5. Colour ids are arbitrary labels. A 6x6x6 has no fixed centres, so
  nothing may assume that colour k belongs on face k. The value 255 means "unknown" (not yet scanned).
- 3D axes: x right (L to R), y up (D to U), z toward the viewer (B to F). A cubie has integer
  coordinates 0..5 on each axis. `faceletCubie(face, row, col)` and `FACE_NORMALS` give the 3D position.

## Moves

```ts
interface Move { axis: 0 | 1 | 2; lo: number; hi: number; q: number }
```

A move turns the block of layers `lo..hi` (cubie coordinate along `axis`, inclusive) by `q` quarter turns
(1, 2 or 3) **clockwise as seen from the positive end of the axis** (the R, U or F side). In right-handed
3D coordinates that is a rotation by `-q * 90` degrees about the axis. `describeMove(m)` tells you the
outer face a move is named from, the layer range counted from that face, and the clockwise quarter
turns as seen looking at that face. `moveToString(m)` gives the notation ("3Rw'", "2-3Lw2", "2U").

One guided step is one `Move`. The solver only emits blocks that lie in one half of the cube
(layers 0..2 or 3..5), and never whole-cube rotations.

## Who owns what

| Path | Owner | Contents |
| --- | --- | --- |
| `src/cube/` | lead | geometry, move engine, reference engine, piece tables, validation |
| `src/solver/` | lead | the solver and its worker |
| `src/viewer/` | viewer subagent | three.js 3D cube |
| `src/vision/` | vision subagent | photo recognition, quad editor |
| `src/app/`, `index.html`, `src/styles/` | lead | screens and flow |
| `tools/synth/`, `tests/vision*` | vision subagent | synthetic photo rendering and accuracy tests |
| `tests/viewer*`, `demo/viewer.html` | viewer subagent | viewer tests and demo page |

Only the lead commits to git. Subagents leave their work uncommitted in their own paths and do not
edit files outside them (ask the lead instead).

## Style

- TypeScript strict, ES modules, no default exports for our own modules, no framework inside
  `src/viewer` or `src/vision` (plain classes and functions that take DOM elements).
- UI uses the CSS variables in `src/styles/tokens.css`. Dark theme. Phone first: portrait, one hand
  holds the phone and the other the cube, touch targets at least 52 px, nothing depends on hover.
- Tests run with `npx vitest run`. Browser checks use `playwright-core` with the system Chromium at
  `/usr/local/bin/chromium` (launch with `--use-angle=swiftshader --enable-unsafe-swiftshader` for WebGL).
