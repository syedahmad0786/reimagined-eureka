/**
 * Web Worker that runs the live finder, so that searching for the cube never holds up the page.
 * Started by CameraCapture with: new Worker(new URL('./live-worker.ts', import.meta.url), { type: 'module' }).
 */
import { LiveFinder, type LiveRequest } from './live';

const finder = new LiveFinder();
const scope = self as unknown as { onmessage: ((e: MessageEvent<LiveRequest>) => void) | null; postMessage(message: unknown, transfer: Transferable[]): void };
scope.onmessage = (e: MessageEvent<LiveRequest>): void => {
  const res = finder.handle(e.data);
  const transfer: Transferable[] = [res.data.buffer as ArrayBuffer];
  if (res.samples) for (const s of res.samples) transfer.push(s.rgb.buffer as ArrayBuffer, s.quality.buffer as ArrayBuffer);
  scope.postMessage(res, transfer);
};
