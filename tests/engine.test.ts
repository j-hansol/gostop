import { describe, expect, it } from 'vitest';
import { CARDS, monthOf, TOTAL_CARDS } from '../src/engine/cards';
import { score } from '../src/engine/scoring';
import { Action, cardLocations, currentScore, drawMission, Frame, GameState, goAdjusted, legalActions, Mission, missionBlocked, missionDone, missionGroup, missionLabel, newRound, PlayerIndex, settle, step } from '../src/engine/game';
import { bestFloorChoice, chooseAction, decideGoStop, worth } from '../src/engine/ai';
import { publicView, recommend } from '../src/engine/advisor';
import { applyResult, createAi, loadProfile, newProfile, pointRate } from '../src/engine/economy';
import { AI_PERSONAS, BALANCED, personalityFromName, personaOf } from '../src/engine/personality';

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
  it('50장, 종류별 장수', () => {
    expect(CARDS.length).toBe(50);
    const count = (k: string) => CARDS.filter((c) => c.kind === k).length;
    expect(count('gwang')).toBe(5);
    expect(count('yeol')).toBe(9);
    expect(count('tti')).toBe(10);
    expect(count('pi')).toBe(26);
    expect(CARDS.filter((c) => c.bonus).map((c) => c.piValue)).toEqual([2, 3]);
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
    expect(score([...plain, 49]).total).toBe(2);
  });
  it('국진은 기본 열끗, 전환 시 쌍피', () => {
    const plain = ids((c) => c.kind === 'pi' && c.piValue === 1).slice(0, 8);
    expect(score([...plain, 32]).total).toBe(0);
    expect(score([...plain, 32], true).total).toBe(1);
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
    const s = last(newRound({ dealer: 0, nagariMultiplier: 2, rng: seeded(1), mission: null }));
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

describe('획득 미션', () => {
  const plain = CARDS.filter((c) => c.kind === 'pi' && c.piValue === 1).map((c) => c.id);
  /** 내가 이기는 장면: 3광 3점 + 피 10장 1점 = 4점 ×피박×광박 = 16점 */
  function scene(mission: Mission | null, mine: number[] = [], theirs: number[] = []) {
    const s = last(newRound({ dealer: 0, nagariMultiplier: 1, rng: seeded(1), mission }));
    s.players[0].captured = [0, 8, 28, ...plain.slice(0, 10), ...mine];
    s.players[1].captured = [plain[10], ...theirs];
    return s;
  }

  it('발생 확률은 약 30%, 패와 보상은 정해진 범위', () => {
    const rng = seeded(11);
    let n = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const m = drawMission(rng);
      if (!m) continue;
      n++;
      expect([2, 3]).toContain(m.cards.length);
      expect(new Set(m.cards).size).toBe(m.cards.length);
      expect(m.cards.some((id) => CARDS[id].bonus)).toBe(false);
      if (m.op === 'add') expect(m.value >= 1 && m.value <= 5).toBe(true);
      else expect(m.value >= 2 && m.value <= 5).toBe(true);
    }
    expect(n / N).toBeGreaterThan(0.28);
    expect(n / N).toBeLessThan(0.32);
  });

  it('표시 형식', () => {
    expect(missionLabel({ cards: [1, 2], op: 'add', value: 3 })).toBe('+ 3');
    expect(missionLabel({ cards: [1, 2], op: 'mul', value: 4 })).toBe('x 4');
  });

  it('완료하면 모든 배수 뒤 최종 점수에 적용', () => {
    expect(settle(scene(null), 0).final).toBe(16);
    const add = settle(scene({ cards: [0, 8], op: 'add', value: 3 }), 0);
    expect(add.missionDone).toBe(true);
    expect(add.beforeMission).toBe(16);
    expect(add.final).toBe(19);
    expect(settle(scene({ cards: [0, 8, 28], op: 'mul', value: 3 }), 0).final).toBe(48);
  });

  it('미완료이거나 패자만 완료하면 미적용', () => {
    expect(settle(scene({ cards: [0, 4], op: 'mul', value: 5 }), 0).final).toBe(16);
    const r = settle(scene({ cards: [4, 12], op: 'mul', value: 5 }, [], [4, 12]), 0);
    expect(r.missionDone).toBeUndefined();
    expect(r.final).toBe(16);
  });

  it('미션 패를 빼앗기면 미완료, 빼앗아 오면 완료', () => {
    const m: Mission = { cards: [plain[0], plain[10]], op: 'add', value: 2 };
    const lost = scene(m);
    lost.players[0].captured = lost.players[0].captured.filter((id) => id !== plain[10]);
    expect(settle(lost, 0).missionDone).toBeUndefined();
    const won = scene(m, [plain[10]]);
    won.players[1].captured = [];
    expect(settle(won, 0).missionDone).toBe(true);
  });

  it('고/스톱 기준 점수에는 영향이 없다', () => {
    const s = scene({ cards: [0, 8], op: 'mul', value: 5 });
    expect(currentScore(s, 0)).toBe(4);
  });

  it('AI는 곱하기 미션을 완료하면 스톱한다', () => {
    const s = scene({ cards: [0, 8], op: 'mul', value: 2 });
    s.current = 0;
    s.deck = s.deck.length ? s.deck : [1, 2, 3, 4, 5];
    expect(decideGoStop(s)).toBe(false);
  });

  it('AI는 값이 같으면 미션 패를 고른다', () => {
    const [a, b] = [plain[0], plain[2]];
    const s = last(newRound({ dealer: 0, nagariMultiplier: 1, rng: seeded(1), mission: { cards: [b, plain[5]], op: 'mul', value: 5 } }));
    s.current = 0;
    s.players[0].captured = [];
    s.players[1].captured = [];
    s.phase = 'chooseFloor';
    s.choice = { options: [a, b], target: 'played' };
    expect(bestFloorChoice(s)).toBe(b);
  });

  it('비슷한 피: 1~11월 일반 피 11쌍, 쌍피와 다른 패는 해당 없음', () => {
    const pairs = [[2, 3], [6, 7], [10, 11], [14, 15], [18, 19], [22, 23], [26, 27], [30, 31], [34, 35], [38, 39], [42, 43]];
    for (const pair of pairs) for (const id of pair) expect(missionGroup(id)).toEqual(pair);
    for (const id of [0, 1, 4, 32, 41, 47]) expect(missionGroup(id)).toEqual([id]);
  });

  it('비슷한 피: 같은 쌍은 한 미션에 함께 뽑히지 않는다', () => {
    const rng = seeded(13);
    for (let i = 0; i < 5000; i++) {
      const m = drawMission(rng);
      if (!m) continue;
      expect(new Set(m.cards.map((id) => missionGroup(id)[0])).size).toBe(m.cards.length);
    }
  });

  it('비슷한 피: 둘 중 한 장이면 완료, 다른 쪽 한 장을 잃어도 인정', () => {
    const m: Mission = { cards: [2, 0], op: 'add', value: 2 };
    expect(missionDone(m, [0, 2])).toBe(true);
    expect(missionDone(m, [0, 3])).toBe(true);
    expect(missionDone(m, [0])).toBe(false);
    // 22번은 패자에게 있고 승자는 짝인 23번을 가졌다: 피가 1장 늘어 5점 ×피박×광박 = 20점, 미션 x 2
    expect(settle(scene({ cards: [22, 0], op: 'mul', value: 2 }, [23]), 0).final).toBe(40);
  });

  it('비슷한 피: 상대가 두 장을 모두 가져야 막히고, 이미 가진 쌍은 가치를 더하지 않는다', () => {
    const m: Mission = { cards: [2, 0], op: 'mul', value: 5 };
    expect(missionBlocked(m, [2])).toBe(false);
    expect(missionBlocked(m, [2, 3])).toBe(true);
    const s = last(newRound({ dealer: 0, nagariMultiplier: 1, rng: seeded(1), mission: m }));
    const none = last(newRound({ dealer: 0, nagariMultiplier: 1, rng: seeded(1), mission: null }));
    expect(worth(s, [3], []) - worth(none, [3], [])).toBeGreaterThan(0);
    expect(worth(s, [2, 3], []) - worth(none, [2, 3], [])).toBeCloseTo(worth(s, [3], []) - worth(none, [3], []));
    expect(worth(s, [3], [2]) - worth(none, [3], [2])).toBeGreaterThan(0);
    expect(worth(s, [0], [2, 3]) - worth(none, [0], [2, 3])).toBe(0);
  });

  it('미션은 공개 정보에 포함되고 추천이 동작한다', () => {
    const m: Mission = { cards: [0, 1], op: 'mul', value: 5 };
    const s = last(newRound({ dealer: 0, nagariMultiplier: 1, rng: seeded(1), mission: m }));
    expect(publicView(s, 0).mission).toEqual(m);
    expect(recommend(publicView(s, 0), 4)).toBeDefined();
  });
});

describe('AI 성격', () => {
  const persona = (id: string) => AI_PERSONAS.find((p) => p.id === id)!;
  const plain = CARDS.filter((c) => c.kind === 'pi' && c.piValue === 1).map((c) => c.id);
  /** AI(0번)가 고/스톱을 고르는 장면. 카드 위치는 판단에 필요한 만큼만 맞춘다 */
  function goScene(mine: number[], theirs: number[], goCount = 0) {
    const s = last(newRound({ dealer: 0, nagariMultiplier: 1, rng: seeded(1), mission: null }));
    s.current = 0;
    s.players[0].captured = mine;
    s.players[1].captured = theirs;
    s.players[0].goCount = goCount;
    return s;
  }

  it('생성: 직전과 다른 성격, 이름의 형용사가 성격과 맞다', () => {
    const rng = seeded(21);
    let ai = createAi(null, rng);
    for (let i = 0; i < 200; i++) {
      const next = createAi(ai, rng);
      expect(next.personality).not.toBe(ai.personality);
      expect(personalityFromName(next.name)).toBe(next.personality);
      ai = next;
    }
  });

  it('저장: 성격이 없던 데이터는 이름으로 복원하고, 모르는 이름은 기본 성격', () => {
    const store = (ai: object) => ({ getItem: () => JSON.stringify({ ...newProfile(seeded(3)), ai }) }) as unknown as Storage;
    expect(loadProfile(store({ name: '겁 없는 곰', money: 1, initialMoney: 1 }))!.ai.personality).toBe('gambler');
    expect(loadProfile(store({ name: '이상한 곰', money: 1, initialMoney: 1 }))!.ai.personality).toBe('balanced');
    expect(personaOf(undefined)).toBe(BALANCED);
  });

  it('성격을 주지 않으면 표준 기준과 같은 수를 둔다', () => {
    const rng = seeded(31);
    for (let g = 0; g < 5; g++) {
      let s = last(newRound({ dealer: 0, nagariMultiplier: 1, rng }));
      while (s.phase !== 'end') {
        const a = chooseAction(s);
        expect(chooseAction(s, BALANCED)).toEqual(a);
        s = last(step(s, a));
      }
    }
  });

  it('고/스톱: 같은 장면에서 성격마다 다르게 고른다', () => {
    const seven = [0, 8, 28, 1, 5, 9, 13];
    const s = goScene(seven, [plain[0], plain[1], plain[2], 4, 12]);
    expect(decideGoStop(s, BALANCED)).toBe(true);
    expect(decideGoStop(s, persona('gambler'))).toBe(true);
    expect(decideGoStop(goScene(seven, [4, 12, 16, 20, 24, 29]), BALANCED)).toBe(false); // 상대 고도리
    expect(decideGoStop(goScene(seven, [4, 12, 16, 20, 24, 29]), persona('gambler'))).toBe(false);
    // 상대 3점: 신중파만 멈춘다
    const three = goScene(seven, [21, 33, 37]);
    expect(decideGoStop(three, BALANCED)).toBe(true);
    expect(decideGoStop(three, persona('careful'))).toBe(false);
    // 3고: 표준은 멈추고 승부사는 계속
    const go3 = goScene(seven, [plain[0]], 3);
    expect(decideGoStop(go3, BALANCED)).toBe(false);
    expect(decideGoStop(go3, persona('gambler'))).toBe(true);
  });

  it('고/스톱: 족보꾼은 족보가 한 장 남았을 때만 고', () => {
    const base = [0, 8, 28, 40, 16, 20, 24];
    expect(decideGoStop(goScene([...base, 4, 12], [plain[0]]), persona('comboHunter'))).toBe(true); // 고도리 2/3
    expect(decideGoStop(goScene(base, [plain[0], 4]), persona('comboHunter'))).toBe(false);
  });

  it('고/스톱: 피 수집가는 상대가 피박이면 스톱', () => {
    const pis = plain.slice(0, 12);
    expect(decideGoStop(goScene(pis, [plain[12]]), persona('piCollector'))).toBe(false);
    expect(decideGoStop(goScene(pis, plain.slice(12, 20)), persona('piCollector'))).toBe(true);
  });

  it('바닥 패: 족보꾼은 띠, 피 수집가는 쌍피를 고른다', () => {
    const s = last(newRound({ dealer: 0, nagariMultiplier: 1, rng: seeded(1), mission: null }));
    s.current = 0;
    s.players[0].captured = [5, 9]; // 홍단 2/3
    s.players[1].captured = [];
    s.phase = 'chooseFloor';
    s.choice = { options: [1, 41], target: 'played' }; // 1월 홍단 띠, 11월 쌍피
    expect(bestFloorChoice(s, persona('comboHunter'))).toBe(1);
    s.players[0].captured = plain.slice(0, 6);
    expect(bestFloorChoice(s, persona('piCollector'))).toBe(41);
  });

  it('바닥 패: 훼방꾼은 상대에게 필요한 패를 끊는다', () => {
    const s = last(newRound({ dealer: 0, nagariMultiplier: 1, rng: seeded(1), mission: null }));
    s.current = 0;
    s.players[0].captured = [];
    s.players[1].captured = [4, 12]; // 상대 고도리 2/3
    s.phase = 'chooseFloor';
    s.choice = { options: [29, 28], target: 'played' }; // 8월 기러기(상대 고도리), 8월 광
    expect(bestFloorChoice(s, BALANCED)).toBe(28);
    expect(bestFloorChoice(s, persona('spoiler'))).toBe(29);
  });

  it('피 수집가는 빼앗을 피가 없으면 보너스패를 아낀다', () => {
    const s = last(newRound({ dealer: 0, nagariMultiplier: 1, rng: seeded(1), mission: null }));
    s.current = 0;
    s.phase = 'play';
    s.players[0].hand = [48, ...s.players[0].hand.filter((c) => c !== 48 && c !== 49).slice(0, 5)];
    s.players[0].captured = [];
    s.players[1].captured = [];
    const cardOf = (a: Action) => (a.type === 'play' ? a.card : null);
    expect(cardOf(chooseAction(s, persona('piCollector')))).not.toBe(48);
    expect(cardOf(chooseAction(s, BALANCED))).toBe(48);
    s.players[1].captured = [plain[0]];
    expect(cardOf(chooseAction(s, persona('piCollector')))).toBe(48);
  });

  it('모든 성격으로 끝까지 두어도 카드가 보존되고 판이 끝난다', () => {
    const rng = seeded(41);
    for (const p of AI_PERSONAS) {
      for (let g = 0; g < 3; g++) playGame(rng, (s) => chooseAction(s, p), (g % 2) as PlayerIndex);
    }
  });
});

describe('economy', () => {
  it('점수당 금액', () => {
    expect(pointRate(1)).toBe(100);
    expect(pointRate(4)).toBe(100);
    expect(pointRate(5)).toBe(200);
    expect(pointRate(9)).toBe(200);
    expect(pointRate(10)).toBe(300);
    expect(pointRate(25)).toBe(600);
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

describe('국진 전환', () => {
  it('쌍피로 바꿔 7점이 되면 전환 단계로 들어가고, 승인하면 쌍피로 센다', async () => {
    const { GUKJIN } = await import('../src/engine/game');
    const plain = CARDS.filter((c) => c.kind === 'pi' && c.piValue === 1).map((c) => c.id).filter((id) => monthOf(id) !== 1);
    let s = last(newRound({ dealer: 0, nagariMultiplier: 1, rng: seeded(11) }));
    // 내 손패 1월 한 장과 바닥 1월 한 장을 맞추도록 꾸민다
    const p = s.players[0];
    const others = cardLocations(s).filter((id) => id !== 0 && id !== 1 && id !== GUKJIN && !plain.slice(0, 14).includes(id));
    p.captured = [GUKJIN, ...plain.slice(0, 14)]; // 피 14장 = 5점, 국진 쌍피면 16장 = 7점
    s.players[1].captured = [];
    p.hand = [0, ...others.slice(0, 5)];
    s.players[1].hand = others.slice(5, 10);
    s.floor = [1];
    s.deck = others.slice(10);
    s.ppeokOwner = {};
    expect(currentScore(s, 0)).toBe(5);
    s = last(step(s, { type: 'play', card: 0 }));
    if (s.phase === 'chooseFloor') s = last(step(s, legalActions(s)[0]));
    expect(s.phase).toBe('gukjin');
    const yes = last(step(s, { type: 'gukjin', toPi: true }));
    expect(yes.players[0].gukjinPi).toBe(true);
    expect(currentScore(yes, 0)).toBeGreaterThanOrEqual(7);
    expect(['goStop', 'end']).toContain(yes.phase);
    const no = last(step(s, { type: 'gukjin', toPi: false }));
    expect(no.players[0].gukjinPi).toBe(false);
    expect(no.phase).toBe('play');
  });
});

describe('뻑 규칙', () => {
  /** 3월 패로 장면을 만든다. 나머지 카드는 손패·더미에 채운다 */
  function setup(o: { hand: number[]; floor: number[]; oppCap: number[]; deckTop?: number[]; owner?: PlayerIndex; turnsTaken?: number }) {
    const s = last(newRound({ dealer: 0, nagariMultiplier: 1, rng: seeded(41) }));
    const used = new Set([...o.hand, ...o.floor, ...o.oppCap, ...(o.deckTop ?? [])]);
    const rest = cardLocations(s).filter((id) => !used.has(id) && monthOf(id) !== 3 && monthOf(id) !== 0);
    s.players[0].hand = [...o.hand, ...rest.slice(0, 5)];
    s.players[0].captured = [];
    s.players[0].turnsTaken = o.turnsTaken ?? 0;
    s.players[1].hand = rest.slice(5, 11);
    s.players[1].captured = [...o.oppCap];
    s.floor = [...o.floor];
    s.deck = [...(o.deckTop ?? []), ...rest.slice(11), 48, 49, ...[8, 9, 10, 11].filter((id) => !used.has(id))];
    s.ppeokOwner = o.owner === undefined ? {} : { 3: o.owner };
    s.current = 0;
    checkConservation(s);
    return s;
  }
  const run = (s: GameState) => {
    const frames = step(s, { type: 'play', card: s.players[0].hand[0] });
    return { t: last(frames), events: frames.flatMap((f) => f.events) };
  };

  it('처음 배분 때 깔린 같은 월 3장을 먹어도 뻑 먹기처럼 피 1장을 받는다', () => {
    const { t, events } = run(setup({ hand: [11], floor: [8, 9, 10], oppCap: [2, 6] }));
    expect([8, 9, 10, 11].every((id) => t.players[0].captured.includes(id))).toBe(true);
    expect(events).toContainEqual({ type: 'ppeokTake', player: 0, self: false });
    expect(t.players[1].captured.length).toBe(1);
  });

  it('상대가 싼 뻑을 먹으면 피 1장, 자기가 싼 뻑을 먹으면(자뻑) 피 2장', () => {
    expect(run(setup({ hand: [11], floor: [8, 9, 10], oppCap: [2, 6, 7], owner: 1 })).t.players[1].captured.length).toBe(2);
    const self = run(setup({ hand: [11], floor: [8, 9, 10], oppCap: [2, 6, 7], owner: 0 }));
    expect(self.events).toContainEqual({ type: 'ppeokTake', player: 0, self: true });
    expect(self.t.players[1].captured.length).toBe(1);
  });

  it('첫 턴에 난 뻑만 첫뻑으로 표시된다', () => {
    // 3월 광(8)을 내 바닥 3월 피(10)와 맞췄는데 뒤집은 패도 3월(9) → 뻑
    const first = run(setup({ hand: [8], floor: [10], oppCap: [], deckTop: [9] }));
    expect(first.events).toContainEqual({ type: 'ppeok', player: 0, first: true, streak: 1 });
    const later = run(setup({ hand: [8], floor: [10], oppCap: [], deckTop: [9], turnsTaken: 2 }));
    expect(later.events).toContainEqual({ type: 'ppeok', player: 0, first: false, streak: 1 });
  });

  it('첫뻑 금액은 7점 × 점당 금액이고, 보유금이 바닥나면 나가리여도 파산 처리된다', async () => {
    const { payBonus, FIRST_PPEOK_POINTS } = await import('../src/engine/economy');
    const p = newProfile(seeded(3));
    const r = payBonus(p, 0, FIRST_PPEOK_POINTS);
    expect(r.amount).toBe(7 * pointRate(1));
    expect(r.profile.playerMoney).toBe(p.playerMoney + 700);
    expect(r.profile.ai.money).toBe(p.ai.money - 700);
    const poor = { ...r.profile, ai: { ...r.profile.ai, money: 300 } };
    const paid = payBonus(poor, 0, FIRST_PPEOK_POINTS);
    expect(paid.paid).toBe(300);
    const end = applyResult(paid.profile, null, 0, seeded(9));
    expect(end.settlement.aiBankrupt).toBe(true);
    expect(end.profile.level).toBe(2);
  });
});

describe('2장 폭탄', () => {
  it('손 2장 + 바닥 2장이면 폭탄으로 4장을 먹고 피 1장, 빈 패 1장', async () => {
    const { canBomb } = await import('../src/engine/game');
    const s = last(newRound({ dealer: 0, nagariMultiplier: 1, rng: seeded(31) }));
    const rest = cardLocations(s).filter((id) => monthOf(id) !== 3 && id !== 2 && monthOf(id) !== 0);
    // 3월: 손에 8·9, 바닥에 10·11. 상대는 1월 피(2)를 가지고 있다
    s.players[0].hand = [8, 9, ...rest.slice(0, 4)];
    s.players[0].captured = [];
    s.players[1].hand = rest.slice(4, 10);
    s.players[1].captured = [2];
    s.floor = [10, 11, ...rest.slice(10, 12)];
    s.deck = [...rest.slice(12), 48, 49];
    s.ppeokOwner = {};
    checkConservation(s);
    expect(canBomb(s, 3)).toBe(true);
    expect(legalActions(s)).toContainEqual({ type: 'bomb', month: 3 });
    const t = last(step(s, { type: 'bomb', month: 3 }));
    checkConservation(t);
    const me = t.players[0];
    expect([8, 9, 10, 11].every((id) => me.captured.includes(id))).toBe(true);
    expect(me.captured).toContain(2); // 상대 피 1장
    expect(me.bombs).toBe(1);
    expect(me.dummies).toBe(1);
    expect(me.hand.length).toBe(4);
  });

  it('손 1장 + 바닥 2장은 폭탄이 아니다', async () => {
    const { canBomb } = await import('../src/engine/game');
    const s = last(newRound({ dealer: 0, nagariMultiplier: 1, rng: seeded(32) }));
    const rest = cardLocations(s).filter((id) => monthOf(id) !== 3 && monthOf(id) !== 0);
    s.players[0].hand = [8, ...rest.slice(0, 5)];
    s.floor = [10, 11, ...rest.slice(5, 7)];
    expect(canBomb(s, 3)).toBe(false);
  });
});

describe('보너스패', () => {
  const setup = (oppCaptured: number[]) => {
    const s = last(newRound({ dealer: 0, nagariMultiplier: 1, rng: seeded(21) }));
    const used = new Set([48, ...oppCaptured]);
    const rest = cardLocations(s).filter((id) => !used.has(id) && monthOf(id) !== 0);
    s.players[0].hand = [48, ...rest.slice(0, 5)];
    s.players[0].captured = [];
    s.players[1].hand = rest.slice(5, 10);
    s.players[1].captured = oppCaptured.slice();
    s.floor = rest.slice(10, 16);
    s.deck = rest.slice(16);
    s.ppeokOwner = {};
    // 1번 보너스(쓰리피)는 상대 획득 패에 없으면 더미 끝에 둔다
    if (!oppCaptured.includes(49)) s.deck.push(49);
    checkConservation(s);
    return last(step(s, { type: 'play', card: 48 }));
  };
  it('가져가면 상대의 일반 피를 먼저 빼앗는다', () => {
    const s = setup([2, 41, 49]); // 일반 피, 오동 쌍피, 보너스 쓰리피
    expect(s.players[0].captured.sort((a, b) => a - b)).toEqual([2, 48]);
    expect(s.players[1].captured.sort((a, b) => a - b)).toEqual([41, 49]);
  });
  it('쌍피·쓰리피만 있으면 그것을 가져온다', () => {
    const s = setup([41]);
    expect(s.players[0].captured.sort((a, b) => a - b)).toEqual([41, 48]);
    expect(s.players[1].captured).toEqual([]);
  });
});
