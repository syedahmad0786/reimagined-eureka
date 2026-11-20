# Design

The visual system of the 6x6 Cube Solver. Read PRODUCT.md first for who uses it and where. Tokens live in `src/styles/tokens.css`, components in `src/app/app.css`.

## Direction contract

THESIS. The seventh colour. A cube owns six colours and they are content, so the interface is drawn in the one hue family a cube never has, and in nothing else. It refuses the category default of a neutral dark shell with a blue button and red, amber and green states sitting next to red, yellow and green stickers.

OWN-WORLD. A grape ground (`--bg` #34133e) with a paler round mat (`--pool`) that the black cube sits on. One signal pink (`--accent` #ff63dc) for the thing to press and for whatever the app points at; the arrows on the 3D cube are the same pink. Black cube plastic (`--cube-plastic`) as trays. Every control is a sticker: a flat rounded square with a moulded lower edge that gives two pixels when pressed. Type is Rubik, the face drawn for the Chrome Cube Lab, whose softened corners match a sticker's.

STORY. He sees his cube, lets the camera read it, checks what it read on top of his own photo, then follows one unmistakable turn at a time and ends with a real moment of success.

FIRST VIEWPORT (phone). Brand row with Learn on the right. The 3D cube turning slowly on the lit mat, about a third of the height. The headline. A black tray holding the pink "Scan with the camera" sticker across its full width and three smaller stickers under it. On the solve screen the cube takes the upper half, the instruction sits under it in 40 px pink notation and 20 px words, and "Done, next step" is a 76 px pink sticker in thumb reach with Back beside it.

FORM. Sticker-and-tray, candidate 4 of the ordered list (seed: 1387a1aa88f8b25e). Signature move: the sticker tile in its plastic tray is the unit of everything, from buttons to the scan progress (six small faces that fill with what was read) to the confetti at the end, which is loose stickers in the cube's own colours.

FINISH. unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance. The review and its verdict are at the end of this file.

## Scene

Evening, indoor lamp, phone propped at arm's length or in one hand, the other hand (or both) on a black cube with bright stickers. A long session of about 190 steps. That is why the ground is dark and coloured rather than white (twenty minutes of a white screen is a torch in the face) and why it is not near-black (the black cube has to stand out from it).

## Colour

| Role | Token | Value | Use |
| --- | --- | --- | --- |
| Deepest ground | `--bg-deep` | #1e0925 | behind sheets |
| Ground | `--bg` | #34133e | the page |
| Raised | `--surface`, `--surface-2`, `--surface-3` | #462052, #5a2e67, #6f3e7e | cards, buttons, pressed |
| Mat | `--pool` | #8a4f9c | the round mat behind the 3D cube: a flat disc, not a glow |
| Text | `--text`, `--text-dim` | #faf4fc, #dec8e5 | 14.8:1 and 10.3:1 on the ground; the dim text is still 6.7:1 on `--surface-2` |
| Paper | `--paper` | #f4e5f9 | the selected state, and messages that must not be missed |
| Signal | `--accent`, `--accent-strong`, `--accent-soft` | #ff63dc, #e741c4, #ffb5ea | primary action, the current thing, arrows |
| Ink | `--accent-ink` | #120616 | text on pink (7.6:1) and on paper (16.4:1) |
| Plastic | `--cube-plastic` | #0b0a0d | trays, the cube body |

Rules:

- Red, orange, yellow, green, blue and white never carry interface meaning. They appear only as sticker colours (the 3D cube, the colour grids, the swatches, the confetti).
- States are told apart by more than colour. A problem is a paper-white note with an exclamation mark; a suspect sticker has a pink ring and a "!" tab; "valid" is a card with a pink tick tile and the words "This is a real cube"; a suggested fix has a paper tile with a pencil; a locked camera outline is solid and an unsure one is dashed.
- The six sticker colours shown by the app come from the scan (`CubeData.palette`), never from a fixed list, so any colour scheme works.

## Type

Rubik (variable, 300 to 900, latin subset bundled, no network font request). One family.

| Use | Size / weight |
| --- | --- |
| Notation of the current step | 40 px / 800 (32 px on short screens) |
| Solved | 44 px / 850 |
| Page headline | 34 px / 800 (46 px on desktop) |
| Which way ("Quarter turn clockwise", "Half turn") | 20 px / 750, beside the notation |
| What to turn | 19 px / 600 |
| Primary button | 20 to 23 px / 700 to 750 |
| Body | 17 to 18 px / 400 |
| Small print, never smaller | 13 px, only for labels next to an icon or a picture |

The step text is sized to be read at arm's length; nothing the user needs during a turn is below 16 px.

## Shape and touch

- Radii follow a sticker: about 22% of the side. `--radius` 20 px for big tiles and cards, `--radius-sm` 14 px for buttons, `--radius-xs` 8 px for chips.
- Every target is at least 52 px (`--tap`); "Done, next step" and Back are 76 px. Nothing depends on hover.
- A tray is `--cube-plastic` with 6 px padding and 6 px gaps, the proportions of the gaps on a cube.

## Motion

- Press: a sticker drops 2 px and loses its lower edge, 120 ms.
- Screens: fade and rise 8 px, 240 ms, ease-out.
- A turn on the 3D cube runs on a damped spring and clicks into place (quick turns); a demonstration ("Show turn", auto-play, Learn) moves evenly instead.
- The cube turns slowly on the home screen and spins on the solved screen. Only the camera orbits; the cube keeps its orientation.
- Solved: about 220 loose stickers burst from the lower corners and fall.
- With "reduce motion" on: screens and notes appear without movement, turns are applied at once (the arrows still show which way), the cube does not spin, and the stickers of the celebration are scattered once and stay still.

## The 3D cube

Stickers are drawn unlit, in exactly the colours of the scan, so a sticker on screen can be compared with the one in the hand whichever side it is on (a test holds this to within two levels per channel). Depth comes from the lit black plastic between them, the paler mat behind the cube and a soft shadow under it. While a step is shown, the layers that turn are lifted and keep their full colour, everything else is dimmed, pink arrows run round them, and a pale outline marks the block. An inner slice or a wide turn carries a pink pill with its layer numbers, counted from the named face, and a half turn carries a "180°" pill. For a turn of the back, left or bottom layers the camera orbits a little toward that side, never so far that the top, front and right faces leave the view, and never once the user has dragged the view themselves (the reset button gives it back).

## Finish review

Done on 20 November 2026 on the finished build, as two assessments that did not see each other's results.

**A, design critique.** A separate reviewer walked every screen at 390x844 and 1280x800 from screenshots and its own measurements, with no detector output. Score 29 of 40 on the ten usability heuristics, no blocking defect, four serious ones. All four were fixed:

| Finding | What changed |
| --- | --- |
| Back-face turns and inner-slice counts failed the one-second glance; the direction sat in the smallest line | The camera orbits toward back, left and bottom turns; inner slices and wide turns carry a layer-number pill; the direction sits beside the notation at 20 px |
| Restart, or a slip on the slider, lost the place with no way back | Any jump offers "Back to step N" for the next three steps |
| On the colour check the verdict and the fixes were below the fold, under the sticky button | The first problem and the likeliest fix sit directly under the face tabs, each fix with Show and Apply; the sticky bar is solid; a disabled primary button stays readable |
| On the first photo the read-out could show a chip that contradicted the sticker | A partial reading shows each colour as seen, and the count of unsure stickers uses the same test as the marks |

Also fixed from A: grip grids drew in cyan and amber (now the interface's own three tones, told apart by line style and a name); labels on the 3D cube were 11 px (now 13); phase chips, the slider and the colour-check cells were under 52 px; still confetti covered the header under reduced motion; leaving the colour check threw work away silently (it asks first); there was no route for "my cube does not match" (the "Lost?" button and a link on the solved screen); Learn opened from a solve had its Close only at the top (a "Back to step N" bar stays in reach); the no-camera screen was an empty tray (it folds away and "Choose a photo" becomes the main action); the hold card named a corner the picture did not mark (it is ringed); notes used a one-sided stripe (now a sticker tile).

**B, detector and audit.** The impeccable detector reported a violet gradient and a radial halo behind the cube, and side stripes on two notes. The halo became a flat round mat and the stripes became tiles; the detector now reports nothing on the home screen or the source. The audit found no horizontal overflow from 320 to 430 px, no enabled text under 4.5:1 (lowest 5.86:1), names on every control, and a working offline install. It found that Learn did not hold keyboard focus and returned focus to the page body on closing; the screen behind is now inert and focus returns to the button that opened Learn.

**Kept on purpose.** The violet hue itself is the thesis, so the detector's dislike of purple was not acted on beyond removing the gradient. Headlines of 34 px and more keep a line height of 1.08 to 1.15; body text is 1.45. Restart stays in the control row, because it can now be undone.

**Not done.** The copying of camera frames still runs on the main thread; the first copy after the camera opens took a median of 125 ms in the measurements. Arrowheads on the far edges of the cube keep their size; the camera moves instead.

**Verdict.** The direction holds on every screen: the shell never competes with the stickers, each state is told by a mark or words as well as tone, and the step screen reads at a glance for every face. It is ready for its user to try. It has been judged from desktop Chromium at phone size, not on a phone, and not with a real camera or a screen reader; those are the next checks, and they are his to make.
