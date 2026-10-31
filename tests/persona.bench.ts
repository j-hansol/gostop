// 성격별 AI와 표준 AI의 대전 비교. 같은 배분을 자리만 바꿔 두 번씩 둔다.
import { chooseAction } from '../src/engine/ai';
import { GameState, newRound, PlayerIndex, step } from '../src/engine/game';
import { AI_PERSONAS, BALANCED, Persona } from '../src/engine/personality';

const N = Number((globalThis as { process?: { argv: string[] } }).process?.argv[2] ?? 100);

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function play(seed: number, a: Persona, b: Persona): GameState {
  const personas = [a, b];
  let s = newRound({ dealer: (seed % 2) as PlayerIndex, nagariMultiplier: 1, rng: seeded(seed) }).at(-1)!.state;
  while (s.phase !== 'end') s = step(s, chooseAction(s, personas[s.current])).at(-1)!.state;
  return s;
}

for (const p of [BALANCED, ...AI_PERSONAS]) {
  let win = 0, lose = 0, draw = 0, net = 0, go = 0, finalSum = 0;
  for (let g = 0; g < N; g++) {
    for (const seat of [0, 1] as const) {
      const s = play(g * 7919 + 1, seat === 0 ? p : BALANCED, seat === 0 ? BALANCED : p);
      const r = s.result!;
      go += s.players[seat].goCount;
      if (r.winner === null) draw++;
      else if (r.winner === seat) { win++; net += r.final; finalSum += r.final; }
      else { lose++; net -= r.final; }
    }
  }
  const games = N * 2;
  console.log(`${p.label}: 승률 ${((100 * win) / games).toFixed(1)}% (승 ${win} 패 ${lose} 무 ${draw}), 판당 점수 차 ${(net / games).toFixed(1)}, 이긴 판 평균 ${(finalSum / Math.max(1, win)).toFixed(1)}점, 판당 고 ${(go / games).toFixed(2)}회`);
}
