import { describe, expect, it } from 'vitest';
import { Advice, publicView, recommend, threats } from '../src/engine/advisor';
import { cardLocations, Frame, GameState, newRound, step } from '../src/engine/game';

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}
const last = (f: Frame[]) => f[f.length - 1].state;

/** 지정한 패를 배치하고 나머지는 상대 손패·더미에 채운 내 차례 장면 */
function scene(o: { myHand: number[]; floor: number[]; myCap?: number[]; oppCap: number[]; turn?: number }): GameState {
  const s = last(newRound({ dealer: 0, nagariMultiplier: 1, rng: seeded(5) }));
  const myCap = o.myCap ?? [];
  const used = new Set([...o.myHand, ...o.floor, ...myCap, ...o.oppCap]);
  const rest = cardLocations(s).filter((id) => !used.has(id));
  const n = o.myHand.length;
  s.players[0].hand = o.myHand;
  s.players[0].captured = myCap;
  s.players[1].captured = o.oppCap;
  s.players[1].hand = rest.slice(0, n);
  s.floor = o.floor;
  s.deck = rest.slice(n);
  s.current = 0;
  s.phase = 'play';
  s.ppeokOwner = {};
  // 첫 턴이면 첫뻑(7점 금액) 가능성이 평가에 섞이므로, 그 영향을 빼고 보려면 turn을 준다
  if (o.turn) s.players[0].turnsTaken = s.players[1].turnsTaken = o.turn;
  return s;
}

const best = (s: GameState): Advice['ranked'][number] => recommend(publicView(s, 0), 48)!.ranked[0];
const bestCard = (s: GameState) => (best(s).action as { card: number }).card;

describe('추천: 상대 저지', () => {
  it('상대 고도리 2/3이면 남은 새를 먹어 막는다', () => {
    const s = scene({ myHand: [31, 7, 42, 46], floor: [29, 6, 26], oppCap: [4, 12] });
    expect(bestCard(s)).toBe(31);
    expect(best(s).reason).toContain('상대 고도리 차단');
  });

  it('상대 홍단 2/3이면 광보다 홍단 띠를 먹어 막는다', () => {
    const s = scene({ myHand: [10, 3, 42, 46], floor: [9, 0, 26], oppCap: [1, 5] });
    expect(bestCard(s)).toBe(10);
    expect(best(s).reason).toContain('상대 홍단 차단');
  });

  it('상대 2광이면 광을 먹어 3광을 막고 이유에 적는다', () => {
    const s = scene({ myHand: [42, 7, 46], floor: [40, 6, 26], oppCap: [0, 28] });
    expect(bestCard(s)).toBe(42);
    expect(best(s).reason).toContain('상대 3광');
  });

  it('바닥 2장 중 고를 때 광보다 상대 고도리를 막는 쪽을 고른다', () => {
    const s = scene({ myHand: [31, 7, 46], floor: [28, 29, 26], oppCap: [4, 12] });
    const play = best(s);
    expect(bestCard(s)).toBe(31);
    expect(play.reason).toContain('상대 고도리 차단');
    expect(play.reason).not.toContain('버려도');
    const t = last(step(s, { type: 'play', card: 31 }));
    expect(t.phase).toBe('chooseFloor');
    const pick = best(t);
    expect(pick.action).toEqual({ type: 'choose', card: 29 });
    expect(pick.reason).toContain('상대 고도리 차단');
  });

  it('상대에게 필요한 패를 쥐고 있으면 그 패를 버리지 않는다', () => {
    // 기러기(29)는 바닥에 짝이 없다. 버리면 상대가 고도리를 완성할 수 있다
    const s = scene({ myHand: [29, 42, 47], floor: [6, 14, 26], oppCap: [4, 12] });
    expect(bestCard(s)).not.toBe(29);
    expect(best(s).reason).toContain('손에 남김');
  });

  it('같은 월 나머지가 모두 나온 짝 패를 위험한 버림패보다 먼저 낸다', () => {
    // 7월: 멧돼지(24)는 상대가, 초단(25)은 내가 먹었다 → 손의 7월 피 26·27은 아무도 못 가져간다
    const s = scene({ myHand: [26, 27, 3, 42, 13], floor: [6, 10, 30, 34], myCap: [25], oppCap: [24, 2] });
    expect([26, 27]).toContain(bestCard(s));
    expect(best(s).reason).toContain('안전한 패');
  });

  it('아무도 먹을 수 없는 죽은 패를 위험한 버림패보다 먼저 낸다', () => {
    const s = scene({ myHand: [35, 3, 42, 13], floor: [6, 10, 30], myCap: [32, 33, 34], oppCap: [2], turn: 3 });
    expect(bestCard(s)).toBe(35);
    expect(best(s).reason).toContain('버려도 위험 없음');
  });

  it('상대 피 8장이면 쌍피를 짝 없이 버리지 않는다', () => {
    const s = scene({ myHand: [41, 3, 13, 18], floor: [6, 10, 30], oppCap: [2, 7, 11, 14, 15, 19, 22, 23] });
    expect(bestCard(s)).not.toBe(41);
    const adv = recommend(publicView(s, 0), 48)!;
    expect(adv.ranked.at(-1)!.action).toEqual({ type: 'play', card: 41 });
  });

  it('쌍피를 버릴 때는 내줄 위험을 이유에 적는다', () => {
    // 버릴 패가 쌍피와 상대 고도리에 필요한 새뿐이면 쌍피를 내되 위험을 밝힌다
    const s = scene({ myHand: [41, 29], floor: [6, 10, 34], oppCap: [4, 12] });
    expect(bestCard(s)).toBe(41);
    expect(best(s).reason).toMatch(/쌍피 내줄 위험 \d+%/);
  });

  it('상대에게 빼앗을 피가 없으면 보너스패를 아껴 둔다', () => {
    // 판 초반: 상대는 광 1장뿐. 내 손에 2피 보너스(48)
    const s = scene({ myHand: [48, 10, 42, 13, 18, 31], floor: [11, 6, 26, 34], oppCap: [0] });
    const adv = recommend(publicView(s, 0), 48)!;
    expect(adv.ranked[0].action).not.toEqual({ type: 'play', card: 48 });
    expect(adv.ranked[0].reason).toContain('보너스패는 상대가 피를 먹은 뒤에 내려고 아껴 둠');
  });

  it('상대에게 피가 있으면 보너스패를 먼저 내 피를 빼앗는다', () => {
    const s = scene({ myHand: [48, 10, 42, 13, 18, 31], floor: [11, 6, 26, 34], oppCap: [0, 2] });
    const r = best(s);
    expect(r.action).toEqual({ type: 'play', card: 48 });
    expect(r.reason).toContain('상대 피 1장을 빼앗고');
  });

  it('상대가 4점 이상이면 피가 없어도 보너스패를 챙긴다', () => {
    // 상대: 고도리(5점), 피 없음
    const s = scene({ myHand: [49, 10, 42, 13, 18, 31], floor: [11, 6, 26, 34], oppCap: [4, 12, 29] });
    const r = best(s);
    expect(r.action).toEqual({ type: 'play', card: 49 });
    expect(r.reason).toContain('판이 끝나기 전에');
  });

  it('위협 목록: 족보 2/3, 2광, 피 9장, 5~6점', () => {
    const pi9 = [2, 3, 6, 7, 10, 11, 14, 15, 18];
    const keys = (theirs: number[], mine: number[] = [], hand: number[] = []) => threats(theirs, mine, hand).map((t) => t.key);
    expect(keys([4, 12])).toContain('godori');
    expect(keys([4, 12], [29])).not.toContain('godori'); // 이미 내가 먹음
    expect(threats([4, 12], [], [29]).find((t) => t.key === 'godori')!.held).toBe(true);
    expect(keys([0, 28])).toContain('gwang');
    expect(keys(pi9)).toContain('pi');
    expect(keys([4, 12, 29, 1])).toContain('score'); // 고도리 5점
  });
});
