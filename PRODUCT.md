# Product

## What it is

A web app that reads a scrambled 6x6x6 Rubik's Cube through the phone camera and then guides the solve on a 3D model, one physical turn at a time. Everything runs in the browser; photos never leave the device.

## Who uses it, and where

One person, who owns a 6x6x6 cube and wants to solve it himself with guidance. He uses it mostly on his phone, in portrait, at home under indoor light, with the phone in one hand or propped on a table and the cube in the other hand. During the solve both hands are often on the cube, and he looks at the screen in short glances from arm's length. A laptop is a secondary way in.

## The job

1. Scan: six straight-on photos, or a quick scan of two opposite corners, or manual entry. The camera finds the cube and reads it by itself.
2. Check: confirm or correct the colours on a 6x6 grid per side; the app says which pieces cannot be right.
3. Solve: follow about 190 steps, each one layer or block turn, at his own pace, with Next in thumb reach.
4. Learn: understand what each phase is doing and how big cubes are solved by hand.
5. Finish: a real moment of success when the last turn is done.

## What success looks like

- He never has to guess which layers to turn or which way, even in a one-second glance.
- He trusts the scan because he sees what was read, on top of the photo he took.
- A session of 190 steps does not tire the eyes or the thumb, and survives a reload.
- Finishing feels like an achievement.

## Constraints

- Phone first, portrait, one-handed; touch targets at least 52 px; nothing depends on hover.
- The cube's six sticker colours are content. Interface colours must not be confused with them.
- Any colour scheme a cube has must work; nothing assumes the standard one.
- No backend, no accounts, no tracking. Works offline after the first load.
- Reduced-motion settings are respected.

## What would make it feel wrong

- A generic dark dashboard, or decoration that competes with the cube.
- Small or low-contrast text, hidden controls, hover-only affordances.
- Hype, mascots, gamification, or sounds he did not ask for.
