/**
 * Provisional readings and the "unsure" flag, measured on the synthetic sets with the true outlines.
 *   npx tsx tools/synth/partial-eval.ts tmp/vision/synth/v3 [tmp/vision/synth/glare2 ...]
 * For 1..6 captured faces (in the capture order of the app: F R B L U D) it reports the share of
 * stickers whose group is wrong, and for a list of thresholds how many wrong stickers the flag
 * catches and how many right ones it flags.
 */
import { readFileSync } from 'node:fs';
import { readImage } from './node-image';
import { sampleFace } from '../../src/vision/sample';
import { classifyPartial } from '../../src/vision/classify';
import type { FaceSample, Quad } from '../../src/vision/types';

const sets = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ORDER = [2, 1, 5, 4, 0, 3];
const THRESHOLDS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const PERMS: number[][] = [];
(function build(p: number[], rest: number[]): void {
  if (!rest.length) {
    PERMS.push(p);
    return;
  }
  rest.forEach((v, i) => build([...p, v], [...rest.slice(0, i), ...rest.slice(i + 1)]));
})([], [0, 1, 2, 3, 4, 5]);

interface Tally {
  stickers: number;
  strict: number;
  loose: number;
  flaggedWrong: number[];
  flaggedRight: number[];
  cubes: number;
}
const tally: Tally[] = Array.from({ length: 7 }, () => ({ stickers: 0, strict: 0, loose: 0, flaggedWrong: THRESHOLDS.map(() => 0), flaggedRight: THRESHOLDS.map(() => 0), cubes: 0 }));

for (const set of sets) {
  const cubes = (JSON.parse(readFileSync(set + '/index.json', 'utf8')) as { cubes: string[] }).cubes;
  for (const cube of cubes) {
    const meta = JSON.parse(readFileSync(set + '/' + cube + '/meta.json', 'utf8')) as { state: number[]; shots: { kind: string; face: number; file: string; quad: number[][] }[] };
    const samples: (FaceSample | null)[] = [null, null, null, null, null, null];
    for (const shot of meta.shots) {
      if (shot.kind !== 'face') continue;
      const img = readImage(set + '/' + cube + '/' + shot.file);
      samples[shot.face] = sampleFace(img, shot.quad.map((p) => ({ x: p[0] as number, y: p[1] as number })) as Quad);
    }
    for (let n = 1; n <= 6; n++) {
      const given: (FaceSample | null)[] = [null, null, null, null, null, null];
      for (let k = 0; k < n; k++) given[ORDER[k] as number] = samples[ORDER[k] as number] as FaceSample;
      const res = classifyPartial(given);
      const agree = new Int32Array(36);
      const idx: number[] = [];
      for (let k = 0; k < n; k++) {
        const f = ORDER[k] as number;
        for (let i = 0; i < 36; i++) {
          agree[(res.faces[f]!.groups[i] as number) * 6 + (meta.state[f * 36 + i] as number)] += 1;
          idx.push(f * 36 + i);
        }
      }
      let best = PERMS[0] as number[];
      let bestScore = -1;
      for (const p of PERMS) {
        let s = 0;
        for (let g = 0; g < 6; g++) s += agree[g * 6 + (p[g] as number)] as number;
        if (s > bestScore) {
          bestScore = s;
          best = p;
        }
      }
      let loose = 0;
      for (let g = 0; g < 6; g++) loose += Math.max(...Array.from(agree.slice(g * 6, g * 6 + 6)));
      const t = tally[n] as Tally;
      t.cubes++;
      t.stickers += 36 * n;
      t.strict += 36 * n - bestScore;
      t.loose += 36 * n - loose;
      for (const i of idx) {
        const f = Math.floor(i / 36);
        const wrong = best[res.faces[f]!.groups[i % 36] as number] !== meta.state[i];
        const c = res.faces[f]!.confidence[i % 36] as number;
        THRESHOLDS.forEach((th, ti) => {
          if (c < th) (wrong ? t.flaggedWrong : t.flaggedRight)[ti]!++;
        });
      }
    }
  }
}
console.log('sets: ' + sets.join(', ') + '; cubes: ' + (tally[6] as Tally).cubes);
console.log('| faces | stickers | wrong, one group per colour | wrong, groups may share a colour | ' + THRESHOLDS.map((t) => 'flag<' + t + ' (wrong caught / right flagged)').join(' | ') + ' |');
for (let n = 1; n <= 6; n++) {
  const t = tally[n] as Tally;
  const right = t.stickers - t.strict;
  console.log(
    '| ' +
      [
        n,
        t.stickers,
        t.strict + ' (' + ((100 * t.strict) / t.stickers).toFixed(2) + '%)',
        t.loose + ' (' + ((100 * t.loose) / t.stickers).toFixed(2) + '%)',
        ...THRESHOLDS.map((_, ti) => (t.strict ? ((100 * (t.flaggedWrong[ti] as number)) / t.strict).toFixed(0) : '-') + '% / ' + ((100 * (t.flaggedRight[ti] as number)) / right).toFixed(1) + '%'),
      ].join(' | ') +
      ' |',
  );
}
