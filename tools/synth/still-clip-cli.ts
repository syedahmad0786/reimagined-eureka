/**
 * One clip for Chromium's fake camera from one photo of a set (see still-clip.ts):
 *   npx tsx tools/synth/still-clip-cli.ts tmp/vision/synth/v3 cube-000-easy U.png tmp/vision/clips/smoke-face.y4m
 *   npx tsx tools/synth/still-clip-cli.ts tmp/vision/synth/v3 cube-000-easy corner-0.png tmp/vision/clips/smoke-corner.y4m
 * Play it with: chromium --use-fake-device-for-media-stream --use-fake-ui-for-media-stream
 *   --use-file-for-fake-video-capture=<absolute path>
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { readImage } from './node-image';
import { writeStillClip } from './still-clip';

const [set, cube, file, out] = process.argv.slice(2) as [string, string, string, string];
const meta = JSON.parse(readFileSync(set + '/' + cube + '/meta.json', 'utf8')) as { shots: { file: string; quad?: number[][]; outline?: number[][] }[] };
const shot = meta.shots.find((s) => s.file === file);
if (!shot) throw new Error('no photo ' + file + ' in ' + cube + ': ' + meta.shots.map((s) => s.file).join(', '));
const truth = (shot.quad || shot.outline) as number[][];
const sticker = Math.hypot((truth[1] as number[])[0]! - (truth[0] as number[])[0]!, (truth[1] as number[])[1]! - (truth[0] as number[])[1]!) / 6;
let seed = 17;
for (const ch of cube + file) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
mkdirSync(dirname(out), { recursive: true });
const clip = writeStillClip(readImage(set + '/' + cube + '/' + file), truth, sticker, seed, out);
console.log('wrote ' + out + ': ' + clip.frames.length + ' frames at ' + clip.fps + ' a second, hand shake ' + clip.amplitude.toFixed(2) + ' stickers');
