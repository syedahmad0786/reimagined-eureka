# Photo recognition: what was built and how well it reads a cube

This report covers `src/vision`: turning photos of a 6x6x6 cube into 216 sticker colours. All numbers
below were measured on this machine on 19 November 2026 and can be reproduced with the commands in the
last section. Nothing here is estimated.

## Short version

- **Reading colours works when the outline is right.** On 66 synthetic cubes in 11 lighting and camera
  conditions, 99.46% of stickers are read correctly before any correction (77 wrong of 14,256), and 52 of
  the 66 cubes have no wrong sticker at all. Glare is the weak condition: about 97.4% there, and most
  glare cubes need a few corrections.
- **Finding the outline without help is the weaker step.** With the outline found automatically and no
  manual adjustment, accuracy in Chromium is 97.72% (325 wrong). Almost all of that loss comes from 7 of
  396 face outlines that were found in the wrong place; one wrong outline typically adds 30 to 45 wrong
  stickers to that cube. The outline must stay visible and adjustable, as it is in the app now.
- **The five real photos read perfectly.** Every sticker visible in the five reference photos is read
  correctly (0 wrong), with outlines I placed and snapped and also with fully automatic outlines.
- **The five photos show one valid cube.** All 216 stickers are covered, each is seen in at least two
  photos, no two photos disagree, each colour appears 36 times, and the lead's `validateState` accepts
  the state with no problems.
- **Two-photo corner mode: ship it as an option, not as the default.** With a correct outline it is as
  accurate as six straight-on photos (99.60% against 99.46% on the synthetic set; 0 wrong on the real
  cube for both photo pairs). Its automatic outline fails on cluttered backgrounds, so it needs the
  outline editor in front of the user.
- **The lead's 40 of 216 for `glare2/cube-012-mixed-hard` is real and I reproduce it in Chromium.** My
  Node evaluation gives 0 wrong for the same cube, because the two JPEG decoders produce slightly
  different pixels and that flips the outline of one face. Details below.

## What is in the module

| File | Contents |
| --- | --- |
| `src/vision/types.ts` | `Point`, `Quad`, `ImageLike`, `FaceSample`, `Classification`, `ColourName`, `CornerOutline` |
| `src/vision/color.ts` | sRGB to linear light and back |
| `src/vision/homography.ts` | mapping between the unit square and a quad; `centredSquareQuad` |
| `src/vision/sample.ts` | `sampleFace` (36 sticker colours plus a quality score each), `rectifyFace`, `faceSampleFromRgb` |
| `src/vision/assign.ts` | exact balanced assignment (36 stickers per colour) |
| `src/vision/classify.ts` | `classifyCube` |
| `src/vision/refine.ts` | edge map and snapping of outline points to the sticker grid |
| `src/vision/detect.ts` | `detectFaceQuad`, `detectCornerOutline` |
| `src/vision/corner.ts` | corner shots: `cornerQuads`, `sampleCornerShot`, `cornerFaceletMap`, `assembleCornerShots`, `allCornerViews`, `TWO_SHOT_VIEWS` |
| `src/vision/load.ts` | `loadImageFile`, `toImageData`, `imageDataToCanvas`, `snapQuad`, `snapOutline`, `locateFaceNear`, `WORKING_SIZE` |
| `src/vision/point-editor.ts`, `quad-editor.ts`, `outline-editor.ts` | draggable outline editors (4 points for a face, 7 for a corner shot) |
| `src/vision/camera.ts` | `CameraCapture`: live camera with a square guide, shutter, and a file fallback when the camera is refused |
| `src/vision/index.ts` | the public entry point |
| `demo/vision.html` | test bench page (load a set with `?set=/tmp/vision/synth/v3/cube-000-easy`, add `&mode=corner` or `&detect=1`) |
| `tests/vision.test.ts` | 19 unit tests |
| `tests/vision-fixtures.json`, `tests/vision-fixtures-real.json` | recorded sticker samples (numbers only, no images) of 11 synthetic cubes and of the two real two-photo sets |
| `tests/vision-eval.ts`, `tests/vision-eval-lib.ts` | the full accuracy evaluation in Node |
| `tests/vision-browser-check.ts` | phone-size browser check of the editors, the camera and the demo page |
| `tools/synth/` | synthetic photo renderer and the measurement tools listed at the end |

No package was added. The tools use `jpeg-js`, `pngjs` and `playwright-core`, which were already in
`package.json`.

### Public API

The names the app already uses are unchanged: `CameraCapture`, `QuadEditor`, `detectFaceQuad`,
`snapQuad`, `sampleFace`, `rectifyFace`, `imageDataToCanvas`, `loadImageFile`, `classifyCube`.

Also exported from `src/vision/index.ts`:

- Face path: `locateFaceNear(image, roughQuad)`, `faceSampleFromRgb`, `toImageData`, `centredSquareQuad`,
  `squareToQuad`, `quadToSquare`, `applyMat3`, `COLOUR_PRIORS`, `WORKING_SIZE` (1000 px).
- Corner path: `OutlineEditor`, `detectCornerOutline`, `snapOutline`, `cornerQuads`, `sampleCornerShot`,
  `cornerFaceletMap`, `assembleCornerShots`, `allCornerViews`, `isValidCornerView`, `TWO_SHOT_VIEWS`.
- Types: `Point`, `Quad`, `ImageLike`, `FaceSample`, `Classification`, `ColourName`, `CornerOutline`,
  `CornerView`, `CornerShot`, `ClassifyOptions`, `CameraCaptureOptions`, `CapturedFrame`.

A corner outline has seven points: 0 the near corner, 1 the far back corner, 2 the end of the top/right
edge, 3 the far right corner, 4 the bottom of the left/right edge, 5 the far left corner, 6 the end of
the top/left edge. `sampleCornerShot` returns the faces as [top, left, right], oriented like U, F and R
in a view of the URF corner.

## How it works

**Sampling.** Each sticker is read from the inner area of its cell. Blown-out highlight pixels are
ignored and the colour is the mean of the pixels close to the per-channel median, so a glare spot, a
logo or a sliver of the neighbouring sticker does not pull the value. Each sample also carries a quality
score.

**Classifying.** Colours are compared in a log-opponent space with a small weight on brightness. For
each face the classifier estimates a colour cast, a brightness offset and slope, and a saturation
factor, so a face in shadow and a face in sunlight end up comparable. Labels are then assigned so that
every colour gets exactly 36 stickers, with an exact minimum-cost assignment weighted by sample quality.
Channels at 247 or above are treated as clipped, and a "veil" term models white glare laid over a
sticker. The two sets of colour priors only seed the clusters and give them names; the clusters
themselves come from the photos, so unusual colour schemes work. Confidence is scaled down for
low-quality samples.

**Finding the outline.** The detector scores candidate outlines by how well a 6x6 grid of edges fits
inside and how little cube-like colour lies outside. Candidates come from the hull of colourful pixels
and from the hull of whatever differs from the border background. A search over one-sticker shifts
guards against locking on one row off. The detector never throws; when it finds nothing it returns a
centred square with confidence 0.

## How it was tested

**Synthetic photos.** `tools/synth` renders a 6x6x6 cube with three.js in headless Chromium and saves
JPEGs with the true outline and the true state. The final set, `v3`, has 66 cubes: 6 for each of
11 conditions (easy, warm-dim, cool-bright, gradient-shadow, glare, tilt-roll, clutter, noisy-blur-jpeg,
stickered, mixed-hard, unusual-scheme). Every cube has six straight-on photos and two corner shots. A
second set, `glare2`, has 24 more cubes of the two hard conditions (12 glare, 12 mixed-hard). An earlier
set with unrealistically strong gloss was discarded and none of its numbers are quoted here.

**Real photos.** The five reference photos (747 x 1600) are corner shots of one cube, each showing three
faces. I read the true colours by eye from rectified crops, and placed the seven outline points by hand
before snapping them to the sticker grid. The photos themselves were only read; nothing but derived
numbers is in the repository.

**Unit tests.** `npx vitest run tests/vision.test.ts`: 19 of 19 pass. `npx tsc --noEmit`: 0 errors.

**Browser check.** `tests/vision-browser-check.ts` passes at 390 x 844 with touch: no horizontal
scroll, every button at least 52 px, a grip drag moves its corner by the same distance, arrow keys move
a point, a fake camera frame reaches the editor, and a refused camera shows a note and the file input.

"Accuracy" below always means the share of the 216 stickers read correctly **before any correction by
the user**. Colour ids are matched to the true colours by best agreement before counting.

## Results on synthetic photos

### Six straight-on photos, per condition (set v3, 6 cubes per condition)

"True outline" uses the outline the renderer knows. "Detected outline" uses `detectFaceQuad` with no
manual adjustment, which is what the app does when a photo is loaded from a file. The detected column
was measured twice, in Node and inside Chromium, because the two decode JPEGs differently (see the
section on the lead's cube).

| Condition | True outline, Node | Detected outline, Node | Detected outline, Chromium |
| --- | --- | --- | --- |
| easy | 99.846% (2 wrong) | 99.846% (2) | 99.846% (2) |
| warm-dim | 100% (0) | 100% (0) | 100% (0) |
| cool-bright | 100% (0) | 96.605% (44) | 93.364% (86) |
| gradient-shadow | 99.691% (4) | 99.691% (4) | 99.846% (2) |
| glare | 97.377% (34) | 95.062% (64) | 94.753% (68) |
| tilt-roll | 100% (0) | 100% (0) | 100% (0) |
| clutter | 100% (0) | 98.148% (24) | 100% (0) |
| noisy-blur-jpeg | 100% (0) | 100% (0) | 100% (0) |
| stickered | 100% (0) | 100% (0) | 100% (0) |
| mixed-hard | 97.145% (37) | 96.914% (40) | 97.377% (34) |
| unusual-scheme | 100% (0) | 86.728% (172) | 89.738% (133) |
| **All 66 cubes** | **99.460% (77)** | **97.545% (350)** | **97.720% (325)** |

Cubes by number of wrong stickers (0 / 1 to 3 / more than 3), and the worst cube:

- True outline, Node: 52 / 6 / 8, worst 14.
- Detected outline, Node: 45 / 6 / 15, worst 62.
- Detected outline, Chromium: 47 / 7 / 12, worst 61.

With the true outline in Chromium the total is 99.439% (80 wrong), against 77 in Node.

### Extra hard set (glare2: 12 glare cubes and 12 mixed-hard cubes)

| Condition | True outline, Node | Detected outline, Node | Detected outline, Chromium |
| --- | --- | --- | --- |
| glare | 97.801% (57 wrong) | 96.258% (97) | 96.142% (100) |
| mixed-hard | 97.608% (62) | 93.403% (171) | 90.509% (246) |
| All 24 cubes | 97.704% (119) | 94.830% (268) | 93.326% (346) |

With the true outline, 2 of these 24 cubes have no wrong sticker, 5 have one to three, and 17 have more
than three (worst 10). Under glare the user should expect to correct a handful of stickers.

### Where the errors are

- **Colour errors** are almost all between white and another colour, which is what glare does: in v3
  with true outlines the top confusions are blue read as white (13), white read as blue (11), green read
  as white (6), white read as yellow (6), white read as green (6).
- **Confidence points at them.** Of the 77 wrong stickers in v3 (true outlines), 53 are among the 12
  least confident stickers of their cube; in glare2, 80 of 119.
- **Outline errors are all-or-nothing.** In Chromium, 389 of 396 face outlines in v3 (98.2%) and 138 of
  144 in glare2 (95.8%) are within a quarter of a sticker of the truth (the median error, measured in
  Node, is 0.11 sticker). The others are off by 1.5 to 9 stickers, and each adds between 18 and 52 wrong
  stickers to its cube. Unusual colour schemes are the
  worst condition for detection (32 of 36 outlines found), followed by cool-bright (34 of 36).
- **The detector's own confidence catches most bad outlines but not all.** Of the 13 wrong outlines in
  the two sets, 10 have confidence below 0.9 (3 of them exactly 0); the other 3 report 1.00. Of the 527
  good outlines, 2 have confidence below 0.9.

### Camera guide

`tools/synth/guide-eval.ts` imitates the camera path on v3: the user aims the square guide only roughly
(wrong size, off centre, slightly turned). Reading straight from the rough guide gives 73.87% (3,725
wrong of 14,256). `locateFaceNear`, which looks for the face and accepts it only when it lies near the
guide, brings that to 98.96% (148 wrong): 393 of 396 outlines within a quarter of a sticker, 48 cubes
with no wrong sticker, 6 with one to three, 12 with more. This was measured in Node only, and I did not
measure `snapQuad` alone on the same rough guides.

## Results on the five real photos

Each photo shows three faces, so the five photos give 15 views of faces and 540 views of stickers. There
are 216 ways of choosing one view for each of the six faces; each way is classified as one cube.

| Outlines | All 216 ways | Photos 1 + 3 | Photos 5 + 4 |
| --- | --- | --- | --- |
| Hand-placed, then snapped to the grid | 100.00% (0 wrong) | 100.00% (0 wrong) | 100.00% (0 wrong) |
| Fully automatic (`detectCornerOutline`, no human input) | 100.00% (0 wrong) | 100.00% (0 wrong) | 100.00% (0 wrong) |
| Hand-placed, not snapped | 91.43% (3,999 wrong of 46,656) | 93.98% (13 wrong) | 89.81% (22 wrong) |

- Top faces and side faces are both at 100%, there are no confused colour pairs, and all six colour
  names come out right.
- The automatic outline points land 1 to 4 px from the snapped ones.
- The unsnapped row shows that my hand-placed points were rough and that snapping is what makes them
  usable. It is not a measure of the classifier.
- With lighting compensation switched off the current classifier also reads these photos with 0 wrong,
  so these photos do not stress that part.

Median sampled colours (sRGB) show how much darker the side faces are than the top face:

| Colour | On the top face | On a side face |
| --- | --- | --- |
| orange | 253, 129, 35 | never on a side |
| white | 211, 214, 208 | 164, 164, 164 |
| green | 66, 209, 83 | 56, 156, 71 |
| yellow | 238, 220, 50 | 184, 171, 71 |
| red | 202, 57, 56 | 146, 59, 66 |
| blue | 34, 112, 184 | 45, 80, 131 |

**How far off can the outline be?** I moved each of the seven points by random amounts (25 trials for
each of the two photo pairs):

| Random shift per point (standard deviation) | Not snapped: mean wrong, share with 0 wrong, worst | Snapped: mean wrong, share with 0 wrong, worst |
| --- | --- | --- |
| 2 px | 0, 100%, 0 | 0, 100%, 0 |
| 4 px | 0.06, 98%, 3 | 0, 100%, 0 |
| 6 px | 1.78, 68%, 12 | 0, 100%, 0 |
| 8 px | 6.62, 24%, 26 | 0.4, 98%, 20 |
| 12 px | 24.4, 0%, 50 | 3.48, 82%, 30 |
| 16 px | 51.74, 0%, 95 | 31.66, 26%, 120 |

A sticker edge in these photos is 33 to 57 px long, about 45 px on average, so snapping absorbs errors
up to roughly an eighth of a sticker per point without any loss.

**What the 100% is measured against.** The truth is my own reading of the same photos. Two independent
checks support it: the 15 views agree with each other everywhere, and the assembled state is a legal
cube, which a single misread sticker would break.

## Are the five photos one valid cube?

Yes.

- All 216 stickers are covered, every one is seen in more than one photo, and there are 0 conflicts
  between photos.
- Each colour appears exactly 36 times.
- `validateState` from `src/cube/validate.ts` returns `ok: true` with an empty problem list. That
  check covers the corner pieces and their twist, both sets of edge wings, and the four centre orbits.
- I did not run the solver on it.

The state is in `tmp/vision/reference-state.json` (faces U R F D L B as in `docs/CONVENTIONS.md`; the
solved orange face is called U and photo 1 is taken as the URF corner). `tmp` is ignored by git, so copy
the file if it should be kept.

## Verdict on the two-photo corner mode

**Ship it as an option beside the six-photo flow, with the outline shown and adjustable. Do not make it
the default.**

For it:

- With a correct outline it reads as well as six straight-on photos. Synthetic v3: 99.600% (57 wrong,
  57 of 66 cubes with no wrong sticker) against 99.460% (77 wrong, 52 of 66) for straight-on photos.
- With an outline that is 5 px off per point and then snapped: 99.621% (54 wrong).
- On the real cube both photo pairs read with 0 wrong, with snapped and with fully automatic outlines,
  and snapping tolerates outline errors up to 6 px per point with no loss.
- It needs two photos instead of six.

Against making it the default:

- The automatic outline is much less dependable than for a single face. Synthetic v3, fully automatic:
  95.251% (677 wrong). It finds 93.2% of 132 outlines, but only 33.3% on cluttered backgrounds (58.41%
  accuracy there) and 91.7% in mixed-hard. A wrong outline spoils three faces at once: the worst cube
  has 164 wrong stickers.
- Under glare it is slightly worse than straight-on photos: glare2 with true outlines 96.894% (161
  wrong) against 97.704% (119).
- The user has seven points to check instead of four.
- Finding the outline takes about 0.4 s on this machine and about 1.5 s in Chromium at four times CPU
  slowdown.
- The corner numbers with automatic outlines were measured in Node only, and the real evidence is five
  photos of one cube in one room.

The app does not have a corner flow yet. Building one needs `OutlineEditor`, `detectCornerOutline`,
`snapOutline`, `sampleCornerShot`, `TWO_SHOT_VIEWS` and `assembleCornerShots`; the demo page does
exactly this with `&mode=corner`.

## The lead's 40 of 216 on glare2/cube-012-mixed-hard

The number is right for the browser, and it does not match what my Node evaluation says for that cube.

| Path | Wrong stickers of 216 |
| --- | --- |
| True outlines, Node and Chromium | 0 |
| Detected outlines, Node (`tests/vision-eval.ts`) | 0 |
| Detected outlines, Chromium (`loadImageFile` + `detectFaceQuad`) | 40 |

In Chromium the outline of face R is off by 5.6 stickers and the detector reports confidence 0, which
means it gave up and returned the centred square. In Node the same file gives an outline within 0.14
sticker. The photos are 750 x 1000, so `loadImageFile` does not rescale them; the only difference is
the JPEG decoder. Chromium's pixels differ from the Node decoder's by 1.0 level on average and by up to
32. When I feed Chromium's pixels to the detector in Node it fails in the same way (5.6 stickers), so
the cause is the pixels, not the runtime.

What this means:

- Outline detection is close to a tipping point on some hard photos, and a change of one level in the
  pixels can flip it either way. Across v3 the two decoders come out about even (Chromium 389 of 396
  outlines found, Node 388; three faces flip, two of them in Chromium's favour). On the 12 mixed-hard
  cubes of glare2 Chromium is worse: 67 of 72 outlines against 69, and 246 wrong stickers against 171.
- For mixed-hard as a whole, 40 wrong on one cube is typical of a cube where one outline is missed. In
  Node, cube-023 of the same set also has exactly 40 wrong for the same reason, and the worst
  mixed-hard cube has 50 (59 in Chromium).
- The Chromium columns in this report are the ones that describe the app.

## Speed

| Step | Node, median | Chromium | Chromium at 4x CPU slowdown |
| --- | --- | --- | --- |
| Sample six faces and classify | 6.5 ms | 7.5 ms | 22.9 ms |
| `detectFaceQuad`, one photo | 203 ms | 214 ms | 955 ms |
| Sample two corner shots and classify | not measured | 13.2 ms | 25.7 ms |
| `detectCornerOutline`, one photo | 410 ms | 363 ms | 1,483 ms |

On the real photos `detectCornerOutline` took 607 to 925 ms each in Node in the last run, while other
jobs were running on the machine, and 243 to 629 ms in an earlier run.

## Known limits

- **No real straight-on photo has been tested.** The reference photos are all corner shots. The main
  six-photo path has synthetic evidence only, plus the real corner shots, which exercise the same
  sampling and classifying code.
- **One real cube, one room.** Five photos of one cube, with the solved orange face always on top, so
  orange was never seen in shadow.
- **Glare.** About 97.4 to 97.8% with a correct outline, and most glare cubes need more than three
  corrections.
- **Automatic outlines** fail on roughly 2% of ordinary synthetic face photos and 4% of the hard ones,
  more with unusual colour schemes, and on two thirds of corner shots with cluttered backgrounds.
  Three of 13 wrong face outlines reported full confidence.
- **Not tested on a phone.** The camera was exercised with Chromium's fake camera only, and timing on a
  slow phone is the 4x slowdown figure, not a measurement on a device.
- **HEIC** files open only where the browser can decode them.
- **Synthetic renders are not photographs.** They vary light colour, shadow, gloss, tilt, blur, noise,
  JPEG quality, background and sticker style, but they are still one renderer.
- The camera-guide and corner numbers with automatic outlines were measured in Node, not in Chromium.

## Notes for integration

- `src/app/Capture.tsx` drops the confidence that `detectFaceQuad` returns. Showing "check the
  corners" when it is below 0.9 would have flagged 10 of the 13 wrong outlines measured here, including
  the lead's cube-012.
- For camera frames the app calls `snapQuad(f.image, f.quad)`. `locateFaceNear(f.image, f.quad).quad`
  takes the same inputs, keeps which way is up, and recovers from rough aiming (73.87% to 98.96% in the
  simulation). I have no comparable number for `snapQuad` alone.
- `Classification.confidence` marks most wrong stickers (53 of 77 among the 12 least confident per
  cube), and `Classification.costs` gives second choices for the review screen.
- Straight after `classifyCube` every colour has exactly 36 stickers, so a colour-count problem can
  only appear after the user edits stickers.

## How to rerun

```
npx tsc --noEmit
npx tsc --noEmit -p tools/synth/tsconfig.json
npx vitest run tests/vision.test.ts

# render a set (needs a dev server: npx vite --port 5182 --strictPort)
npx tsx tools/synth/generate.ts --out tmp/vision/synth/v3 --per 6 --seed 1 --pages 4

# accuracy in Node; writes eval.md and eval.json into the set
npx tsx tests/vision-eval.ts --set tmp/vision/synth/v3

# accuracy with detected outlines inside Chromium; writes browser-eval.json into the set
# (first argument: address of any running dev server of this checkout)
npx tsx tools/synth/browser-eval.ts http://localhost:5173 tmp/vision/synth/v3

# camera-guide simulation
npx tsx tools/synth/guide-eval.ts tmp/vision/synth/v3

# real photos (they must be present in the drive; they are never copied)
npx tsx tools/synth/real-eval.ts [--auto | --hand]
npx tsx tools/synth/real-jitter.ts

# phone-size browser check
npx tsx tests/vision-browser-check.ts --set tmp/vision/synth/v3
```

Result files from the runs quoted here are in `tmp/vision` (not tracked by git):
`synth/v3/eval.md`, `synth/v3/browser-eval.json`, `synth/glare2/eval.md`,
`synth/glare2/browser-eval.json`, `real/real-eval-snapped.json`, `real/real-eval-auto.json`,
`real/real-jitter.json`, `reference-state.json`, and screenshots in `demo/`.
