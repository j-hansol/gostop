// 추천대로 두는 나 vs 상대 AI, 기존 AI 방식의 나 vs 상대 AI 비교
//   npx vite-node tests/advisor.bench.ts [판 수] [샘플 수]
import { publicView, recommend } from '../src/engine/advisor';
import { chooseAction } from '../src/engine/ai';
import { Action, Frame, GameState, newRound, PlayerIndex, step } from '../src/engine/game';

const args = (globalThis as unknown as { process: { argv: string[] } }).process.argv;
const games = Number(args[2] ?? 100);
const samples = Number(args[3] ?? 32);

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}
const last = (f: Frame[]) => f[f.length - 1].state;

let calls = 0, ms = 0, worst = 0;
function advised(s: GameState): Action {
  if (s.current === 0 && (s.phase === 'play' || s.phase === 'chooseFloor')) {
    const t = performance.now();
    const adv = recommend(publicView(s, 0), samples)!;
    const d = performance.now() - t;
    calls++; ms += d; worst = Math.max(worst, d);
    return adv.ranked[0].action;
  }
  return chooseAction(s);
}

function run(policy0: (s: GameState) => Action, seed: number) {
  const rng = seeded(seed);
  let win = 0, lose = 0, draw = 0, net = 0;
  for (let g = 0; g < games; g++) {
    let s = last(newRound({ dealer: (g % 2) as PlayerIndex, nagariMultiplier: 1, rng, mission: null }));
    while (s.phase !== 'end') s = last(step(s, s.current === 0 ? policy0(s) : chooseAction(s)));
    const r = s.result!;
    if (r.winner === 0) { win++; net += r.final; } else if (r.winner === 1) { lose++; net -= r.final; } else draw++;
  }
  return { win, lose, draw, net, winRate: (win / (win + lose)).toFixed(3) };
}

console.log('기존 AI 방식:', run(chooseAction, 1234));
console.log('추천대로   :', run(advised, 1234));
console.log(`추천 1회 평균 ${(ms / calls).toFixed(0)}ms, 최대 ${worst.toFixed(0)}ms (샘플 ${samples})`);
