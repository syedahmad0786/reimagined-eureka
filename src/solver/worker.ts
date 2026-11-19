/// <reference lib="webworker" />
/**
 * Runs the solver off the main thread so the page stays responsive while the lookup tables are built
 * (about two seconds, once) and while a cube is solved.
 */
import { prepareSolver, solveCube, UnsolvableError } from './index';
import { suggestFixes } from '../cube/validate';

export type SolverRequest =
  | { id: number; type: 'prepare' }
  | { id: number; type: 'solve'; state: Uint8Array }
  | { id: number; type: 'suggest'; state: Uint8Array; names: string[]; costs?: Float32Array };

export type SolverResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string; unsolvable: boolean };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (e: MessageEvent<SolverRequest>) => {
  const req = e.data;
  try {
    let result: unknown = null;
    if (req.type === 'prepare') prepareSolver();
    else if (req.type === 'solve') result = solveCube(req.state);
    else result = suggestFixes(req.state, req.names, req.costs);
    scope.postMessage({ id: req.id, ok: true, result } satisfies SolverResponse);
  } catch (err) {
    scope.postMessage({ id: req.id, ok: false, error: (err as Error).message || String(err), unsolvable: err instanceof UnsolvableError } satisfies SolverResponse);
  }
};
