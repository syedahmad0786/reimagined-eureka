# 6x6x6 Rubik's Cube Solver

A web app that reads a scrambled 6x6x6 cube from six photos and then walks you through the solution on a 3D model, one turn at a time, at your own pace.

Everything runs in the browser: no backend, no accounts, no API keys. Photos never leave the device. It is built for a phone held in one hand with the cube in the other, and it also works on a laptop.

## Using it

1. **Scan.** Tap *Scan with the camera* and take one straight-on photo of each side. A small 3D cube shows which side to shoot next and how to turn the cube to get there: four sides around the middle (each a quarter turn to the left), then the top, then the bottom. You can also load six photos you already have (in the order front, right, back, left, top, bottom), or skip photos and enter the colours by hand. *Quick scan* needs only two photos, taken from opposite corners so that each shows three sides; in exchange you check a seven-point outline instead of four corners.
2. **Check the outline.** After each photo the app lays a 6x6 grid over the stickers. If it is off, drag the four corner grips; a loupe shows the corner under your finger.
3. **Check the colours.** The app sorts the 216 stickers into six colours, 36 of each, and shows an editable grid per side. Pick a colour and tap or drag over stickers to fix them. *Show photo* swaps the grid for the photo it came from. The app checks that the colours describe a real cube: 36 of each colour, eight real corner pieces with no twist, a complete set of edge pieces, and four of each colour in every ring of centre pieces. When something is wrong it says which pieces, outlines them in red, and often offers the fix (a sticker to change, two to swap, or a side that was photographed the wrong way up).
4. **Solve.** The app first tells you how to hold the cube: which three-coloured corner goes at the top, front, right. From then on the cube never changes orientation; every step turns layers only. Each step highlights the layers that move, shows the direction with arrows, and names the move in big-cube notation and in plain words. *Done, next step* plays the turn and shows the next one. You also get Back, *Show turn* (plays the current step and puts it back), Start, Auto with three speeds, a step slider, the step counter and the phase name (centres, edge pairing, parity fix, final 3x3 stage). Drag the picture to look around the cube. Progress is saved in the browser, so a reload offers *Resume last solve*.

Any colour scheme works. The app never assumes which colour belongs on which side; it works that out from the corner pieces.

### Notation

| Notation | Meaning |
| --- | --- |
| `R` | the outer right layer, a quarter turn clockwise (looking at that face) |
| `R'`, `R2` | the same, anticlockwise; a half turn |
| `Rw`, `3Rw` | the two (three) outer right layers together |
| `2R`, `3R` | only the second (third) layer from the right |
| `2-3Rw` | the second and third layers from the right together |

The faces are U (top), D (bottom), F (front), B (back), L (left), R (right). One step is always one physical turn: a single layer or a block of neighbouring layers.

## Running it

Needs Node 22 or newer and pnpm.

```
pnpm install
pnpm dev          # dev server on http://localhost:5173
pnpm build        # type check and production build into dist/ (static files)
pnpm preview      # serve dist/ on http://localhost:4173
pnpm test         # unit tests (cube model, solver, validation, viewer, recognition)
```

The camera needs a secure page: `localhost` or HTTPS. On a plain-HTTP address the app falls back to the phone's own camera or photo picker.

Longer checks:

```
SOLVER_TRIALS=2000 npx vitest run tests/solver.test.ts     # the 2,000-scramble proof (about 15 minutes)
npx tsx scripts/e2e.ts --view phone --cube <dir>            # whole flow in headless Chromium, see the file header
```

### Deploying

`dist/` is a plain static site and can be hosted anywhere. The repository is set up for Cloudflare Workers static assets (`wrangler.jsonc`, Worker name `rubiks-6x6-solver`):

```
pnpm run deploy   # pnpm build && wrangler deploy; needs CLOUDFLARE_API_TOKEN with "Workers Scripts: Edit"
```

## How it works

```
src/cube      cube model: 216 stickers, move engine, a second independent engine, piece tables, validation
src/solver    the solver and its Web Worker
src/vision    photo recognition: outline detection, sampling, colour clustering, camera and outline editors
src/viewer    the three.js cube: highlight, arrows, turn animation
src/app       the screens (Preact)
```

`docs/CONVENTIONS.md` defines the sticker order, the axes and the move type that every part shares.

### The cube model

A state is 216 colour ids, six faces of 36. A move is "layers lo..hi along an axis, q quarter turns". Moves are permutations built from 3D geometry, and a second engine written differently (it rotates sticker positions as vectors) replays them in the tests, together with a 3x3x3 library for outer turns. Every one of the 378 block moves is checked to be a correct permutation.

### The solver

It uses the reduction method, tuned to keep the number of turns low. A scrambled cube takes about 186 steps on average.

1. **Centres** (about 97 steps). The 96 centre pieces are solved one side at a time, each side as four bars. For every bar there is a precomputed table of the shortest way to build it without disturbing what is already done, so solving a bar is a lookup and a full centre solution costs well under a millisecond. That makes it cheap to try many plans (24 orientations times 24 ways to place the colours) and keep the shortest. The last two sides are solved together by a small optimal search.
2. **Edge pairing** (about 65 steps). The 48 edge wings are brought together into twelve groups of four by "free slice" pairing: inner layers are offset, short outer-turn triggers move edges in and out of the belt, and the layers are restored. A beam search over these steps picks which wings to pair next.
3. **Final 3x3 stage** (about 21 steps). With centres and edges done, the cube behaves like a 3x3x3 under outer turns and is finished by Kociemba's two-phase algorithm ([cubejs](https://github.com/ldez/cubejs)).

Even-sized cubes have two parity problems a 3x3x3 never shows. The first ("OLL parity", one flipped edge group) is avoided rather than fixed: a quarter turn of an inner layer changes the parity of the edge wings, so the centre stage is told which parity it must leave behind and picks its last unbalanced bar accordingly. The second ("PLL parity", two swapped edge groups) appears in about half of all scrambles and is fixed with a six-turn sequence before the final stage.

Afterwards the whole sequence is shortened: turns about the same axis are combined, moves that undo each other disappear, and neighbouring layers that turn the same way become one block turn. The solver never emits a whole-cube rotation, and a block never crosses the middle of the cube. Before a solution is returned it is replayed on the independent engine and must leave the cube solved.

The solver runs in a Web Worker. Building its tables takes about two seconds once per page load (it starts in the background as soon as the page opens); a solve then takes about half a second.

Measured on 2,000 random cubes (random colour labellings and orientations, half of them uniformly random states), every one solved and verified on the second engine:

| | steps | time per solve |
| --- | --- | --- |
| mean | 185.6 | 0.48 s |
| median | 185 | 0.45 s |
| 95th percentile | 197 | 0.71 s |
| worst | 210 | 2.4 s |

Times are from Node on a shared 4-core machine.

### Recognition

Each photo is reduced to 36 sticker samples: the outline is found automatically, snapped to the sticker grid, and can be corrected by hand. All 216 samples are then clustered together into six groups of exactly 36, with a per-photo lighting correction, so nothing depends on fixed colour thresholds or on a particular colour scheme. Measured before any correction (details and method in `docs/vision-report.md`):

| Test | Stickers read correctly |
| --- | --- |
| 66 synthetic cubes (11 lighting, tilt and background conditions), six photos, outlines found automatically in Chromium | 97.72% (47 of 66 cubes with no wrong sticker) |
| the same with the true outlines | 99.46% |
| the same cubes as two corner photos, true outlines | 99.60% |
| the same cubes as two corner photos, outlines found automatically (Node) | 95.25% |
| five real corner photos of one cube, every visible sticker | 100%, and the photos agree on one valid cube state |

Almost all of the loss comes from an outline found in the wrong place, which is why the outline is always shown for checking and flagged when the finder is unsure. The synthetic photos are rendered from the 3D cube by `tools/synth`. No real straight-on photos have been tested yet.

Recognition is never trusted blindly. The correction screen always comes next, and the validation there catches almost every misread sticker, because a wrong sticker nearly always breaks a piece count.

## Limits

- Only 6x6x6 cubes.
- A valid-looking scan is not proof that every sticker was read correctly: two centre stickers of the same ring read the wrong way round still give a real cube state. If the cube on screen stops matching yours during the solve, go back to the colour check.
- The 3D view needs WebGL.
