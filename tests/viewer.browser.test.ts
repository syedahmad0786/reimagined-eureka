/**
 * Browser test of the 3D cube viewer through the demo page, on a phone and a desktop viewport.
 * Starts its own Vite dev server (or uses VIEWER_URL) and drives the system Chromium with
 * playwright-core. Skipped when Chromium is not installed or VIEWER_SKIP_BROWSER=1. Takes two to
 * three minutes. Screenshots and measured.json go to tmp/viewer-shots/.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';

const CHROMIUM = process.env.CHROMIUM_PATH ?? '/usr/local/bin/chromium';
const SHOTS = resolve(__dirname, '../tmp/viewer-shots');
const SHOT_MOVES = ['R', "L'", 'U2', '3Rw', "2-3Lw'", '3F', '2D2', 'B', "3Dw'"];
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
];

let server: ViteDevServer | undefined;
let browser: Browser;
let baseUrl = process.env.VIEWER_URL ?? '';
const measured: Record<string, unknown> = {};

beforeAll(async () => {
  if (!existsSync(CHROMIUM)) return;
  if (!baseUrl) {
    // No file watching, no HMR and no dependency pre-bundling: nothing may reload the page mid-test,
    // even while other people edit files in the same checkout.
    server = await createServer({
      root: resolve(__dirname, '..'),
      logLevel: 'error',
      cacheDir: 'node_modules/.vite-viewer-test',
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { host: '127.0.0.1', port: 5181, strictPort: false, hmr: false, watch: null },
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('dev server has no port');
    baseUrl = 'http://127.0.0.1:' + address.port;
  }
  browser = await chromium.launch({
    executablePath: CHROMIUM,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  mkdirSync(SHOTS, { recursive: true });
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
  if (Object.keys(measured).length) {
    writeFileSync(resolve(SHOTS, 'measured.json'), JSON.stringify(measured, null, 2));
    console.log('viewer measurements', JSON.stringify(measured, null, 2));
  }
});

const frames = (page: Page, count = 2) =>
  page.evaluate((n) => new Promise<void>((done) => {
    const step = (left: number) => (left ? requestAnimationFrame(() => step(left - 1)) : done());
    step(n);
  }), count);

const fileName = (move: string) => move.replace("'", 'prime');

describe.skipIf(!existsSync(CHROMIUM) || process.env.VIEWER_SKIP_BROWSER === '1').each(VIEWPORTS)('CubeView on $name ($width x $height)', (viewport) => {
  let context: BrowserContext;
  let page: Page;
  const errors: string[] = [];
  let navigations = 0;
  const note = (key: string, value: unknown) => {
    measured[viewport.name] = { ...(measured[viewport.name] as object), [key]: value };
  };

  beforeAll(async () => {
    context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor,
      isMobile: viewport.isMobile,
      hasTouch: viewport.hasTouch,
    });
    page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('framenavigated', (f) => f === page.mainFrame() && f.url().includes('viewer.html') && errors.length < 50 && navigations++ > 0 && errors.push('page reloaded'));
    await page.goto(baseUrl + '/demo/viewer.html?seed=5');
    await page.waitForFunction('window.__view && window.__cube');
    await frames(page);
  });

  afterAll(async () => {
    await context?.close();
  }, 60000);

  /** Screenshot pixel (r, g, b) at a point given in CSS pixels from the top left of the stage. */
  async function pixelsAt(points: { x: number; y: number }[]): Promise<number[][]> {
    const box = await page.evaluate(() => {
      const r = document.getElementById('stage')!.getBoundingClientRect();
      return { x: r.left, y: r.top };
    });
    const png = PNG.sync.read(await page.screenshot());
    const scale = png.width / viewport.width;
    return points.map((p) => {
      const i = (Math.round((box.y + p.y) * scale) * png.width + Math.round((box.x + p.x) * scale)) * 4;
      return [png.data[i] as number, png.data[i + 1] as number, png.data[i + 2] as number];
    });
  }

  it('fills its container and caps the pixel ratio at 2', async () => {
    const size = await page.evaluate(() => {
      const stage = document.getElementById('stage')!;
      const canvas = stage.querySelector('canvas')!;
      return { stageW: stage.clientWidth, stageH: stage.clientHeight, cssW: canvas.clientWidth, cssH: canvas.clientHeight, w: canvas.width, h: canvas.height, dpr: window.devicePixelRatio };
    });
    expect(size.cssW).toBe(size.stageW);
    expect(size.cssH).toBe(size.stageH);
    const ratio = Math.min(size.dpr, 2);
    expect(size.w).toBe(Math.floor(size.stageW * ratio));
    expect(size.h).toBe(Math.floor(size.stageH * ratio));
    note('canvas', size);
  });

  it('draws sticker colours exactly as the palette gives them, on a transparent canvas', async () => {
    const points = await page.evaluate(() => {
      const w = window as any;
      w.__view.setState(w.__cube.solvedState(), w.__palette);
      w.__view.resetCamera(false);
      const d = w.__view.debug();
      return [0, 1, 2].map((face) => d.project(face, 2, 2));
    });
    await frames(page);
    const seen = await pixelsAt([...points, { x: 3, y: 3 }]);
    const want = await page.evaluate(() => {
      const w = window as any;
      const probe = document.createElement('i');
      document.body.append(probe);
      const rgb = (css: string) => {
        probe.style.color = css;
        return (getComputedStyle(probe).color.match(/\d+/g) as string[]).slice(0, 3).map(Number);
      };
      const out = [0, 1, 2].map((id) => rgb(w.__palette[id]));
      out.push(rgb(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()));
      probe.remove();
      return out;
    });
    note('colourCheck', { seen, want });
    for (let k = 0; k < 4; k++) for (let c = 0; c < 3; c++) expect(Math.abs((seen[k] as number[])[c]! - (want[k] as number[])[c]!)).toBeLessThanOrEqual(2);
  });

  it('applies each of the 108 moves instantly on random states and matches the engine', async () => {
    const result = await page.evaluate(() => {
      const w = window as any;
      const c = w.__cube;
      const rand = c.makeRng(2024);
      const failures: string[] = [];
      let checked = 0;
      for (const m of c.allHalfBlockMoves()) {
        const state = c.applyMoves(c.solvedState(), c.randomMoves(40, rand));
        w.__view.setState(state, w.__palette);
        if (w.__view.getState().join() !== state.join()) failures.push('setState before ' + c.moveToString(m));
        if (checked % 3 === 0) w.__view.showMove(m);
        w.__view.applyMove(m);
        if (w.__view.getState().join() !== c.applyMove(state, m).join()) failures.push(c.moveToString(m));
        checked++;
      }
      return { checked, failures };
    });
    note('instantMovesChecked', result.checked);
    expect(result.failures).toEqual([]);
    expect(result.checked).toBe(108);
  });

  it('animates each of the 108 moves on random states and matches the engine', async () => {
    const result = await page.evaluate(async () => {
      const w = window as any;
      const c = w.__cube;
      const rand = c.makeRng(77);
      const failures: string[] = [];
      let checked = 0;
      const t0 = performance.now();
      for (const m of c.allHalfBlockMoves()) {
        const state = c.applyMoves(c.solvedState(), c.randomMoves(40, rand));
        w.__view.setState(state, w.__palette);
        // Half of them are announced with showMove first, as the guided solve does.
        if (checked % 2 === 0) w.__view.showMove(m);
        await w.__view.animateMove(m, { durationMs: 110 });
        if (w.__view.getState().join() !== c.applyMove(state, m).join()) failures.push(c.moveToString(m));
        if (w.__view.debug().shown !== null) failures.push('still shown after ' + c.moveToString(m));
        checked++;
      }
      return { checked, failures, ms: Math.round(performance.now() - t0) };
    });
    note('animatedMovesChecked', result.checked);
    note('animated108At110msTookMs', result.ms);
    expect(result.failures).toEqual([]);
    expect(result.checked).toBe(108);
  });

  it('honours the duration from 80 ms to 2000 ms, with a default near 450 ms', async () => {
    const result = await page.evaluate(async () => {
      const w = window as any;
      const c = w.__cube;
      let state = c.applyMoves(c.solvedState(), c.randomMoves(40, c.makeRng(5)));
      w.__view.setState(state, w.__palette);
      const out: { asked: number | null; took: number; frames: number; ok: boolean }[] = [];
      for (const [text, asked] of [['3Rw', 80], ["2-3Lw'", null], ['U2', 2000]] as const) {
        const m = c.parseMove(text);
        const before = w.__view.debug().renderCount;
        const t0 = performance.now();
        await w.__view.animateMove(m, asked === null ? undefined : { durationMs: asked });
        const took = performance.now() - t0;
        state = c.applyMove(state, m);
        out.push({ asked, took: Math.round(took), frames: w.__view.debug().renderCount - before, ok: w.__view.getState().join() === state.join() });
      }
      return out;
    });
    note('durations', result);
    for (const r of result) {
      const asked = r.asked ?? 450;
      expect(r.ok).toBe(true);
      expect(r.took).toBeGreaterThanOrEqual(asked - 20);
      expect(r.took).toBeLessThan(asked + 350);
    }
  });

  it('runs 300 random moves animated at 80 ms and ends in the engine state', async () => {
    const result = await page.evaluate(async () => {
      const w = window as any;
      const c = w.__cube;
      let state = c.solvedState();
      w.__view.setState(state, w.__palette);
      const moves = c.randomMoves(300, c.makeRng(31337));
      let firstMismatch = -1;
      const gaps: number[] = [];
      let last = 0;
      let running = true;
      const watch = (now: number) => {
        if (last) gaps.push(now - last);
        last = now;
        if (running) requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
      const rendersBefore = w.__view.debug().renderCount;
      const t0 = performance.now();
      for (let i = 0; i < moves.length; i++) {
        await w.__view.animateMove(moves[i], { durationMs: 80 });
        state = c.applyMove(state, moves[i]);
        if (firstMismatch < 0 && w.__view.getState().join() !== state.join()) firstMismatch = i;
      }
      const ms = performance.now() - t0;
      running = false;
      gaps.sort((a, b) => a - b);
      // Undo everything: the 3D cube must come back to solved.
      for (const m of c.invertMoves(moves)) w.__view.applyMove(m);
      return {
        firstMismatch,
        solvedAfterUndo: c.isSolved(w.__view.getState()),
        ms: Math.round(ms),
        msPerMove: Math.round((ms / moves.length) * 10) / 10,
        renders: w.__view.debug().renderCount - rendersBefore,
        frameGapMedianMs: Math.round((gaps[Math.floor(gaps.length / 2)] as number) * 10) / 10,
        frameGapP95Ms: Math.round((gaps[Math.floor(gaps.length * 0.95)] as number) * 10) / 10,
      };
    });
    note('run300At80ms', result);
    expect(result.firstMismatch).toBe(-1);
    expect(result.solvedAfterUndo).toBe(true);
  });

  it('finishes a running animation at once when another call comes in', async () => {
    const result = await page.evaluate(async () => {
      const w = window as any;
      const c = w.__cube;
      const view = w.__view;
      const start = c.applyMoves(c.solvedState(), c.randomMoves(40, c.makeRng(9)));
      const [a, b] = [c.parseMove('3Rw'), c.parseMove("2U'")];
      view.setState(start, w.__palette);
      let firstDone = false;
      const first = view.animateMove(a, { durationMs: 2000 }).then(() => (firstDone = true));
      await new Promise((r) => setTimeout(r, 150));
      const t0 = performance.now();
      const second = view.animateMove(b, { durationMs: 80 });
      await Promise.resolve();
      await first;
      const firstResolvedEarly = firstDone && performance.now() - t0 < 100;
      await second;
      const chained = view.getState().join() === c.applyMove(c.applyMove(start, a), b).join();

      // setState during an animation: the promise resolves and the new state stands.
      const p = view.animateMove(a, { durationMs: 2000 });
      await new Promise((r) => setTimeout(r, 100));
      view.setState(start, w.__palette);
      await p;
      const replaced = view.getState().join() === start.join();

      // applyMove and showMove during an animation.
      const p2 = view.animateMove(a, { durationMs: 2000 });
      await new Promise((r) => setTimeout(r, 100));
      view.applyMove(b);
      await p2;
      const applied = view.getState().join() === c.applyMove(c.applyMove(start, a), b).join();
      const p3 = view.animateMove(a, { durationMs: 2000 });
      await new Promise((r) => setTimeout(r, 100));
      view.showMove(b);
      await p3;
      const expected = c.applyMove(c.applyMove(c.applyMove(start, a), b), a);
      const shown = view.getState().join() === expected.join() && view.debug().shown !== null;
      view.showMove(null);
      return { firstResolvedEarly, chained, replaced, applied, shown, cleared: view.getState().join() === expected.join() };
    });
    expect(result).toEqual({ firstResolvedEarly: true, chained: true, replaced: true, applied: true, shown: true, cleared: true });
  });

  it('renders on demand: no frames are drawn while nothing moves', async () => {
    await page.waitForTimeout(600);
    const before = await page.evaluate(() => (window as any).__view.debug().renderCount);
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => (window as any).__view.debug());
    expect(after.renderCount).toBe(before);
    expect(after.animating).toBe(false);
  });

  it('orbits and zooms the camera without turning the cube, then resets', async () => {
    const setup = await page.evaluate(() => {
      const w = window as any;
      const state = w.__cube.applyMoves(w.__cube.solvedState(), w.__cube.randomMoves(40, w.__cube.makeRng(12)));
      w.__view.setState(state, w.__palette);
      w.__view.resetCamera(false);
      const r = document.getElementById('stage')!.getBoundingClientRect();
      return { state: state.join(), x: r.left + r.width / 2, y: r.top + r.height / 2, camera: w.__view.debug().camera };
    });
    const camera = () => page.evaluate(() => (window as any).__view.debug().camera);
    const { x, y } = setup;
    if (viewport.hasTouch) {
      const cdp = await context.newCDPSession(page);
      const touch = (type: string, points: { x: number; y: number }[]) =>
        cdp.send('Input.dispatchTouchEvent', { type: type as 'touchStart', touchPoints: points.map((p, id) => ({ ...p, id })) });
      await touch('touchStart', [{ x, y }]);
      for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: x + i * 12, y: y + i * 5 }]);
      await touch('touchEnd', []);
      const swiped = await camera();
      expect(Math.hypot(swiped.x - setup.camera.x, swiped.y - setup.camera.y, swiped.z - setup.camera.z)).toBeGreaterThan(1);
      expect(swiped.distance).toBeCloseTo(setup.camera.distance, 3);
      await touch('touchStart', [{ x: x - 30, y }, { x: x + 30, y }]);
      for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: x - 30 - i * 8, y }, { x: x + 30 + i * 8, y }]);
      await touch('touchEnd', []);
      const pinched = await camera();
      expect(pinched.distance).toBeLessThan(swiped.distance * 0.9);
      expect(pinched.distance).toBeGreaterThanOrEqual(pinched.fitDistance * 0.5 - 1e-6);
      note('touch', { swipeMovedCamera: true, pinchDistanceRatio: Math.round((pinched.distance / swiped.distance) * 100) / 100 });
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 140, y + 60, { steps: 8 });
      await page.mouse.up();
      const dragged = await camera();
      expect(Math.hypot(dragged.x - setup.camera.x, dragged.y - setup.camera.y, dragged.z - setup.camera.z)).toBeGreaterThan(1);
      expect(dragged.distance).toBeCloseTo(setup.camera.distance, 3);
      await page.mouse.wheel(0, -600);
      await page.waitForTimeout(100);
      const zoomed = await camera();
      expect(zoomed.distance).toBeLessThan(dragged.distance * 0.95);
      for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 600);
      await page.waitForTimeout(100);
      const far = await camera();
      expect(far.distance).toBeLessThanOrEqual(far.fitDistance * 1.6 + 1e-6);
      note('mouse', { dragMovedCamera: true, wheelDistanceRatio: Math.round((zoomed.distance / dragged.distance) * 100) / 100 });
    }
    expect(await page.evaluate(() => (window as any).__view.getState().join())).toBe(setup.state);
    await page.evaluate(() => (window as any).__view.resetCamera(true));
    await page.waitForTimeout(700);
    const back = await camera();
    expect(back.x).toBeCloseTo(setup.camera.x, 4);
    expect(back.y).toBeCloseTo(setup.camera.y, 4);
    expect(back.z).toBeCloseTo(setup.camera.z, 4);
  });

  it('setPose turns the whole cube for the capture guide and leaves the state alone', async () => {
    const result = await page.evaluate(async () => {
      const w = window as any;
      const c = w.__cube;
      const view = w.__view;
      const state = c.applyMoves(c.solvedState(), c.randomMoves(40, c.makeRng(21)));
      view.setState(state, w.__palette);
      view.resetCamera(false);
      const at = (face: number, row: number, col: number) => view.debug().project(face, row, col);
      const home = { front: at(c.F, 0, 0), up: at(c.U, 0, 0) };
      const out: { pose: string; frontOk: boolean; upOk: boolean; stateOk: boolean }[] = [];
      const close = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y) < 0.5;
      // In each pose the "front" face must be drawn where F is at rest, and "up" where U is: the four
      // middle stickers of the posed face must land on the four middle stickers of the reference face.
      const middle = (face: number) =>
        [at(face, 2, 2), at(face, 2, 3), at(face, 3, 2), at(face, 3, 3)].sort((a, b) => a.x - b.x || a.y - b.y);
      const same = (a: any[], b: any[]) => a.every((p, i) => close(p, b[i]));
      const poses = [[c.R, c.U], [c.B, c.U], [c.L, c.U], [c.U, c.B], [c.D, c.F], [c.F, c.U]];
      for (const [front, up] of poses) {
        await view.setPose({ front, up }, 120);
        const posed = { front: middle(front), up: middle(up) };
        await view.setPose(null, 0);
        const ref = { front: middle(c.F), up: middle(c.U) };
        await view.setPose({ front, up }, 0);
        out.push({ pose: c.FACE_LETTERS[front] + c.FACE_LETTERS[up], frontOk: same(posed.front, ref.front), upOk: same(posed.up, ref.up), stateOk: view.getState().join() === state.join() });
      }
      view.highlightFace(c.F, { upToward: c.U });
      view.highlightFace(null);
      await view.setPose(null, 120);
      let threw = false;
      try {
        await view.setPose({ front: c.U, up: c.D });
      } catch {
        threw = true;
      }
      return { out, threw, homeBack: close(at(c.F, 0, 0), home.front) && close(at(c.U, 0, 0), home.up), stateOk: view.getState().join() === state.join() };
    });
    for (const r of result.out) expect(r, r.pose).toEqual({ pose: r.pose, frontOk: true, upOk: true, stateOk: true });
    expect(result.threw).toBe(true);
    expect(result.homeBack).toBe(true);
    expect(result.stateOk).toBe(true);
  });

  it('works without controls or labels, and dispose removes everything it added', async () => {
    const result = await page.evaluate(async () => {
      const w = window as any;
      const c = w.__cube;
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:200px;';
      document.body.append(box);
      const view = new w.__CubeView(box, { interactive: false, faceLabels: false });
      const state = c.applyMoves(c.solvedState(), c.randomMoves(40, c.makeRng(3)));
      view.setState(state, w.__palette);
      const m = c.parseMove("2-3Uw'");
      view.showMove(m);
      const pending = view.animateMove(m, { durationMs: 2000 });
      const canvas = box.querySelector('canvas') as HTMLCanvasElement;
      const out = {
        canvas: canvas.width + 'x' + canvas.height,
        labels: box.textContent,
        touchAction: canvas.style.touchAction,
        resolved: false,
        stateOk: false,
        left: -1,
      };
      view.dispose();
      await pending;
      out.resolved = true;
      out.stateOk = view.getState().join() === c.applyMove(state, m).join();
      out.left = box.childElementCount;
      view.dispose();
      box.remove();
      return out;
    });
    const ratio = Math.min(viewport.deviceScaleFactor, 2);
    expect(result).toEqual({ canvas: 200 * ratio + 'x' + 200 * ratio, labels: '180°', touchAction: '', resolved: true, stateOk: true, left: 0 });
  });

  it('follows a container resize', async () => {
    await page.setViewportSize({ width: viewport.height, height: viewport.width });
    await frames(page, 3);
    const size = await page.evaluate(() => {
      const stage = document.getElementById('stage')!;
      const canvas = stage.querySelector('canvas')!;
      return { stageW: stage.clientWidth, stageH: stage.clientHeight, w: canvas.width, h: canvas.height, ratio: Math.min(window.devicePixelRatio, 2) };
    });
    expect(size.w).toBe(Math.floor(size.stageW * size.ratio));
    expect(size.h).toBe(Math.floor(size.stageH * size.ratio));
    await page.screenshot({ path: resolve(SHOTS, viewport.name + '-rotated-3Rw.png') }).catch(() => undefined);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await frames(page, 3);
  });

  it('saves showMove screenshots', async () => {
    for (const scrambled of [false, true]) {
      for (const text of SHOT_MOVES) {
        await page.evaluate(
          ([text, scrambled]) => {
            const w = window as any;
            const c = w.__cube;
            const state = scrambled ? c.applyMoves(c.solvedState(), c.randomMoves(80, c.makeRng(11))) : c.solvedState();
            w.__view.setState(state, w.__palette);
            w.__view.resetCamera(false);
            w.__view.showMove(c.parseMove(text));
            document.getElementById('move')!.textContent = text;
            document.getElementById('info')!.textContent = scrambled ? 'scrambled cube' : 'solved cube';
          },
          [text, scrambled] as const,
        );
        await frames(page);
        const arrows = await page.evaluate(() => (window as any).__view.debug().arrows.length);
        expect(arrows).toBeGreaterThanOrEqual(2);
        await page.screenshot({ path: resolve(SHOTS, viewport.name + '-' + fileName(text) + (scrambled ? '-scrambled' : '') + '.png') });
      }
    }
    // A frame from the middle of a turn, and the capture-guide pose.
    await page.evaluate(() => {
      const w = window as any;
      w.__view.showMove(w.__cube.parseMove('3Rw'));
      void w.__view.animateMove(w.__cube.parseMove('3Rw'), { durationMs: 2000 });
      document.getElementById('move')!.textContent = '3Rw';
      document.getElementById('info')!.textContent = 'part way through the turn';
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: resolve(SHOTS, viewport.name + '-turning-3Rw.png') });
    await page.evaluate(async () => {
      const w = window as any;
      w.__view.setState(w.__cube.solvedState(), w.__palette);
      w.__view.highlightFace(w.__cube.R, { upToward: w.__cube.U });
      await w.__view.setPose({ front: w.__cube.R, up: w.__cube.U }, 0);
      document.getElementById('move')!.textContent = 'pose';
      document.getElementById('info')!.textContent = 'photograph right face, top side up';
    });
    await frames(page);
    await page.screenshot({ path: resolve(SHOTS, viewport.name + '-pose-right-up.png') });
    await page.evaluate(async () => {
      const w = window as any;
      w.__view.highlightFace(null);
      await w.__view.setPose(null, 0);
    });
    expect(errors).toEqual([]);
  });
});
