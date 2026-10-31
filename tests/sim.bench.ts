import { chooseAction } from '../src/engine/ai';
import { Action, GameState, legalActions, newRound, step, currentScore } from '../src/engine/game';
import { monthOf } from '../src/engine/cards';

function greedy(s: GameState): Action {
  const acts = legalActions(s);
  if (s.phase === 'goStop') return { type: 'goStop', go: false };
  if (s.phase === 'chooseFloor') return acts[0];
  const fm = new Set(s.floor.map(monthOf));
  return acts.find((a) => a.type === 'play' && fm.has(monthOf(a.card))) ?? acts[0];
}
let ai = 0, gr = 0, draw = 0, aiPts = 0, grPts = 0;
const N = Number((globalThis as { process?: { argv: string[] } }).process?.argv[2] ?? 300);
for (let g = 0; g < N; g++) {
  let seed = g * 7919 + 1; const rng = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  let s = newRound({ dealer: (g % 2) as 0 | 1, nagariMultiplier: 1, rng, mission: null }).at(-1)!.state;
  while (s.phase !== 'end') s = step(s, s.current === 1 ? (s.phase === "goStop" ? { type: "goStop", go: false } as Action : chooseAction(s)) : greedy(s)).at(-1)!.state;
  const w = s.result!.winner;
  if (w === 1) { ai++; aiPts += s.result!.final; } else if (w === 0) { gr++; grPts += s.result!.final; } else draw++;
  void currentScore;
}
console.log({ ai, greedy: gr, draw, aiPts, grPts });
