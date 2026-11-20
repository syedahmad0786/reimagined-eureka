/**
 * Helpers for showing Learn algorithms on the 3D cube.
 */
import { solvedState } from '../cube/geometry';
import { applyMoves, parseMoves, type Move } from '../cube/moves';
import { LEARN_TOPICS, type LearnAlgorithm, type LearnVariant } from './content';

export function learnAlgorithms(): LearnAlgorithm[] {
  return LEARN_TOPICS.flatMap((topic) => topic.blocks.filter((block): block is LearnAlgorithm => block.kind === 'algorithm'));
}

/** An algorithm or variant by id, with the id of the topic it belongs to. */
export function findAlgorithm(id: string): { topic: string; item: LearnAlgorithm | LearnVariant } | null {
  for (const topic of LEARN_TOPICS) {
    for (const block of topic.blocks) {
      if (block.kind !== 'algorithm') continue;
      if (block.id === id) return { topic: topic.id, item: block };
      const variant = block.variants?.find((v) => v.id === id);
      if (variant) return { topic: topic.id, item: variant };
    }
  }
  return null;
}

export interface AlgorithmDemo {
  /** The position to show first: a solved cube after the setup, with colour id = face id. */
  start: Uint8Array;
  moves: Move[];
  /** The position after every move: states[0] is start, states[moves.length] the result. */
  states: Uint8Array[];
}

export function algorithmDemo(item: { moves: string; setup?: string }): AlgorithmDemo {
  const start = applyMoves(solvedState(), parseMoves(item.setup ?? ''));
  const moves = parseMoves(item.moves);
  const states = [start];
  for (const move of moves) states.push(applyMoves(states[states.length - 1] as Uint8Array, [move]));
  return { start, moves, states };
}
