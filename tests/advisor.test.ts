import { describe, expect, it } from 'vitest';
import { adviseGoStop, publicView, recommend, unknownCards } from '../src/engine/advisor';
import { chooseAction } from '../src/engine/ai';
import { cardLocations, Frame, GameState, legalActions, newRound, PlayerIndex, step } from '../src/engine/game';

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}
const last = (f: Frame[]) => f[f.length - 1].state;

/** 내 차례(낼 패 고르기)인 장면을 여러 개 모은다 */
function scenes(n: number, seed: number): GameState[] {
  const rng = seeded(seed);
  const out: GameState[] = [];
  for (let g = 0; out.length < n && g < 200; g++) {
    let s = last(newRound({ dealer: (g % 2) as PlayerIndex, nagariMultiplier: 1, rng }));
    for (let guard = 0; guard < 200 && s.phase !== 'end'; guard++) {
      if (s.current === 0 && (s.phase === 'chooseFloor' || (s.phase === 'play' && rng() < 0.3))) out.push(s);
      s = last(step(s, chooseAction(s)));
    }
  }
  return out.slice(0, n);
}

/** 공개 정보는 그대로 두고 상대 손패와 더미의 내용만 서로 섞는다 */
function scrambleHidden(s: GameState, rng: () => number): GameState {
  const t = structuredClone(s);
  const opp = t.players[1];
  const keep = opp.revealed.filter((id) => opp.hand.includes(id));
  const pool = [...opp.hand.filter((id) => !keep.includes(id)), ...t.deck];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const handN = opp.hand.length - keep.length;
  opp.hand = [...keep, ...pool.slice(0, handN)];
  t.deck = pool.slice(handN);
  return t;
}

describe('추천', () => {
  it('공개 정보만 사용: 상대 손패·더미를 바꿔도 추천이 같다', () => {
    const rng = seeded(99);
    for (const s of scenes(12, 5)) {
      const t = scrambleHidden(s, rng);
      expect(cardLocations(t).sort((a, b) => a - b)).toEqual(cardLocations(s).sort((a, b) => a - b));
      expect(publicView(t, 0)).toEqual(publicView(s, 0));
      expect(recommend(publicView(t, 0), 16)).toEqual(recommend(publicView(s, 0), 16));
    }
  });

  it('PublicView에는 상대 손패와 더미 내용이 없다', () => {
    const s = scenes(1, 3)[0];
    const v = publicView(s, 0);
    expect(JSON.stringify(v)).not.toContain('"hand"');
    expect(v).not.toHaveProperty('deck');
    expect(unknownCards(v).length).toBe(s.deck.length + s.players[1].hand.length);
  });

  it('추천 수는 실제로 둘 수 있는 수이고 이유가 붙는다', () => {
    for (const s of scenes(8, 11)) {
      const adv = recommend(publicView(s, 0), 16)!;
      expect(adv.ranked.length).toBeGreaterThan(0);
      const legal = legalActions(s).map((a) => JSON.stringify({ ...a, shake: undefined }));
      for (const r of adv.ranked) expect(legal).toContainEqual(JSON.stringify({ ...r.action, shake: undefined }));
      expect(adv.ranked[0].reason.length).toBeGreaterThan(0);
    }
  });

  it('바닥 2장 중 고르기 장면도 추천한다', () => {
    const s = scenes(60, 17).find((x) => x.phase === 'chooseFloor')!;
    expect(s).toBeDefined();
    const adv = recommend(publicView(s, 0), 16)!;
    expect(adv.phase).toBe('chooseFloor');
    expect(s.choice!.options).toContain((adv.ranked[0].action as { card: number }).card);
  });

  it('내 차례가 아니면 추천하지 않고, 고/스톱 조언은 이유를 준다', () => {
    const s = scenes(1, 8)[0];
    expect(recommend(publicView({ ...s, current: 1 }, 0))).toBeNull();
    expect(adviseGoStop(publicView(s, 0)).reason.length).toBeGreaterThan(0);
  });
});
