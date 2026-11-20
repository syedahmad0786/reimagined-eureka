# 6x6x6 Rubik's Cube Solver

A web app that reads a scrambled 6x6x6 cube through the phone camera and then walks you through the solution on a 3D model, one turn at a time, at your own pace.

Everything runs in the browser: no backend, no accounts, no API keys. Photos never leave the device. It is built for a phone held in one hand with the cube in the other, and it also works on a laptop. After the first visit it works with no network, and it can be added to the home screen.

## Using it

1. **Scan.** Tap *Scan with the camera* and hold one side of the cube up to it. The app finds the cube in the live picture, tells you what to change ("Move closer", "Hold still"), and takes the photo by itself once the side is lined up and steady. A small 3D cube shows which side comes next: four sides around the middle, then the top, then the bottom. There is also a shutter button, and *Choose a photo* for when the camera cannot be used. *Quick scan* needs only two photos, taken from opposite corners so that each shows three sides. *Use photos* loads six photos you already have (front, right, back, left, top, bottom), and *By hand* skips photos altogether.
2. **See what it read.** After each photo the app shows the photo with a chip on every sticker in the colour it read, and marks the ones it is not sure of. If they match your cube, carry on. If the grid sits in the wrong place, open the grips and drag its corners; they open by themselves when the app is unsure where the cube is.
3. **Check the colours.** The app sorts the 216 stickers into six colours, 36 of each, and shows an editable grid per side. Pick a colour and tap or drag over stickers to fix them. It checks that the colours describe a real cube: 36 of each colour, eight real corner pieces with no twist, a complete set of edge pieces, and four of each colour in every ring of centre pieces. When something is wrong it says which pieces, marks them, and usually offers the fix with *Show* and *Apply*.
4. **Solve.** The app first tells you how to hold the cube: which three-coloured corner goes at the top, front, right, with that corner ringed in the picture. From then on the cube never changes orientation; every step turns layers only. Each step lifts the layers that move, shows the direction with arrows, numbers inner layers, and names the move in notation and in plain words. *Done, next step* plays the turn and shows the next one. A strip shows the four phases (centres, edge pairing, parity fix, final 3x3 stage), and each new phase opens with a short note on what it is for. You also get Back, *Show turn*, Restart, Auto with three speeds and a step slider; after any jump a *Back to step N* button returns you to where you were. *Lost?* opens what to do when your cube stops matching the picture.
5. **Solved.** The last turn ends in a burst of stickers in your cube's colours, with the number of turns and the time you spent.

*Learn* (top right on every screen) explains how a 6x6x6 is solved by hand: the reduction method, the notation, centres, edge pairing, both parities, the 3x3x3 stage, handling a big cube and recovering from a wrong turn. Its algorithms can be played on a 3D cube, and every one is checked on the move engine by the tests.

A reload never loses your place: the scan, the colour check and the solve all come back where they were. Any colour scheme works. The app never assumes which colour belongs on which side; it works that out from the corner pieces.

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
pnpm build        # type check and production build into dist/ (static files and the offline service worker)
pnpm preview      # serve dist/ on http://localhost:4173
pnpm test         # unit tests (cube model, solver, validation, viewer, recognition, Learn content, app words)
```

The camera needs a secure page: `localhost` or HTTPS. Anywhere else the app offers the phone's own camera or photo picker instead. Working offline needs the built copy (`pnpm build`); the dev server registers no service worker.

Longer checks, all in headless Chromium against a running copy (each file's header lists its options):

```
SOLVER_TRIALS=2000 npx vitest run tests/solver.test.ts     # the 2,000-scramble proof (about 15 minutes)
npx tsx scripts/e2e.ts --view phone --cube <dir>            # six photos in, corrections, every step to the celebration
npx tsx scripts/e2e-corner.ts <dir> [<dir> ...]             # quick scan: two corner photos against the true state
npx tsx scripts/e2e-extra.ts --url http://localhost:4173/ --offline 1
                                                            # live camera, no camera, manual entry, reload at every stage,
                                                            # Learn, phase notes, celebration, reduced motion, no network
```

### Deploying

`dist/` is a plain static site and can be hosted anywhere. Serve `sw.js` and `index.html` without long-lived caching so that a new build is picked up. The repository is set up for Cloudflare Workers static assets (`wrangler.jsonc`, Worker name `rubiks-6x6-solver`):

```
pnpm run deploy   # pnpm build && wrangler deploy; needs CLOUDFLARE_API_TOKEN with "Workers Scripts: Edit"
```

## How it works

```
src/cube      cube model: 216 stickers, move engine, a second independent engine, piece tables, validation
src/solver    the solver and its Web Worker
src/vision    recognition: live cube finding in a Web Worker, automatic capture, sampling, colour clustering, the read-out and the outline editors
src/viewer    the three.js cube: highlight, arrows, layer numbers, turn animation
src/learn     the Learn topics and algorithms, as data
src/app       the screens (Preact)
```

`docs/CONVENTIONS.md` defines the sticker order, the axes and the move type that every part shares. `PRODUCT.md` and `DESIGN.md` describe who the app is for and the visual system: the interface is drawn in the one hue family a cube does not have, so the six sticker colours never have to compete with it.

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

In the live camera the cube is found on every frame in a Web Worker, so the page stays smooth. A photo is taken only when the outline has held still through a short countdown and a fresh, thorough search of the next frame lands on the same outline; a capture on a wrong outline is the one mistake the app must not make by itself. Each photo is reduced to 36 sticker samples per side: the outline is snapped to the sticker grid and can be corrected by hand. All 216 samples are then clustered together into six groups of exactly 36, with a per-photo lighting correction, so nothing depends on fixed colour thresholds or on a particular colour scheme. Measured before any correction (details and method in `docs/vision-report.md`):

| Test | Stickers read correctly |
| --- | --- |
| 66 synthetic cubes (11 lighting, tilt and background conditions), six photos, outlines found automatically in Chromium | 97.72% (47 of 66 cubes with no wrong sticker) |
| the same with the true outlines | 99.46% |
| the same cubes as two corner photos, true outlines | 99.60% |
| the same cubes as two corner photos, outlines found automatically (Node) | 95.25% |
| five real corner photos of one cube, every visible sticker | 100%, and the photos agree on one valid cube state |

Through the live camera (Chromium with a fake camera fed rendered clips of a cube being brought into view, no correction, final code):

| Test | Captured by itself | On a wrong outline | Stickers read correctly |
| --- | --- | --- | --- |
| six photos, 11 cubes | 64 of 66 sides, median 2.2 s | 0 of 64 | 98.95% |
| quick scan, 11 cubes | 21 of 22 shots, median 2.1 s | 0 of 21 | 99.24% |
| six photos, glare clips | 35 of 36 | 0 of 35 | 97.07% |
| quick scan, glare clips | 10 of 12 | 0 of 10 | 95.83% |
| quick scan, cluttered background, 6 cubes | 9 of 12 | 0 of 9 | 100% |
| the real corner photos as two pairs | 4 of 4 | 0 of 4 | 100% |

A larger run on 33 cubes, made before the last change to the confirmation step, read 99.37% (six photos) and 99.20% (quick scan) with no capture on a wrong outline. Where the camera did not fire by itself the shutter button was used, and every one of those outlines was right. With the processor slowed four times, 15 of 16 clips still captured by themselves and the longest pause between frames was 200 ms. The final code has not been run on all 66 cubes, and nothing has been measured on a real phone.

In the photos-only path, almost all of the loss comes from an outline found in the wrong place, which is why the outline is always shown for checking and flagged when the finder is unsure. The synthetic photos are rendered from the 3D cube by `tools/synth`. No real straight-on photos have been tested yet.

Recognition is never trusted blindly. The correction screen always comes next, and the validation there catches almost every misread sticker, because a wrong sticker nearly always breaks a piece count.

## Limits

- Only 6x6x6 cubes.
- A valid-looking scan is not proof that every sticker was read correctly: two centre stickers of the same ring read the wrong way round still give a real cube state. If the cube on screen stops matching yours during the solve, go back to the colour check.
- The 3D view needs WebGL.
- Camera reading has been measured with rendered clips and five real photos in desktop Chromium, not on a phone.
