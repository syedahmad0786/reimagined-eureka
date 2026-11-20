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

## Version 2: live camera, automatic capture and the read-out

Added on 20 November 2026. Everything above describes version 1 and is still true; version 1 calls behave
as before when none of the new options is given. All numbers in this part were measured on this machine
on 20 November 2026. Where a planned measurement was not run, it says so.

### Short version

- **The camera now finds the cube and takes the photo by itself.** In Chromium, with a fake camera
  playing clips of the synthetic photos (the camera comes closer for 0.6 s, then is held with hand shake
  and a slow drift), automatic capture fired on 99.0% of straight-on clips (196 of 198) and 90.9% of
  corner clips (60 of 66), typically 1.9 s after the camera opened. Where it did not fire, the shutter
  was pressed instead and the outline was right every time.
- **No automatic capture landed on a wrong outline** in those 256 captures. Getting there needed one
  fix that the first camera run exposed: see "A capture on a wrong outline, and the fix".
- **Accuracy through the camera, before any correction: 99.37% for six photos** (45 wrong of 7,128
  stickers, 33 cubes) **and 99.20% for the quick scan** (57 wrong of 7,128). Version 1 with automatic
  outlines was 97.72% for six photos. The gain is the outline: every one of the 264 outlines was within
  a quarter of a sticker. With a right outline the colours read as they did in version 1.
- **Merging several frames did not improve accuracy** on these clips (45 wrong merged, 42 from the
  single photo; 57 against 52 for the quick scan). In clips made from a still photo the reflections do
  not move, so merging has nothing to remove there. On the 6 rendered glare cubes, where reflections do move, merging gave 38 wrong against 40 for six photos and 54 against 59 for the quick scan: a small gain.
- **Photos 5 then 4 read as one valid cube**, in Node and in Chromium through the app's own
  `assembleTwoShots`. The 127 stickers that differ from the reference state are a whole-cube rotation
  plus a renaming of the colours: after rotation 18 of the 24, 0 stickers differ. Nothing needs changing.
- **A sticker is "unsure" below confidence 0.7.** With all six faces that flag catches 87% of the wrong
  stickers and also marks 3.1% of the right ones. With one to five faces it catches 40% to 80%.
- **Under a 4x CPU slowdown the page does not freeze**, because the search runs in a Web Worker.
  With the worker, 15 of 16 clips still captured by themselves in about 2 s and the longest pause between animation frames was 200 ms. Without the worker the page paused for 0.6 to 1.2 s at a time.

### What was added

| Piece | What it does |
| --- | --- |
| `CameraCapture` options `mode`, `auto`, `live`, `onStatus`, `avoid`, `steadyMs`, `worker` | Finds the face or the corner view in the live video, draws its outline (solid when locked, dashed when not), reports a hint code and text, and takes the photo when the outline has passed the rules and stayed still for 0.6 s |
| `src/vision/live.ts`, `live-worker.ts` | The finder that follows the outline from frame to frame, the rules for "may this be captured" (`GATES`), the steadiness timer, merging of frames. Runs in a Web Worker |
| `ReadoutView`, `readingFor` | Shows the frozen photo with one chip per sticker in the colour that was read; unsure stickers get a dashed ring and a question mark |
| `classifyPartial`, `UNSURE_BELOW` | Provisional colours for the faces captured so far (one to six) |
| `cornerFaceQuads`, `cornerFaces` | The three faces of a corner shot as cube faces in reading order, with the camera's samples or freshly sampled |
| `findFace`, `findCorner` | The detectors with options (a hint where to look, a quick mode) and the raw score |

The full signatures are in `tmp/vision/API-v2.md`.

### How the camera path was measured

`tools/synth/camera-eval.ts` starts Chromium with `--use-file-for-fake-video-capture`, opens
`demo/vision.html?live=1` in a 390 x 844 phone viewport, and waits for the photo the camera takes by
itself. After 10 s without one it presses the shutter, as a user would. It records when the capture fired,
how far the outline is from the true one, and the sticker samples, then classifies the cube from its six
faces or two corner shots and compares with the true state.

Two kinds of clip:

- **From a still photo** (`tools/synth/still-clip.ts`): the camera starts 25% to 40% further away, 1.4 to
  2.4 stickers off centre and turned 6 to 12 degrees, comes to rest in 0.6 s, then holds for 2 s with 0.06
  to 0.22 stickers of hand shake (0.7 to 2.5 mm on a 68 mm cube) and up to 0.2 stickers of drift. The true
  outline of every frame is known. Light and reflections do not change within a clip.
- **Rendered** (`tools/synth/clips.ts`): the 3D scene is rendered once per frame with the camera moving
  and the lamps fixed, so reflections travel across the stickers. Only glare and mixed-hard cubes were
  rendered this way (6 cubes, 48 clips); a full set proved too slow on this machine (about 15 s per clip).

Limits of this method: the fake camera delivers 750 x 1000 frames at 10 a second, Chromium runs on
software graphics, and nobody reacts to the hints, so a clip in which the cube is too far away stays
too far away.

### A capture on a wrong outline, and the fix

The first run of the measurement fired on a wrong outline in 4 of the first 40 straight-on clips
(cube-001-easy L, cube-002-easy L, cube-006-warm-dim L, cube-007-warm-dim U): the outline was about one
sticker off, the confidence was 0.98 to 1.00, and each cost that cube 27 to 34 wrong stickers. All four
fired early, 1.15 to 1.37 s after the camera opened, while the cube was still coming closer. The outline
is followed from frame to frame, and a followed outline can lag behind a moving cube and settle one
sticker over while its score still looks good.

The fix is a confirmation: when the countdown ends, the next frame is also searched afresh with the
thorough search, and the photo is taken only if that search arrives within 0.3 stickers of the followed
outline (`CONFIRM_WITHIN`). Otherwise the countdown starts again from what the thorough search found.

Why the thorough search and not the quick one: on the 132 corner photos of set v3, held still, the
quick search agreed with the followed outline in 126 cases, and in 5 of those the outline was wrong,
because the followed outline had started from the same quick search. The thorough search agreed in 123
cases; the worst outline among them was 0.29 stickers off (cube-043-noisy-blur-jpeg corner-1), all others
were within a quarter of a sticker. On the 396 straight-on photos it agreed in 393 cases and none of
those was wrong; the three followed outlines that were wrong were all refused.

The numbers below come from two runs. The large run (33 cubes, 264 clips) was made with the quick search
as confirmation, before the corner finding above. The final code (thorough confirmation) was then run on
11 cubes (one per condition, 88 clips), on all 6 clutter cubes in corner mode, on the rendered glare
clips and on the real photos. The full 66 cubes were not run with the final code: there was no time left.

### Results through the camera, set v3

Automatic capture, large run (first three cubes of each condition, quick confirmation):

| | Straight-on, 198 clips | Corner view, 66 clips |
| --- | --- | --- |
| Captured by itself | 196 (99.0%) | 60 (90.9%) |
| Time from camera open to capture | median 1.89 s, 90% within 2.57 s, longest 7.76 s | median 1.85 s, 90% within 4.27 s, longest 4.89 s |
| Captures on a wrong outline (more than a quarter sticker off) | 0 of 196 | 0 of 60 |
| Not captured, shutter pressed after 10 s | 2, outline right in both | 6, outline right in all |
| Outline error of automatic captures, in stickers | median 0.107, largest 0.154 | median 0.111, largest 0.206 |

Corner clips that did not fire: 3 of 6 on clutter, 1 of 6 each on noisy-blur-jpeg, mixed-hard and
unusual-scheme.

Stickers read correctly before any correction, same run:

| Condition (3 cubes each) | Six photos: wrong of 648 | Quick scan: wrong of 648 |
| --- | --- | --- |
| easy | 2 | 0 |
| warm-dim | 0 | 0 |
| cool-bright | 0 | 0 |
| gradient-shadow | 4 | 0 |
| glare | 16 | 19 |
| tilt-roll | 0 | 0 |
| clutter | 0 | 0 |
| noisy-blur-jpeg | 0 | 0 |
| stickered | 0 | 0 |
| mixed-hard | 17 | 38 |
| unusual-scheme | 6 | 0 |
| **All 33 cubes** | **45 of 7,128 (99.37%)** | **57 of 7,128 (99.20%)** |
| Cubes with 0 wrong / 1 to 3 / more | 22 / 7 / 4, worst 12 | 27 / 1 / 5, worst 17 |
| From the single photo, frames not merged | 42 wrong | 52 wrong |

For comparison, version 1 with automatic outlines in Chromium, on all 66 cubes: 97.72% (325 wrong of
14,256), with 7 of 396 face outlines in the wrong place. The two runs are not on the same cubes (33
against 66) and version 1 was given single photos, not clips.

Final code:

| Run | Clips | Captured by itself | On a wrong outline | Shutter needed, outline right | Wrong stickers |
| --- | --- | --- | --- | --- | --- |
| One cube per condition, straight-on | 66 | 64 (97.0%), median 2.22 s | 0 of 64 | 2 of 2 | 25 of 2,376 (98.95%) |
| One cube per condition, corner | 22 | 21 (95.5%), median 2.05 s | 0 of 21 | 1 of 1 | 18 of 2,376 (99.24%) |
| All 6 clutter cubes, corner | 12 | 9 (75.0%), median 2.40 s | 0 of 9 | 3 of 3 | 0 of 1,296 |
| Rendered glare and mixed-hard, straight-on | 36 | 35 (97.2%), median 2.22 s | 0 of 35 | 1 of 1 | 38 of 1,296 (97.07%); single photo 40 |
| Rendered glare and mixed-hard, corner | 12 | 10 (83.3%), median 2.16 s | 0 of 10 | 2 of 2 | 54 of 1,296 (95.83%); single photo 59 |
| Real photos 1 and 3, 5 and 4, corner | 4 | 4 | 0 of 4 | none | 0 of 216 for each pair |

The same 11 cubes in the large run had 28 wrong (six photos) and 18 wrong (quick scan), so the change of
confirmation did not change the reading. Version 1 found the corner outline automatically on 33% of
clutter photos; here all 12 clutter corner outlines were right, 9 of them without the shutter. The real
photos were turned into clips by moving the camera over the photo; the largest outline error was 0.08
stickers. Part of the 11-cube run overlapped with a test run on the same machine, so its times are a
little long; the times of the large run are clean.

### Wrong kind of view

On still photos (`tools/synth/gate-eval.ts`, set v3): the live face finder passed the face rules on 0 of
132 corner shots, the live corner finder passed the corner rules on 0 of 396 straight-on photos, true
face outlines passed the shape rules on 396 of 396 and true corner outlines on 132 of 132.

The corner rules include one that asks whether the seven points are the projection of a cube: each far
corner must lie where the other six points say it should, within 0.1 silhouette widths. Right corner
outlines from the live finder reach 0.063 at most (121 outlines, median 0.016). Before this rule the
corner finder passed on two straight-on photos; the nearest straight-on photo that passes the other
rules is now at 0.129.

Through the camera (final code, 24 clips of easy, tilt-roll and clutter cubes, 4 s each): corner clips
played to face mode captured 0 of 6 (last hint: not found 5, "more than one side" 1), and straight-on
clips played to corner mode captured 0 of 18 (last hint: "only one side" 11, not found 7).

### Photos 5 then 4

The owner's report was that the app misreads the cube when photo 5 is scanned first and photo 4 second.
Measured in Chromium 157.0.8103.78 through the app's own `assembleTwoShots`, with automatic outlines
(confidence 1 and 1), and in Node with the same result:

| | Photos 5 then 4 | Photos 1 then 3 |
| --- | --- | --- |
| Valid cube | yes | yes |
| Stickers that differ from the reference state, as scanned | 127 | 0 |
| Fewest that differ after turning the whole cube and renaming colours | 0 (rotation 18 of 24, matrix [[0,0,1],[0,1,0],[-1,0,0]]) | 0 (rotation 0) |

Stickers that differ for each of the 24 rotations, photos 5 then 4:
127, 157, 126, 153, 163, 152, 152, 150, 127, 150, 162, 153, 162, 153, 157, 153, 156, 162, 0, 156, 158,
152, 159, 159.

So the reading is right. The cube is held differently in photos 5 and 4 than in the reference state, so
the same cube comes out turned, and the colour names follow the centres as scanned. A solver gives a
correct solution for either. In Node the other two ways of arranging the two photos gave an invalid cube
(badness 62), so the app's choice of arrangement is the only valid one. Rerun:
`npx tsx tools/synth/pair-check.ts 5,4 1,3`.

### What "unsure" means

`classifyPartial` gives every sticker a confidence from 0 to 1, and `ReadoutView` marks a sticker as
unsure when it is below `UNSURE_BELOW` = 0.7. Measured on set v3 with true outlines (66 cubes,
`tools/synth/partial-eval.ts`):

| Faces captured | Wrong stickers | Wrong ones marked unsure at 0.7 | Right ones marked unsure at 0.7 | The same at 0.6 |
| --- | --- | --- | --- | --- |
| 1 | 23 of 2,376 (0.97%) | 78% | 2.8% | 39% / 2.2% |
| 2 | 122 of 4,752 (2.57%) | 70% | 3.7% | 60% / 3.2% |
| 3 | 206 of 7,128 (2.89%) | 40% | 3.9% | 33% / 2.9% |
| 4 | 192 of 9,504 (2.02%) | 69% | 3.2% | 56% / 2.4% |
| 5 | 113 of 11,880 (0.95%) | 80% | 2.9% | 73% / 2.4% |
| 6 | 77 of 14,256 (0.54%) | 87% | 3.1% | 86% / 2.7% |

So an unmarked sticker is almost always right, a marked one is usually right too (about 7 or 8 marks on
a full cube are false alarms), and with two to four faces the reading is provisional: 2% to 3% of the
stickers shown are wrong and up to 60% of those are not marked. With all six faces the result is the same
77 wrong stickers as version 1. On the glare2 set one face alone has 4.86% wrong (42 of 864).

"Wrong" for fewer than six faces means: after matching each colour group to its best true colour.

### Speed

Large run, no slowdown, finder in the worker:

| | Straight-on | Corner view |
| --- | --- | --- |
| Frames handled a second | 8.3 (slowest clip 4.8) | 5.7 (slowest clip 4.0) |
| Time per frame, median | 55 ms | 108 ms |
| Time per fresh quick search, median | 130 ms | 237 ms |
| Longest single frame | 310 ms | 467 ms |

The thorough search used for the confirmation takes a median of 228 ms for a face and 357 ms for a
corner view in Node; it runs once per capture, in the worker.

Under Chrome's 4x CPU slowdown (`Emulation.setCPUThrottlingRate`; it slows the page's main thread and
not the worker):

| | Finder in the worker, 16 clips | Finder on the main thread, 8 clips |
| --- | --- | --- |
| Captured by itself | 15 of 16, none on a wrong outline | 8 of 8, none on a wrong outline |
| Time to capture, median | 2.18 s straight-on, 1.78 s corner | 2.70 s straight-on, 6.31 s corner |
| Finder time per frame, median | 48 ms straight-on, 112 ms corner | 447 ms straight-on, 594 ms corner |
| Longest pause between animation frames | 167 ms median, 200 ms worst | 617 ms median straight-on, 1,150 ms corner |
| Animation frames more than 50 ms late | 3.7% straight-on, 6.1% corner | 79% straight-on, 100% corner |

So the worker keeps the page moving on a slow main thread. The right-hand column is also the best
estimate here of the finder on a processor four times slower: about 2 frames a second, and capture still
works. No device was measured.

What stays on the main thread is copying each video frame out of the video element (`drawImage` and
`getImageData`): a median of 248 ms in total per straight-on capture, over about 27 copies. The first copy
after the camera opens is the slow one (median 125 ms, longest 359 ms), and it is the longest pause in
every clip (median 183 ms; in the three clips examined it came 234 to 289 ms after the camera opened).
It could move into the worker by sending an `ImageBitmap` of the frame and reading the pixels there with
an `OffscreenCanvas`. That was not done: it needs a fallback for browsers without those, and it was not
measured on a phone.

### Known limits of version 2

- **Still no phone.** Everything ran in Chromium on this machine with a fake camera at 10 frames a
  second. Autofocus, exposure changes, motion blur and rolling shutter of a real phone camera were not
  tested.
- **Clips do not react.** A real user moves when the hint says so; a clip does not. The share of clips
  where the capture fired is therefore a lower bound for a cooperative user and says nothing about an
  uncooperative one.
- **Reflections that move were tested on 6 rendered cubes only**, and merging frames showed no gain on
  the still-based clips.
- **Corner shots on cluttered backgrounds** remain the hardest case for automatic capture.
- **The provisional reading of two to four faces misses most of its own mistakes** (table above).

### Planned but not run

- The final code on all 66 cubes through the camera (33 with the earlier confirmation, 11 with the final).
- The glare2 set through the camera.
- `avoid` (no second capture of a side already taken) and the file-picker fallback in the new modes: unit
  tests only, not exercised in Chromium. The shutter fallback was exercised 18 times in the runs above
  and gave a right outline every time.
- Rendered clips (moving reflections) for the nine conditions other than glare and mixed-hard.
- The new grid colours and names of the outline editors were type-checked but not looked at in a browser.
- The source of one "404" console message in the demo page was not found.

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

```
# version 2: clips and the camera path (needs the dev server on 5182 and /usr/local/bin/chromium)
npx tsx tools/synth/camera-eval.ts --stills tmp/vision/synth/v3 --out tmp/vision/camera-eval/main [--per 3] [--mode face|corner]
npx tsx tools/synth/camera-eval.ts --stills tmp/vision/synth/v3 --out tmp/vision/camera-eval/t4 --throttle 4 [--worker 0]
npx tsx tools/synth/camera-eval.ts --stills tmp/vision/synth/v3 --out tmp/vision/camera-eval/cross --cross --timeout 4000
npx tsx tools/synth/clips.ts --out tmp/vision/clips/glare3d --per 3 --seed 1 --only glare,mixed-hard --pages 2
npx tsx tools/synth/camera-eval.ts --clips tmp/vision/clips/glare3d --out tmp/vision/camera-eval/glare3d
# one clip for the fake camera from one photo
npx tsx tools/synth/still-clip-cli.ts tmp/vision/synth/v3 cube-000-easy U.png tmp/vision/clips/smoke-face.y4m
# provisional readings, capture rules, photos 5 then 4
npx tsx tools/synth/partial-eval.ts tmp/vision/synth/v3
npx tsx tools/synth/gate-eval.ts tmp/vision/synth/v3
npx tsx tools/synth/pair-check.ts 5,4 1,3
```
