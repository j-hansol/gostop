// 플레이어용 수 추천.
// 실제 게임 상태(GameState)를 직접 받지 않고, 공개된 정보만 담은 PublicView를 받는다.
// 상대 손패와 더미는 모르는 카드를 무작위로 나눠 채운 가상 배치를 여러 개 만들어 평균을 낸다.
// 그래서 상대 패나 더미 순서를 들여다볼 방법이 구조적으로 없다.
import { card, isBonus, monthOf, TOTAL_CARDS } from './cards';
import { chooseAction, decideGoStop, decideGukjin, evaluate, potential } from './ai';
import {
  Action, canBomb, canShake, currentScore, Frame, GameEvent, GameState, gukjinOptions, legalActions, PlayerIndex, PlayerState, Rng, step, WIN_SCORE,
} from './game';
import { comboProgress, maxPiCount, score } from './scoring';

type PublicPlayer = Omit<PlayerState, 'hand'>;

/** 한 플레이어 시점에서 보이는 정보 */
export interface PublicView {
  me: PlayerIndex;
  myHand: number[];
  /** 상대 손패 장수 */
  oppHandCount: number;
  /** 상대가 흔들기로 보여 줬고 아직 손에 있는 패 */
  oppRevealed: number[];
  deckCount: number;
  floor: number[];
  players: [PublicPlayer, PublicPlayer];
  current: PlayerIndex;
  dealer: PlayerIndex;
  phase: GameState['phase'];
  ppeokOwner: GameState['ppeokOwner'];
  ctx: GameState['ctx'];
  choice: GameState['choice'];
  nagariMultiplier: number;
}

const other = (p: PlayerIndex): PlayerIndex => (p === 0 ? 1 : 0);

export function publicView(s: GameState, me: PlayerIndex): PublicView {
  const opp = other(me);
  const strip = ({ hand: _hand, ...rest }: PlayerState): PublicPlayer => structuredClone(rest);
  // 흔들어 보여 준 패 중 이미 바닥·획득 패로 나온 것은 손에 없다
  const seen = new Set([...s.floor, ...s.players[0].captured, ...s.players[1].captured]);
  return {
    me,
    myHand: [...s.players[me].hand],
    oppHandCount: s.players[opp].hand.length,
    oppRevealed: s.players[opp].revealed.filter((id) => !seen.has(id)),
    deckCount: s.deck.length,
    floor: [...s.floor],
    players: [strip(s.players[0]), strip(s.players[1])],
    current: s.current,
    dealer: s.dealer,
    phase: s.phase,
    ppeokOwner: { ...s.ppeokOwner },
    ctx: structuredClone(s.ctx),
    choice: structuredClone(s.choice),
    nagariMultiplier: s.nagariMultiplier,
  };
}

/** 내 시점에서 위치를 모르는 카드 (상대 손패 또는 더미) */
export function unknownCards(v: PublicView): number[] {
  const known = new Set([...v.myHand, ...v.floor, ...v.players[0].captured, ...v.players[1].captured, ...v.oppRevealed]);
  const out: number[] = [];
  for (let i = 0; i < TOTAL_CARDS; i++) if (!known.has(i)) out.push(i);
  return out;
}

function shuffled<T>(a: T[], rng: Rng): T[] {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

/** 모르는 카드를 상대 손패와 더미에 무작위로 나눈 가상 상태 */
function determinize(v: PublicView, rng: Rng): GameState {
  const pool = shuffled(unknownCards(v), rng);
  const oppHand = [...v.oppRevealed, ...pool.splice(0, Math.max(0, v.oppHandCount - v.oppRevealed.length))];
  const deck = pool.slice(0, v.deckCount);
  const players = v.players.map((p, i) => ({ ...structuredClone(p), hand: i === v.me ? [...v.myHand] : oppHand })) as [PlayerState, PlayerState];
  return {
    deck, floor: [...v.floor], players, current: v.current, dealer: v.dealer, phase: v.phase,
    ppeokOwner: { ...v.ppeokOwner }, ctx: structuredClone(v.ctx), choice: structuredClone(v.choice),
    nagariMultiplier: v.nagariMultiplier, result: null,
  };
}

/** 문자열로 만든 시드 난수. 같은 장면에서는 추천이 흔들리지 않게 한다 */
function seededRng(key: string): Rng {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  let x = h >>> 0;
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const last = (f: Frame[]) => f[f.length - 1].state;

// ───────────── 상대 위협과 저지 ─────────────

const SETS: [string, string, number[]][] = [
  ['godori', '고도리', [4, 12, 29]],
  ['hongdan', '홍단', [1, 5, 9]],
  ['cheongdan', '청단', [21, 33, 37]],
  ['chodan', '초단', [13, 17, 25]],
];
const GWANG = [0, 8, 28, 40, 44];

export interface Threat {
  key: string;
  /** 표시용 이름 (고도리, 3광, 피 10장 …) */
  label: string;
  /** set: 족보·3광(그 패를 먹으면 막힘), count: 장수 기준에 1장 남음, score: 총점 5~6점 */
  kind: 'set' | 'count' | 'score';
  /** 상대가 얻으면 위협이 이뤄지는, 아직 누구도 먹지 않은 패 */
  cards: number[];
  /** 그 패를 모두 내가 손에 쥐고 있어 당장은 막혀 있는지 */
  held: boolean;
}

/** 상대가 한 장 차이로 다가간 점수원: 족보 2/3, 2광(남은 광이 있을 때), 피 9장·띠 4장·열끗 4장, 총점 5~6점 */
export function threats(theirs: number[], mine: number[], myHand: number[]): Threat[] {
  const out: Threat[] = [];
  const taken = new Set([...theirs, ...mine]);
  for (const [key, label, set] of SETS) {
    const have = set.filter((id) => theirs.includes(id));
    const missing = set.filter((id) => !theirs.includes(id));
    if (have.length !== 2 || missing.some((id) => mine.includes(id))) continue;
    out.push({ key, label, kind: 'set', cards: missing, held: missing.every((id) => myHand.includes(id)) });
  }
  const d = score(theirs);
  const open = (pred: (id: number) => boolean) => Array.from({ length: TOTAL_CARDS }, (_, i) => i).filter((i) => !taken.has(i) && pred(i));
  if (d.gwangCount === 2) {
    const left = GWANG.filter((id) => !taken.has(id));
    if (left.length) out.push({ key: 'gwang', label: '3광', kind: 'set', cards: left, held: left.every((id) => myHand.includes(id)) });
  }
  const isPi = (i: number) => card(i).kind === 'pi' || !!card(i).gukjin;
  if (maxPiCount(theirs) === 9) out.push({ key: 'pi', label: '피 10장', kind: 'count', cards: open(isPi), held: false });
  if (d.ttiCount === 4) out.push({ key: 'tti', label: '띠 5장', kind: 'count', cards: open((i) => card(i).kind === 'tti'), held: false });
  if (d.yeolCount === 4) out.push({ key: 'yeol', label: '열끗 5장', kind: 'count', cards: open((i) => card(i).kind === 'yeol'), held: false });
  if (d.total >= 5 && d.total < 7) out.push({ key: 'score', label: '7점', kind: 'score', cards: [], held: false });
  return out;
}

/** 위협의 크기 (evaluate와 같은 단위). 내가 쥐고 있는 패로 막혀 있는 위협은 세지 않는다 */
function threatValue(theirs: number[], mine: number[], myHand: number[]): number {
  let v = 0;
  for (const t of threats(theirs, mine, myHand)) {
    if (t.held) continue;
    if (t.key === 'gwang') v += 2.5 * Math.min(1, t.cards.filter((id) => !myHand.includes(id)).length / 2);
    else if (t.kind === 'set') v += 1.5;
    else if (t.kind === 'count') v += 2;
    else v += 1.5 * (score(theirs).total - 4);
  }
  return v;
}

/** 상대 손패 k장 중에 그 월의 모르는 패 u장이 하나라도 있을 확률 (모르는 패 전체 U장) */
export function holdChance(u: number, U: number, k: number): number {
  if (u <= 0 || k <= 0 || U <= 0) return 0;
  let none = 1;
  for (let i = 0; i < k; i++) none *= Math.max(0, U - u - i) / (U - i);
  return 1 - none;
}

/**
 * 바닥에 남은 패의 앞으로의 가치. 상대 응수까지 본 뒤의 상태에서 계산한다.
 * - 같은 월의 남은 패가 모두 내 손에 있으면 다음 차례에 확실히 내가 먹는다 (안전한 짝)
 * - 내 손에 그 월이 없고 모르는 패가 남아 있으면 상대가 결국 가져갈 수 있다 (장기 위험)
 * - 같은 월 나머지가 모두 나왔으면 아무도 못 먹는다 (죽은 패)
 */
function floorOutlook(s: GameState, me: PlayerIndex): number {
  const opp = other(me);
  const mine = s.players[me].captured;
  const theirs = s.players[opp].captured;
  const hand = s.players[me].hand;
  const known = new Set([...hand, ...s.floor, ...mine, ...theirs]);
  const U = TOTAL_CARDS - known.size;
  const k = s.players[opp].hand.length;
  let v = 0;
  for (const m of new Set(s.floor.filter((id) => !isBonus(id)).map(monthOf))) {
    const pile = s.floor.filter((id) => monthOf(id) === m);
    let u = 0;
    for (let i = 0; i < 4; i++) if (!known.has((m - 1) * 4 + i)) u++;
    const inHand = hand.some((id) => monthOf(id) === m);
    if (inHand && u === 0) {
      v += 0.8 * (potential([...mine, ...pile], theirs) - potential(mine, theirs));
    } else if (!inHand && u > 0) {
      const lose = potential([...theirs, ...pile], mine) - potential(theirs, mine);
      v -= 0.7 * holdChance(u, U, k) * lose;
    }
  }
  return v;
}

/** 추천용 평가: 기존 평가에서 상대 위협을 더 빼고, 바닥에 남긴 패의 앞으로의 득실을 더한다 */
function evaluateAdv(s: GameState, me: PlayerIndex): number {
  const base = evaluate(s, me);
  if (s.phase === 'end') return base;
  return base - 0.9 * threatValue(s.players[other(me)].captured, s.players[me].captured, s.players[me].hand) + floorOutlook(s, me);
}

/** 바닥 2장 중 고르기. 내 득점과 상대 저지를 함께 본다 */
function myFloorChoice(s: GameState, me: PlayerIndex): number {
  const mine = s.players[me].captured;
  const theirs = s.players[other(me)].captured;
  const hand = s.players[me].hand;
  let best = s.choice!.options[0];
  let bestV = -Infinity;
  for (const c of s.choice!.options) {
    const m2 = [...mine, c];
    const v = potential(m2, theirs) - 0.9 * potential(theirs, m2) - 0.9 * threatValue(theirs, m2, hand);
    if (v > bestV) { bestV = v; best = c; }
  }
  return best;
}

/**
 * p의 차례 중 남은 결정(바닥 고르기·국진·고스톱)을 처리.
 * 나의 바닥 고르기는 상대 저지까지 보는 기준으로, 그 밖에는 AI 방식으로 한다.
 */
function resolve(s: GameState, p: PlayerIndex, events: GameEvent[], me: PlayerIndex): GameState {
  let cur = s;
  for (let guard = 0; guard < 6 && cur.phase !== 'end' && cur.current === p && cur.phase !== 'play'; guard++) {
    const act: Action = p === me && cur.phase === 'chooseFloor' ? { type: 'choose', card: myFloorChoice(cur, me) } : chooseAction(cur);
    const frames = step(cur, act);
    for (const f of frames) events.push(...f.events);
    cur = last(frames);
  }
  return cur;
}

/**
 * 상대의 응수. 상대도 더미를 모르므로 바닥과 맞춰 얻는 것만 보고 고른다.
 * (가상 배치의 더미를 보고 고르면 상대가 미래를 아는 셈이 되어 지나치게 비관적이 된다)
 */
function opponentReply(s: GameState): Action {
  const opp = s.current;
  const p = s.players[opp];
  const bonus = p.hand.find(isBonus);
  if (bonus !== undefined) return { type: 'play', card: bonus };
  if (p.hand.length === 0) return { type: 'dummy' };
  const mine = p.captured;
  const theirs = s.players[other(opp)].captured;
  const base = potential(mine, theirs);
  let best: Action = { type: 'play', card: p.hand[0] };
  let bestV = -Infinity;
  for (const c of p.hand) {
    const pile = s.floor.filter((id) => monthOf(id) === monthOf(c));
    let take: number[] = [];
    if (pile.length === 1 || pile.length === 3) take = [c, ...pile];
    else if (pile.length === 2) {
      const pick = pile.reduce((a, b) => (potential([...mine, c, a], theirs) >= potential([...mine, c, b], theirs) ? a : b));
      take = [c, pick];
    }
    const v = take.length ? potential([...mine, ...take], theirs) - base : -0.2 - potential([...theirs, c], mine) * 0.05;
    if (v > bestV) { bestV = v; best = { type: 'play', card: c, shake: canShake(s, c) }; }
  }
  return best;
}

/** 지금 결정해야 하는 단계에서 내가 고를 수 있는 행동 */
function candidateActions(s: GameState): Action[] {
  if (s.phase !== 'play') return legalActions(s);
  const p = s.players[s.current];
  const acts: Action[] = [];
  for (const c of p.hand) {
    acts.push({ type: 'play', card: c });
    if (canShake(s, c)) acts.push({ type: 'play', card: c, shake: true });
  }
  for (let m = 1; m <= 12; m++) if (canBomb(s, m)) acts.push({ type: 'bomb', month: m });
  if (p.dummies > 0) acts.push({ type: 'dummy' });
  return acts;
}

interface Stats {
  value: number;
  /** 사건별 발생 비율 */
  freq: Partial<Record<GameEvent['type'], number>>;
  /** 상대 응수 후 상대가 새로 완성한 족보 비율 */
  oppCombo: number;
  /** 내가 이번 수로 7점 이상에 닿은 비율 */
  reach: number;
  /** 상대 응수에서 상대가 7점 이상에 닿은 비율 */
  oppReach: number;
  /** 위협별로 내 차례가 끝났을 때 사라진 비율 (먹어서 막음, 피를 빼앗아 끌어내림) */
  denied: Record<string, number>;
  /** 위협은 남았지만 상대가 노릴 수 있는 패가 줄어든 비율 (남은 광 3장 중 1장을 먹음 등) */
  reduced: Record<string, number>;
}

function simulate(v: PublicView, action: Action, worlds: GameState[]): Stats {
  const me = v.me;
  const opp = other(me);
  let total = 0, oppCombo = 0, reach = 0, oppReach = 0;
  const freq: Stats['freq'] = {};
  const before = threats(v.players[opp].captured, v.players[me].captured, v.myHand).filter((t) => !t.held && t.kind !== 'score');
  const denied: Record<string, number> = {};
  const reduced: Record<string, number> = {};
  for (const w of worlds) {
    const events: GameEvent[] = [];
    const frames = step(w, action);
    for (const f of frames) events.push(...f.events);
    let s = resolve(last(frames), me, events, me);
    const after = new Map(threats(s.players[opp].captured, s.players[me].captured, s.players[me].hand).map((t) => [t.key, t]));
    for (const t of before) {
      const a = after.get(t.key);
      if (!a) denied[t.key] = (denied[t.key] ?? 0) + 1;
      else if (t.kind === 'set' && a.cards.length < t.cards.length) reduced[t.key] = (reduced[t.key] ?? 0) + 1;
    }
    if (events.some((e) => e.type === 'scoreReady' && e.player === me) || (s.result?.winner === me)) reach++;
    for (const t of new Set(events.filter((e) => 'player' in e ? e.player === me : true).map((e) => e.type))) {
      freq[t] = (freq[t] ?? 0) + 1;
    }
    // 내 차례가 끝났으면 상대의 응수 한 수까지 본다
    if (s.phase === 'play' && s.current === opp) {
      const oe: GameEvent[] = [];
      const of = step(s, opponentReply(s));
      for (const f of of) oe.push(...f.events);
      s = resolve(last(of), opp, oe, me);
      if (oe.some((e) => e.type === 'combo' && e.player === opp)) oppCombo++;
      if (oe.some((e) => e.type === 'scoreReady' && e.player === opp) || s.result?.winner === opp) oppReach++;
    }
    total += evaluateAdv(s, me);
  }
  const n = worlds.length;
  for (const k of Object.keys(freq) as (keyof typeof freq)[]) freq[k]! /= n;
  for (const k of Object.keys(denied)) denied[k] /= n;
  for (const k of Object.keys(reduced)) reduced[k] /= n;
  // 흔들기는 이겼을 때 점수가 두 배라 한 수 앞만 봐서는 차이가 없다. 조금 가산한다
  const shakeBonus = action.type === 'play' && action.shake ? 1.5 : 0;
  return { value: total / n + shakeBonus, freq, oppCombo: oppCombo / n, reach: reach / n, oppReach: oppReach / n, denied, reduced };
}

export interface Recommendation {
  action: Action;
  /** 1위부터 */
  rank: number;
  value: number;
  reason: string;
}

export interface Advice {
  phase: 'play' | 'chooseFloor';
  /** 좋은 순서대로 전부 (이유는 1위에만) */
  ranked: Recommendation[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** 낸 패(또는 고른 패)로 확실히 얻는 패. 바닥에 2장이면 추천 기준으로 고른 쪽 */
function certainTake(v: PublicView, action: Action, world: GameState): number[] {
  if (action.type === 'bomb') return [...v.myHand.filter((c) => monthOf(c) === action.month), ...v.floor.filter((c) => monthOf(c) === action.month)];
  if (action.type === 'choose') {
    const own = v.choice?.target === 'flipped' ? v.ctx?.flipped : v.ctx?.played;
    return own != null ? [own, action.card] : [action.card];
  }
  if (action.type !== 'play') return [];
  const pile = v.floor.filter((id) => monthOf(id) === monthOf(action.card));
  if (pile.length === 1 || pile.length === 3) return [action.card, ...pile];
  if (pile.length === 2) {
    const t = structuredClone(world);
    t.choice = { options: pile, target: 'played' };
    return [action.card, myFloorChoice(t, v.me)];
  }
  return [];
}

function describe(v: PublicView, action: Action, st: Stats, others: Stats[], world: GameState): string {
  const me = v.me;
  const mine = v.players[me].captured;
  const theirs = v.players[other(me)].captured;
  const parts: string[] = [];

  if (action.type === 'play' && isBonus(action.card)) return `보너스패: ${bonusTiming(v, action.card).reason}`;
  if (action.type === 'bomb') parts.push('폭탄으로 4장 획득 · 점수 ×2');
  if (action.type === 'play' && action.shake) parts.push('흔들기 (이기면 ×2)');

  // 상대를 막는 효과를 먼저 적는다
  const now = threats(theirs, mine, v.myHand);
  const byKey = Object.fromEntries(now.map((t) => [t.key, t]));
  const blocks = Object.entries(st.denied).filter(([, r]) => r >= 0.3).sort((a, b) => b[1] - a[1]);
  for (const [key, r] of blocks.slice(0, 2)) {
    const t = byKey[key];
    if (t) parts.push(`상대 ${t.label} ${t.kind === 'set' ? '차단' : '저지'}${r < 0.99 ? ` ${pct(r)}` : ''}`);
  }
  for (const [key, r] of Object.entries(st.reduced)) {
    const t = byKey[key];
    if (!t || r < 0.5 || blocks.some(([k]) => k === key) || parts.length >= 2) continue;
    parts.push(`상대 ${t.label} 견제 (남은 패 ${t.cards.length}→${t.cards.length - 1}장)`);
  }
  const avg = (f: (s: Stats) => number) => (others.length ? others.reduce((a, s) => a + f(s), 0) / others.length : 0);
  const oppReachAvg = avg((s) => s.oppReach);
  if (others.length && oppReachAvg - st.oppReach >= 0.1) parts.push(`상대 7점 기회 ${pct(oppReachAvg)}→${pct(st.oppReach)}`);

  const take = certainTake(v, action, world);
  if (take.length) {
    const before = comboProgress(mine, theirs).filter((c) => c.state === 'done').map((c) => c.key);
    const done = comboProgress([...mine, ...take], theirs).filter((c) => c.state === 'done' && !before.includes(c.key));
    for (const c of done) parts.unshift(`${c.label} 완성`);
    if (!done.length && parts.length < 2) {
      // 낸 패도 함께 먹으므로 낸 패까지 포함해 요약한다
      const kinds = take.map((id) => card(id));
      const got: string[] = [];
      if (kinds.some((c) => c.kind === 'gwang')) got.push('광');
      if (kinds.some((c) => c.godori)) got.push('고도리 새');
      else if (kinds.some((c) => c.kind === 'yeol')) got.push('열끗');
      if (kinds.some((c) => c.kind === 'tti' && c.ribbon !== 'bi')) got.push(`${{ hong: '홍단', cheong: '청단', cho: '초단' }[kinds.find((c) => c.kind === 'tti' && c.ribbon !== 'bi')!.ribbon as 'hong']} 띠`);
      else if (kinds.some((c) => c.kind === 'tti')) got.push('띠');
      const pi = kinds.reduce((a, c) => a + (c.kind === 'pi' ? c.piValue : 0), 0);
      if (pi) got.push(`피 ${pi}장`);
      if (got.length) parts.push(`${got.join('·')} 획득`);
    }
  }
  if (st.reach >= 0.25) parts.push(`7점 도달 가능성 ${pct(st.reach)}`);
  for (const [t, label] of [['jjok', '쪽'], ['ttadak', '따닥'], ['ppeokTake', '뻑 먹기'], ['sseul', '쓸']] as const) {
    if ((st.freq[t] ?? 0) >= 0.2 && parts.length < 3) parts.push(`${label} 기회 ${pct(st.freq[t]!)}`);
  }
  const combo = st.freq.combo ?? 0;
  if (combo >= 0.2 && !parts.some((p) => p.endsWith('완성'))) parts.push(`족보 완성 가능성 ${pct(combo)}`);
  if (!parts.some((p) => p.startsWith('상대 ')) && others.length && avg((s) => s.oppCombo) - st.oppCombo >= 0.15) parts.push('상대 족보 기회를 줄임');
  // 상대에게 필요한 패를 쥐고 있으면 그 패를 버리지 않는 것도 막는 수다
  const held = now.filter((t) => t.held && t.kind === 'set');
  if (!take.length && action.type === 'play' && held.length && !held.some((t) => t.cards.includes(action.card))) {
    parts.push(`상대 ${held[0].label}에 필요한 패는 손에 남김`);
  }
  // 짝 없이 내려놓는 패: 안전한 짝·죽은 패인지, 값진 패를 내주는 위험이 있는지
  if (!take.length && action.type === 'play' && !isBonus(action.card)) {
    const m = monthOf(action.card);
    const known = new Set([...v.myHand, ...v.floor, ...mine, ...theirs, ...v.oppRevealed]);
    let u = 0;
    for (let i = 0; i < 4; i++) if (!known.has((m - 1) * 4 + i)) u++;
    const shown = v.oppRevealed.some((id) => monthOf(id) === m);
    const rest = v.myHand.filter((id) => id !== action.card && monthOf(id) === m).length;
    if (u === 0 && !shown && rest > 0) parts.unshift('안전한 패: 같은 월 나머지가 모두 나와 있어 다음 차례에 확실히 먹음');
    else if (u === 0 && !shown) parts.unshift('아무도 먹을 수 없는 패라 버려도 위험 없음');
    else {
      const c = card(action.card);
      const needed = now.some((t) => t.kind === 'set' && t.cards.includes(action.card));
      if (c.kind === 'gwang' || c.piValue >= 2 || c.gukjin || needed) {
        const risk = shown ? 1 : holdChance(u, unknownCards(v).length, v.oppHandCount);
        parts.push(`${needed ? '상대에게 필요한 패' : c.name} 내줄 위험 ${pct(risk)}`);
      }
    }
  }
  if (!take.length && action.type === 'play' && !action.shake && parts.length === 0) {
    parts.push((st.freq.ppeok ?? 0) < avg((s) => s.freq.ppeok ?? 0) ? '맞는 패가 없을 때 가장 안전하게 버리는 패' : '버려도 손해가 가장 적은 패');
  }
  if ((st.freq.ppeok ?? 0) >= 0.3) parts.push(`뻑 위험 ${pct(st.freq.ppeok!)}`);
  return parts.slice(0, 3).join(' · ') || '기대 점수가 가장 높은 수';
}

/**
 * 보너스패를 지금 낼지, 아껴 둘지.
 * 보너스패는 가져갈 때 상대 피 1장을 빼앗으므로, 상대에게 빼앗을 피가 없을 때 내면 그 기회를 버리는 셈이다.
 * 다만 판이 곧 끝날 수 있으면(상대 4점 이상, 내 손패·더미가 적음) 손에 남은 채 끝나지 않게 지금 챙긴다.
 * delta는 "가장 좋은 다른 수" 대비 점수 차 (양수면 보너스패를 먼저 낸다)
 */
export function bonusTiming(v: PublicView, bonusCard: number): { now: boolean; delta: number; reason: string } {
  const me = v.me;
  const opp = other(me);
  const mine = v.players[me].captured;
  const theirs = v.players[opp].captured;
  const stealable = theirs.some((id) => card(id).kind === 'pi' || (card(id).gukjin && v.players[opp].gukjinPi));
  const myScore = score(mine, v.players[me].gukjinPi).total;
  if (myScore < WIN_SCORE && score([...mine, bonusCard], v.players[me].gukjinPi).total >= WIN_SCORE) {
    return { now: true, delta: 50, reason: '보너스패로 7점에 닿습니다' };
  }
  if (stealable) return { now: true, delta: 0.5, reason: '상대 피 1장을 빼앗고 한 장을 더 받습니다' };
  const oppScore = score(theirs, v.players[opp].gukjinPi).total;
  if (oppScore >= 4) return { now: true, delta: 0.3, reason: `상대가 ${oppScore}점이라 판이 끝나기 전에 피를 챙깁니다` };
  if (v.myHand.length <= 2 || v.deckCount < 8) return { now: true, delta: 0.3, reason: '판이 얼마 남지 않아 지금 챙깁니다' };
  return { now: false, delta: -1.2, reason: '상대에게 아직 빼앗을 피가 없어, 피를 먹은 뒤에 내야 피 1장을 빼앗습니다' };
}

/** 지금 장면에서 둘 수의 추천. 내 차례(낼 패·바닥 고르기)가 아니면 null */
export function recommend(v: PublicView, samples = 32): Advice | null {
  if (v.current !== v.me || (v.phase !== 'play' && v.phase !== 'chooseFloor')) return null;
  const rng = seededRng(JSON.stringify([v.myHand, v.floor, v.players[0].captured, v.players[1].captured, v.deckCount, v.phase, v.choice]));
  // 모든 후보가 같은 가상 배치를 쓰게 해서 비교가 공정하도록 한다
  const unknown = unknownCards(v).length;
  const worlds = Array.from({ length: unknown > 0 ? samples : 1 }, () => determinize(v, rng));
  const acts = candidateActions(worlds[0]);
  const isBonusPlay = (a: Action) => a.type === 'play' && isBonus(a.card);
  const stats = acts.map((a) => simulate(v, a, worlds));
  // 보너스패는 내도 차례가 이어지므로, 다른 수와 같은 선에서 비교하지 않고 "지금 낼지, 아껴 둘지"만 따진다
  const normal = stats.filter((_, i) => !isBonusPlay(acts[i]));
  if (normal.length) {
    const bestNormal = Math.max(...normal.map((s) => s.value));
    acts.forEach((a, i) => {
      if (isBonusPlay(a)) stats[i].value = bestNormal + bonusTiming(v, (a as { card: number }).card).delta;
    });
  }
  const order = acts.map((_, i) => i).sort((a, b) => stats[b].value - stats[a].value);
  const ranked = order.map((i, r) => ({
    action: acts[i],
    rank: r + 1,
    value: stats[i].value,
    reason: r === 0 ? describe(v, acts[i], stats[i], order.slice(1).map((j) => stats[j]), worlds[0]) : '',
  }));
  // 보너스패를 아껴 두는 추천이면 그 이유를 덧붙인다
  const kept = v.myHand.find((id) => isBonus(id) && !bonusTiming(v, id).now);
  if (kept !== undefined && ranked[0] && !isBonusPlay(ranked[0].action)) {
    ranked[0].reason += ' · 보너스패는 상대가 피를 먹은 뒤에 내려고 아껴 둠';
  }
  return { phase: v.phase, ranked };
}

export interface GoStopAdvice {
  go: boolean;
  reason: string;
}

/** 고/스톱 조언. 상대 AI와 같은 기준을 쓰고 이유를 붙인다 */
export function adviseGoStop(v: PublicView): GoStopAdvice {
  const s = determinize(v, seededRng('gostop'));
  const me = v.me;
  const p = v.players[me];
  const opp = currentScore(s, other(me));
  const mine = currentScore(s, me);
  const go = decideGoStop(s);
  let reason: string;
  if (v.deckCount <= 4) reason = '남은 더미가 적어 더 먹기 어렵습니다';
  else if (opp >= 5) reason = `상대가 ${opp}점이라 고박 위험이 큽니다`;
  else if (p.goCount >= 2 && opp >= 3) reason = `이미 ${p.goCount}고이고 상대가 ${opp}점입니다`;
  else if (mine >= 15) reason = '점수가 충분히 높습니다';
  else if (p.goCount >= 3) reason = '고를 충분히 불렀습니다';
  else reason = `상대가 ${opp}점이라 더 노려볼 만합니다`;
  return { go, reason };
}

/** 국진(9월 술잔) 쌍피 전환 조언 */
export function adviseGukjin(v: PublicView): { toPi: boolean; reason: string } {
  const s = determinize(v, seededRng('gukjin'));
  const toPi = decideGukjin(s);
  const o = gukjinOptions(s, v.me);
  const reason = o.pi !== o.yeol
    ? `${toPi ? '쌍피' : '열끗'}로 두면 ${Math.max(o.pi, o.yeol)}점으로 더 높습니다`
    : toPi ? '점수는 같지만 정산 금액이 더 큽니다' : '점수와 정산 금액이 같거나 열끗이 유리합니다';
  return { toPi, reason };
}

/** 표시용: 행동 이름 */
export function actionLabel(a: Action): string {
  if (a.type === 'play') return `${card(a.card).name}${card(a.card).month ? `(${card(a.card).month}월)` : ''}${a.shake ? ' 흔들기' : ''}`;
  if (a.type === 'bomb') return `${a.month}월 폭탄`;
  if (a.type === 'dummy') return '빈 패';
  if (a.type === 'choose') return card(a.card).name;
  return '';
}
