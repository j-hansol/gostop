import { describe, expect, it } from 'vitest';
import { CARDS, TOTAL_CARDS } from '../src/engine/cards';
import { score } from '../src/engine/scoring';
import { Action, cardLocations, Frame, GameState, goAdjusted, legalActions, newRound, PlayerIndex, settle, step } from '../src/engine/game';
import { chooseAction } from '../src/engine/ai';
import { applyResult, createAi, newProfile, pointRate } from '../src/engine/economy';

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const last = (f: Frame[]) => f[f.length - 1].state;

function checkConservation(s: GameState) {
  const locs = cardLocations(s);
  expect(locs.length).toBe(TOTAL_CARDS);
  expect(new Set(locs).size).toBe(TOTAL_CARDS);
}

function playGame(rng: () => number, policy: (s: GameState) => Action, dealer: PlayerIndex = 0): GameState {
  let frames = newRound({ dealer, nagariMultiplier: 1, rng });
  let s = last(frames);
  frames.forEach((f) => checkConservation(f.state));
  for (let guard = 0; guard < 500 && s.phase !== 'end'; guard++) {
    frames = step(s, policy(s));
    frames.forEach((f) => checkConservation(f.state));
    s = last(frames);
  }
  expect(s.phase).toBe('end');
  expect(s.result).not.toBeNull();
  return s;
}

describe('cards', () => {
  it('51장, 종류별 장수', () => {
    expect(CARDS.length).toBe(51);
    const count = (k: string) => CARDS.filter((c) => c.kind === k).length;
    expect(count('gwang')).toBe(5);
    expect(count('yeol')).toBe(9);
    expect(count('tti')).toBe(10);
    expect(count('pi')).toBe(27);
    expect(CARDS.filter((c) => c.bonus).map((c) => c.piValue)).toEqual([2, 2, 3]);
  });
});

describe('scoring', () => {
  const ids = (pred: (c: (typeof CARDS)[number]) => boolean) => CARDS.filter(pred).map((c) => c.id);
  it('광', () => {
    expect(score([0, 8, 28]).total).toBe(3);
    expect(score([0, 8, 44]).total).toBe(2);
    expect(score([0, 8, 28, 44]).total).toBe(4);
    expect(score(ids((c) => c.kind === 'gwang')).total).toBe(15);
  });
  it('고도리, 단', () => {
    expect(score([4, 12, 29]).total).toBe(5);
    expect(score([1, 5, 9]).total).toBe(3);
    expect(score([21, 33, 37]).total).toBe(3);
    expect(score([13, 17, 25]).total).toBe(3);
    expect(score([1, 5, 9, 13, 17]).total).toBe(4); // 홍단 3 + 띠 5장 1
  });
  it('피와 쌍피, 보너스', () => {
    const plain = ids((c) => c.kind === 'pi' && c.piValue === 1).slice(0, 8);
    expect(score(plain).total).toBe(0);
    expect(score([...plain, 48]).total).toBe(1);
    expect(score([...plain, 50]).total).toBe(2);
  });
  it('국진은 유리한 쪽으로', () => {
    const plain = ids((c) => c.kind === 'pi' && c.piValue === 1).slice(0, 8);
    expect(score([...plain, 32]).total).toBe(1);
    expect(score([4, 12, 16, 20, 24, 32]).yeolCount).toBe(6);
  });
  it('고 보너스', () => {
    expect(goAdjusted(7, 1).value).toBe(8);
    expect(goAdjusted(7, 2).value).toBe(9);
    expect(goAdjusted(7, 3).value).toBe(20);
    expect(goAdjusted(7, 4).value).toBe(44);
  });
});

describe('game flow', () => {
  it('무작위 정책으로 1000판: 카드 보존, 반드시 종료', () => {
    const rng = seeded(42);
    for (let g = 0; g < 1000; g++) {
      playGame(rng, (s) => {
        const acts = legalActions(s);
        expect(acts.length).toBeGreaterThan(0);
        return acts[Math.floor(rng() * acts.length)];
      }, (g % 2) as PlayerIndex);
    }
  });

  it('AI끼리 30판', () => {
    const rng = seeded(7);
    let wins = 0, draws = 0;
    for (let g = 0; g < 30; g++) {
      const s = playGame(rng, chooseAction, (g % 2) as PlayerIndex);
      if (s.result!.winner === null) draws++;
      else wins++;
    }
    expect(wins + draws).toBe(30);
  });

  it('피박·광박·고박 배수', () => {
    const s = last(newRound({ dealer: 0, nagariMultiplier: 2, rng: seeded(1) }));
    const plain = CARDS.filter((c) => c.kind === 'pi' && c.piValue === 1).map((c) => c.id);
    s.players[0].captured = [0, 8, 28, ...plain.slice(0, 10)];
    s.players[1].captured = [plain[10]];
    s.players[1].goCount = 1;
    const r = settle(s, 0);
    expect(r.base).toBe(4);
    expect(r.multipliers.map((m) => m.label)).toEqual(['피박', '광박', '고박', '나가리']);
    expect(r.final).toBe(4 * 2 * 2 * 2 * 2);
  });
});

describe('economy', () => {
  it('점수당 금액', () => {
    expect(pointRate(1)).toBe(100);
    expect(pointRate(9)).toBe(100);
    expect(pointRate(10)).toBe(200);
    expect(pointRate(25)).toBe(300);
  });
  it('AI 파산 → 레벨업, 새 AI는 이전 생성 금액의 0~40% 증액', () => {
    const p = newProfile(seeded(3));
    p.ai.money = 500;
    const { profile, settlement } = applyResult(p, 0, 10, seeded(5));
    expect(settlement.paid).toBe(500);
    expect(settlement.aiBankrupt).toBe(true);
    expect(profile.level).toBe(2);
    expect(profile.playerMoney).toBe(50500);
    expect(profile.ai.money).toBeGreaterThanOrEqual(50000);
    expect(profile.ai.money).toBeLessThanOrEqual(70000);
    expect(profile.ai.money % 100).toBe(0);
    const a2 = createAi(profile.ai, () => 0.999);
    expect(a2.money).toBeLessThanOrEqual(Math.round(profile.ai.initialMoney * 1.4 / 100) * 100);
  });
  it('나가리 누적', () => {
    let p = newProfile(seeded(3));
    p = applyResult(p, null, 0).profile;
    p = applyResult(p, null, 0).profile;
    expect(p.nagariStreak).toBe(2);
    p = applyResult(p, 1, 7).profile;
    expect(p.nagariStreak).toBe(0);
    expect(p.dealer).toBe(1);
  });
});

describe('comboProgress', () => {
  it('유력·달성·막힘', async () => {
    const { comboProgress } = await import('../src/engine/scoring');
    const p = comboProgress([4, 12, 1, 5, 9, 21, 0, 8], [33]);
    const by = Object.fromEntries(p.map((c) => [c.key, c.state]));
    expect(by.godori).toBe('likely');
    expect(by.hongdan).toBe('done');
    expect(by.cheongdan).toBeUndefined(); // 상대가 33을 가져가 막힘
    expect(by.gwang).toBe('likely');
    expect(comboProgress([0, 8], [28, 40, 44]).find((c) => c.key === 'gwang')).toBeUndefined();
  });
});
