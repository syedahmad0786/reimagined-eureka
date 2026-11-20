import type { SolveResult } from '../solver/index';
import type { Suggestion } from '../cube/validate';
import type { SolverRequest, SolverResponse } from '../solver/worker';

type Payload = SolverRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

/** Promise wrapper around the solver worker. Table preparation starts as soon as it is created. */
export class SolverClient {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  readonly ready: Promise<void>;

  constructor() {
    this.worker = new Worker(new URL('../solver/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<SolverResponse>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result);
      else p.reject(Object.assign(new Error(e.data.error), { unsolvable: e.data.unsolvable }));
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'The solver could not start.'));
      this.pending.clear();
    };
    this.ready = this.call('prepare' as const, {}).then(() => undefined);
    this.ready.catch(() => undefined);
  }

  private call(type: Payload['type'], payload: object): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, ...payload });
    });
  }

  solve(state: Uint8Array): Promise<SolveResult> {
    return this.call('solve', { state }) as Promise<SolveResult>;
  }

  suggest(state: Uint8Array, names: string[], costs?: Float32Array): Promise<Suggestion[]> {
    return this.call('suggest', { state, names, costs }) as Promise<Suggestion[]>;
  }
}
