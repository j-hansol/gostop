import { card, isBonus, monthOf, TOTAL_CARDS } from './cards';
import { Combo, maxPiCount, score, ScoreDetail } from './scoring';

export const WIN_SCORE = 7;
export const SPECIAL_WIN_SCORE = 10;
export const PIBAK_LIMIT = 7;
export const MEONGBAK_YEOL = 7;

export type PlayerIndex = 0 | 1;

export interface PlayerState {
  hand: number[];
  /** 폭탄 후 받은 빈 패 개수 */
  dummies: number;
  captured: number[];
  goCount: number;
  lastGoScore: number;
  shakes: number;
  /** 흔들기로 상대에게 보여 준 패 (공개 정보) */
  revealed: number[];
  bombs: number;
  ppeokStreak: number;
  turnsTaken: number;
  /** 국진(9월 술잔)을 쌍피로 전환했는지. 기본은 열끗 */
  gukjinPi: boolean;
  /** 이번 턴에 국진 전환을 이미 물어봤는지 (거절 시 같은 턴에 다시 묻지 않음) */
  gukjinAskedTurn: number;
}

export type Phase = 'play' | 'chooseFloor' | 'gukjin' | 'goStop' | 'end';

export interface TurnCtx {
  played: number | null;
  playedMonth: number;
  mode: 'none' | 'place' | 'pair' | 'two' | 'three' | 'bomb';
  playedCaptures: number[];
  flipped: number | null;
  flipCaptures: number[];
  steal: number;
  ppeok: boolean;
  combosBefore: Combo[];
}

export interface Multiplier {
  label: string;
  factor: number;
}

export interface RoundResult {
  winner: PlayerIndex | null;
  special?: 'chongtong' | 'samppeok';
  detail?: ScoreDetail;
  base: number;
  goBonusText?: string;
  afterGo: number;
  multipliers: Multiplier[];
  /** 승자가 미션을 완료해 최종 점수에 반영했는지 */
  missionDone?: boolean;
  /** 미션 반영 전 점수 */
  beforeMission?: number;
  final: number;
}

/** 획득 미션: cards를 모두 가진 채 이기면 최종 점수에 op와 value를 적용한다 */
export interface Mission {
  cards: number[];
  op: 'add' | 'mul';
  value: number;
}

export interface GameState {
  deck: number[];
  floor: number[];
  players: [PlayerState, PlayerState];
  current: PlayerIndex;
  dealer: PlayerIndex;
  phase: Phase;
  /** 뻑을 싼 플레이어 (월 → 플레이어) */
  ppeokOwner: Record<number, PlayerIndex>;
  /** 진행 중인 턴 (바닥 패 선택으로 중단된 경우 이어서 처리) */
  ctx: TurnCtx | null;
  choice: { options: number[]; target: 'played' | 'flipped' } | null;
  nagariMultiplier: number;
  /** 이번 판의 획득 미션 (공개 정보). 없으면 null */
  mission: Mission | null;
  result: RoundResult | null;
}

export type GameEvent =
  | { type: 'deal' }
  | { type: 'play'; player: PlayerIndex; cards: number[] }
  | { type: 'flip'; player: PlayerIndex; card: number }
  | { type: 'capture'; player: PlayerIndex; cards: number[] }
  | { type: 'bonus'; player: PlayerIndex; card: number }
  | { type: 'draw'; player: PlayerIndex }
  | { type: 'shake'; player: PlayerIndex; cards: number[] }
  | { type: 'bomb'; player: PlayerIndex }
  | { type: 'jjok'; player: PlayerIndex }
  | { type: 'ttadak'; player: PlayerIndex }
  | { type: 'ppeok'; player: PlayerIndex; first: boolean; streak: number }
  | { type: 'ppeokTake'; player: PlayerIndex; self: boolean }
  | { type: 'sseul'; player: PlayerIndex }
  | { type: 'steal'; player: PlayerIndex; cards: number[] }
  | { type: 'combo'; player: PlayerIndex; combo: Combo }
  | { type: 'scoreReady'; player: PlayerIndex; score: number }
  | { type: 'gukjin'; player: PlayerIndex; toPi: boolean }
  | { type: 'go'; player: PlayerIndex; count: number }
  | { type: 'stop'; player: PlayerIndex; auto: boolean }
  | { type: 'chongtong'; player: PlayerIndex; month: number }
  | { type: 'samppeok'; player: PlayerIndex }
  | { type: 'nagari' }
  | { type: 'end' };

export interface Frame {
  state: GameState;
  events: GameEvent[];
}

export type Action =
  | { type: 'play'; card: number; shake?: boolean }
  | { type: 'bomb'; month: number }
  | { type: 'dummy' }
  | { type: 'choose'; card: number }
  | { type: 'gukjin'; toPi: boolean }
  | { type: 'goStop'; go: boolean };

export type Rng = () => number;

const clone = <T>(v: T): T => structuredClone(v);

function newPlayer(): PlayerState {
  return { hand: [], dummies: 0, captured: [], goCount: 0, lastGoScore: 0, shakes: 0, revealed: [], bombs: 0, ppeokStreak: 0, turnsTaken: 0, gukjinPi: false, gukjinAskedTurn: -1 };
}

export function shuffle(ids: number[], rng: Rng): number[] {
  const a = ids.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const other = (p: PlayerIndex): PlayerIndex => (p === 0 ? 1 : 0);
const sameMonth = (ids: number[], m: number) => ids.filter((id) => monthOf(id) === m);
const remove = (arr: number[], ids: number[]) => {
  for (const id of ids) {
    const i = arr.indexOf(id);
    if (i >= 0) arr.splice(i, 1);
  }
};
const hasCards = (p: PlayerState) => p.hand.length > 0 || p.dummies > 0;

class Recorder {
  frames: Frame[] = [];
  constructor(public s: GameState) {}
  emit(...events: GameEvent[]) {
    this.frames.push({ state: clone(this.s), events });
  }
}

export interface NewRoundOptions {
  dealer: PlayerIndex;
  nagariMultiplier: number;
  rng?: Rng;
  /** 미션을 직접 지정한다 (테스트용). 생략하면 무작위로 정한다 */
  mission?: Mission | null;
}

export const MISSION_CHANCE = 0.7;

/** 판마다 70% 확률로 미션을 만든다. 보너스패를 뺀 패 2~3장, 더하기 1~5 또는 곱하기 2~5 */
export function drawMission(rng: Rng): Mission | null {
  if (rng() >= MISSION_CHANCE) return null;
  const pool = Array.from({ length: TOTAL_CARDS }, (_, i) => i).filter((id) => !isBonus(id));
  const count = rng() < 0.5 ? 2 : 3;
  // 같은 쌍의 피는 한 장으로 치므로 한 미션에 함께 넣지 않는다
  const cards: number[] = [];
  for (const id of shuffle(pool, rng)) {
    if (cards.length < count && !cards.some((c) => missionGroup(c).includes(id))) cards.push(id);
  }
  return rng() < 0.5
    ? { cards, op: 'add', value: 1 + Math.floor(rng() * 5) }
    : { cards, op: 'mul', value: 2 + Math.floor(rng() * 4) };
}

export const missionLabel = (m: Mission): string => `${m.op === 'add' ? '+' : 'x'} ${m.value}`;
/** 미션에서 같은 패로 치는 패들. 1~11월의 일반 피는 그림이 비슷한 2장이 한 쌍이다 */
export function missionGroup(id: number): number[] {
  const isPlainPi = (c: number) => card(c).kind === 'pi' && card(c).piValue === 1;
  if (!isPlainPi(id)) return [id];
  return Array.from({ length: TOTAL_CARDS }, (_, i) => i).filter((c) => isPlainPi(c) && monthOf(c) === monthOf(id));
}
export const missionHeld = (id: number, captured: number[]): boolean => missionGroup(id).some((c) => captured.includes(c));
export const missionDone = (m: Mission, captured: number[]): boolean => m.cards.every((id) => missionHeld(id, captured));
/** 쌍을 포함해 미션 패가 한 장도 남지 않게 captured가 가져갔는지 */
export const missionBlocked = (m: Mission, captured: number[]): boolean => m.cards.some((id) => missionGroup(id).every((c) => captured.includes(c)));
/** 쌍까지 펼친 미션 패 전체 */
export const missionCards = (m: Mission): number[] => m.cards.flatMap(missionGroup);

export function newRound(opts: NewRoundOptions): Frame[] {
  const rng = opts.rng ?? Math.random;
  const all = Array.from({ length: TOTAL_CARDS }, (_, i) => i);
  let deck: number[];
  let hands: [number[], number[]];
  let floor: number[];
  for (;;) {
    deck = shuffle(all, rng);
    hands = [deck.splice(0, 10), deck.splice(0, 10)];
    floor = deck.splice(0, 8);
    const counts = new Map<number, number>();
    for (const id of floor) if (!isBonus(id)) counts.set(monthOf(id), (counts.get(monthOf(id)) ?? 0) + 1);
    if (![...counts.values()].some((n) => n === 4)) break;
  }
  const players: [PlayerState, PlayerState] = [newPlayer(), newPlayer()];
  const s: GameState = {
    deck: all.slice(),
    floor: [],
    players,
    current: opts.dealer,
    dealer: opts.dealer,
    phase: 'play',
    ppeokOwner: {},
    ctx: null,
    choice: null,
    nagariMultiplier: opts.nagariMultiplier,
    mission: opts.mission !== undefined ? opts.mission : drawMission(rng),
    result: null,
  };
  const rec = new Recorder(s);
  rec.emit();
  s.deck = deck;
  s.floor = floor;
  players[0].hand = hands[0];
  players[1].hand = hands[1];
  rec.emit({ type: 'deal' });

  // 바닥에 깔린 보너스패는 선이 가져가고 더미에서 보충한다
  let bonus = s.floor.find(isBonus);
  while (bonus !== undefined) {
    remove(s.floor, [bonus]);
    const refill = s.deck.shift();
    if (refill !== undefined) s.floor.push(refill);
    takeBonus(rec, s.dealer, bonus);
    bonus = s.floor.find(isBonus);
  }

  // 총통
  for (const p of [s.dealer, other(s.dealer)]) {
    for (let m = 1; m <= 12; m++) {
      if (sameMonth(players[p].hand, m).length === 4) {
        endSpecial(s, p, 'chongtong');
        rec.emit({ type: 'chongtong', player: p, month: m }, { type: 'end' });
        return rec.frames;
      }
    }
  }
  return rec.frames;
}

/** 현재 상태에서 가능한 행동 목록 (AI·검증용) */
export function legalActions(s: GameState): Action[] {
  const p = s.players[s.current];
  if (s.phase === 'chooseFloor' && s.choice) return s.choice.options.map((c) => ({ type: 'choose', card: c }));
  if (s.phase === 'gukjin') return [{ type: 'gukjin', toPi: true }, { type: 'gukjin', toPi: false }];
  if (s.phase === 'goStop') return [{ type: 'goStop', go: true }, { type: 'goStop', go: false }];
  if (s.phase !== 'play') return [];
  const acts: Action[] = [];
  for (const c of p.hand) {
    acts.push({ type: 'play', card: c, shake: canShake(s, c) });
  }
  for (let m = 1; m <= 12; m++) if (canBomb(s, m)) acts.push({ type: 'bomb', month: m });
  if (p.dummies > 0) acts.push({ type: 'dummy' });
  return acts;
}

export function canShake(s: GameState, c: number): boolean {
  if (isBonus(c)) return false;
  const m = monthOf(c);
  const p = s.players[s.current];
  return sameMonth(p.hand, m).length === 3 && sameMonth(s.floor, m).length === 0;
}

/** 폭탄: 손에 같은 월 3장 + 바닥 1장, 또는 손에 2장 + 바닥 2장 */
export function canBomb(s: GameState, m: number): boolean {
  const p = s.players[s.current];
  const hand = sameMonth(p.hand, m).length;
  const floor = sameMonth(s.floor, m).length;
  return (hand === 3 && floor === 1) || (hand === 2 && floor === 2);
}

/** 두 장 중 고를 때 실제로 차이가 있는지 */
function needsChoice(a: number, b: number): boolean {
  const ca = card(a), cb = card(b);
  return ca.kind !== cb.kind || ca.piValue !== cb.piValue || ca.ribbon !== cb.ribbon;
}

export const GUKJIN = 32;

export function playerScore(p: PlayerState, gukjinPi = p.gukjinPi): ScoreDetail {
  return score(p.captured, gukjinPi);
}

export function currentScore(s: GameState, p: PlayerIndex): number {
  return playerScore(s.players[p]).total;
}

/** 국진 전환 여부를 물어볼 때 보여줄 두 점수 */
export function gukjinOptions(s: GameState, p: PlayerIndex): { yeol: number; pi: number } {
  const pl = s.players[p];
  return { yeol: playerScore(pl, false).total, pi: playerScore(pl, true).total };
}

export function step(prev: GameState, action: Action): Frame[] {
  const s = clone(prev);
  const rec = new Recorder(s);
  switch (action.type) {
    case 'play':
    case 'bomb':
    case 'dummy':
      if (s.phase !== 'play') throw new Error('지금은 패를 낼 수 없습니다');
      doPlay(rec, action);
      break;
    case 'choose':
      if (s.phase !== 'chooseFloor' || !s.choice || !s.choice.options.includes(action.card)) throw new Error('잘못된 선택');
      doChoose(rec, action.card);
      break;
    case 'gukjin':
      if (s.phase !== 'gukjin') throw new Error('국진 전환 단계가 아닙니다');
      doGukjin(rec, action.toPi);
      break;
    case 'goStop':
      if (s.phase !== 'goStop') throw new Error('고/스톱 단계가 아닙니다');
      doGoStop(rec, action.go);
      break;
  }
  return rec.frames;
}

function doPlay(rec: Recorder, action: Action) {
  const s = rec.s;
  const me = s.current;
  const p = s.players[me];
  const ctx: TurnCtx = {
    played: null, playedMonth: 0, mode: 'none', playedCaptures: [], flipped: null, flipCaptures: [],
    steal: 0, ppeok: false, combosBefore: playerScore(p).combos,
  };
  s.ctx = ctx;

  if (action.type === 'dummy') {
    if (p.dummies <= 0) throw new Error('빈 패가 없습니다');
    p.dummies--;
    rec.emit({ type: 'play', player: me, cards: [] });
  } else if (action.type === 'bomb') {
    const m = action.month;
    if (!canBomb(s, m)) throw new Error('폭탄 조건이 아닙니다');
    const mine = sameMonth(p.hand, m);
    const target = sameMonth(s.floor, m);
    remove(p.hand, mine);
    s.floor.push(...mine);
    p.bombs++;
    // 한 번에 낸 장수만큼 손패가 줄었으므로 빈 패를 (낸 장수 - 1)장 받는다
    p.dummies += mine.length - 1;
    ctx.mode = 'bomb';
    ctx.playedMonth = m;
    ctx.playedCaptures = [...mine, ...target];
    ctx.steal += 1;
    rec.emit({ type: 'play', player: me, cards: mine }, { type: 'bomb', player: me });
  } else if (action.type === 'play') {
    const c = action.card;
    if (!p.hand.includes(c)) throw new Error('손에 없는 패');
    if (isBonus(c)) {
      remove(p.hand, [c]);
      takeBonus(rec, me, c);
      const d = s.deck.shift();
      if (d !== undefined) {
        p.hand.push(d);
        rec.emit({ type: 'draw', player: me });
      }
      s.ctx = null;
      // 보너스패를 낸 뒤 바로 이어서 한 장을 더 낸다
      if (!hasCards(p)) finishTurn(rec);
      return;
    }
    const m = monthOf(c);
    const events: GameEvent[] = [];
    if (action.shake && canShake(s, c)) {
      p.shakes++;
      p.revealed.push(...sameMonth(p.hand, m));
      events.push({ type: 'shake', player: me, cards: sameMonth(p.hand, m) });
    }
    const matches = sameMonth(s.floor, m);
    remove(p.hand, [c]);
    s.floor.push(c);
    ctx.played = c;
    ctx.playedMonth = m;
    rec.emit(...events, { type: 'play', player: me, cards: [c] });
    if (matches.length === 0) {
      ctx.mode = 'place';
    } else if (matches.length === 1) {
      ctx.mode = 'pair';
      ctx.playedCaptures = [c, matches[0]];
    } else if (matches.length === 2) {
      ctx.mode = 'two';
      if (needsChoice(matches[0], matches[1])) {
        s.phase = 'chooseFloor';
        s.choice = { options: matches, target: 'played' };
        rec.emit();
        return;
      }
      ctx.playedCaptures = [c, matches[0]];
    } else {
      ctx.mode = 'three';
      ctx.playedCaptures = [c, ...matches];
      takePpeok(rec, m);
    }
  }
  doFlip(rec);
}

/**
 * 바닥의 같은 월 3장을 4번째 패로 먹을 때. 뻑이든 처음 배분 때 깔린 3장이든 뻑 먹기와 같이
 * 상대 피 1장을 받고, 자기가 싼 뻑(자뻑)이면 2장을 받는다.
 */
function takePpeok(rec: Recorder, m: number) {
  const s = rec.s;
  const owner = s.ppeokOwner[m];
  const self = owner === s.current;
  s.ctx!.steal += self ? 2 : 1;
  delete s.ppeokOwner[m];
  rec.emit({ type: 'ppeokTake', player: s.current, self });
}

function doChoose(rec: Recorder, chosen: number) {
  const s = rec.s;
  const ctx = s.ctx!;
  const target = s.choice!.target;
  s.phase = 'play';
  s.choice = null;
  if (target === 'played') {
    ctx.playedCaptures = [ctx.played!, chosen];
    doFlip(rec);
  } else {
    ctx.flipCaptures = [ctx.flipped!, chosen];
    finishCaptures(rec);
  }
}

function doFlip(rec: Recorder) {
  const s = rec.s;
  const me = s.current;
  const p = s.players[me];
  const ctx = s.ctx!;
  let f: number | undefined;
  for (;;) {
    f = s.deck.shift();
    if (f === undefined) break;
    if (!isBonus(f)) break;
    takeBonus(rec, me, f, { type: 'flip', player: me, card: f });
  }
  if (f === undefined) {
    finishCaptures(rec);
    return;
  }
  ctx.flipped = f;
  s.floor.push(f);
  rec.emit({ type: 'flip', player: me, card: f });
  const fm = monthOf(f);
  if (fm === ctx.playedMonth && (ctx.mode === 'place' || ctx.mode === 'pair' || ctx.mode === 'two')) {
    if (ctx.mode === 'place') {
      ctx.playedCaptures = [ctx.played!, f];
      ctx.steal += 1;
      rec.emit({ type: 'jjok', player: me });
    } else if (ctx.mode === 'pair') {
      ctx.playedCaptures = [];
      ctx.ppeok = true;
      s.ppeokOwner[fm] = me;
      p.ppeokStreak++;
      rec.emit({ type: 'ppeok', player: me, first: p.turnsTaken === 0, streak: p.ppeokStreak });
    } else {
      ctx.playedCaptures = sameMonth(s.floor, fm);
      ctx.steal += 1;
      rec.emit({ type: 'ttadak', player: me });
    }
    finishCaptures(rec);
    return;
  }
  const matches = sameMonth(s.floor, fm).filter((id) => id !== f && !ctx.playedCaptures.includes(id));
  if (matches.length === 1) {
    ctx.flipCaptures = [f, matches[0]];
  } else if (matches.length === 2) {
    if (needsChoice(matches[0], matches[1])) {
      s.phase = 'chooseFloor';
      s.choice = { options: matches, target: 'flipped' };
      rec.emit();
      return;
    }
    ctx.flipCaptures = [f, matches[0]];
  } else if (matches.length === 3) {
    ctx.flipCaptures = [f, ...matches];
    takePpeok(rec, fm);
  }
  finishCaptures(rec);
}

/** 보너스패를 가져가면 상대 피를 한 장 빼앗는다 (일반 피 우선, 없으면 쌍피·쓰리피) */
function takeBonus(rec: Recorder, to: PlayerIndex, c: number, ...before: GameEvent[]) {
  const s = rec.s;
  s.players[to].captured.push(c);
  rec.emit(...before, { type: 'bonus', player: to, card: c });
  const taken = stealPi(s, to, 1);
  if (taken.length) rec.emit({ type: 'steal', player: to, cards: taken });
}

function stealPi(s: GameState, to: PlayerIndex, n: number): number[] {
  const from = s.players[other(to)];
  const taken: number[] = [];
  const rank = (id: number) => {
    const c = card(id);
    if (c.gukjin) return from.gukjinPi ? 2 : -1;
    if (c.kind !== 'pi') return -1;
    if (c.bonus) return c.piValue === 3 ? 4 : 3;
    return c.piValue === 2 ? 2 : 1;
  };
  for (let i = 0; i < n; i++) {
    const cands = from.captured.filter((id) => rank(id) > 0).sort((a, b) => rank(a) - rank(b));
    if (cands.length === 0) break;
    remove(from.captured, [cands[0]]);
    s.players[to].captured.push(cands[0]);
    // 쌍피로 쓰이던 국진을 빼앗으면 받은 쪽에서도 쌍피
    if (card(cands[0]).gukjin) { from.gukjinPi = false; s.players[to].gukjinPi = true; }
    taken.push(cands[0]);
  }
  return taken;
}

function finishCaptures(rec: Recorder) {
  const s = rec.s;
  const me = s.current;
  const p = s.players[me];
  const ctx = s.ctx!;
  const caps = [...ctx.playedCaptures, ...ctx.flipCaptures];
  if (caps.length) {
    remove(s.floor, caps);
    p.captured.push(...caps);
    rec.emit({ type: 'capture', player: me, cards: caps });
  }
  if (!ctx.ppeok) p.ppeokStreak = 0;
  p.turnsTaken++;

  if (p.ppeokStreak >= 3) {
    endSpecial(s, me, 'samppeok');
    rec.emit({ type: 'samppeok', player: me }, { type: 'end' });
    return;
  }

  const lastTurn = !hasCards(s.players[0]) && !hasCards(s.players[1]);
  if (s.floor.length === 0 && !lastTurn) {
    ctx.steal += 1;
    rec.emit({ type: 'sseul', player: me });
  }
  if (ctx.steal > 0) {
    const taken = stealPi(s, me, ctx.steal);
    if (taken.length) rec.emit({ type: 'steal', player: me, cards: taken });
  }
  const after = playerScore(p);
  const newCombos = after.combos.filter((c) => !ctx.combosBefore.includes(c));
  if (newCombos.length) rec.emit(...newCombos.map((combo) => ({ type: 'combo' as const, player: me, combo })));
  s.ctx = null;
  checkScore(rec);
}

function checkScore(rec: Recorder) {
  const s = rec.s;
  const me = s.current;
  const p = s.players[me];
  // 국진을 열끗으로 두거나 쌍피로 바꿔 7점에 닿으면 전환 여부를 먼저 묻는다
  if (p.captured.includes(GUKJIN) && !p.gukjinPi && p.gukjinAskedTurn !== p.turnsTaken) {
    const o = gukjinOptions(s, me);
    if (Math.max(o.yeol, o.pi) >= WIN_SCORE && Math.max(o.yeol, o.pi) > p.lastGoScore) {
      p.gukjinAskedTurn = p.turnsTaken;
      s.phase = 'gukjin';
      rec.emit();
      return;
    }
  }
  const sc = currentScore(s, me);
  if (sc >= WIN_SCORE && sc > p.lastGoScore) {
    if (s.deck.length === 0 || !hasCards(p)) {
      endWin(s, me);
      rec.emit({ type: 'stop', player: me, auto: true }, { type: 'end' });
      return;
    }
    s.phase = 'goStop';
    rec.emit({ type: 'scoreReady', player: me, score: sc });
    return;
  }
  finishTurn(rec);
}

function doGukjin(rec: Recorder, toPi: boolean) {
  const s = rec.s;
  const me = s.current;
  s.players[me].gukjinPi = toPi;
  s.phase = 'play';
  rec.emit({ type: 'gukjin', player: me, toPi });
  checkScore(rec);
}

function doGoStop(rec: Recorder, go: boolean) {
  const s = rec.s;
  const me = s.current;
  const p = s.players[me];
  if (go) {
    p.goCount++;
    p.lastGoScore = currentScore(s, me);
    s.phase = 'play';
    rec.emit({ type: 'go', player: me, count: p.goCount });
    finishTurn(rec);
  } else {
    endWin(s, me);
    rec.emit({ type: 'stop', player: me, auto: false }, { type: 'end' });
  }
}

function finishTurn(rec: Recorder) {
  const s = rec.s;
  s.phase = 'play';
  const nxt = other(s.current);
  if (hasCards(s.players[nxt])) {
    s.current = nxt;
  } else if (!hasCards(s.players[s.current])) {
    s.phase = 'end';
    s.result = { winner: null, base: 0, afterGo: 0, multipliers: [], final: 0 };
    rec.emit({ type: 'nagari' }, { type: 'end' });
    return;
  }
  rec.emit();
}

function endSpecial(s: GameState, winner: PlayerIndex, special: 'chongtong' | 'samppeok') {
  s.phase = 'end';
  const multipliers: Multiplier[] = [];
  if (s.nagariMultiplier > 1) multipliers.push({ label: '나가리', factor: s.nagariMultiplier });
  s.result = {
    winner, special, base: SPECIAL_WIN_SCORE, afterGo: SPECIAL_WIN_SCORE, multipliers,
    final: SPECIAL_WIN_SCORE * s.nagariMultiplier,
  };
}

export function goAdjusted(base: number, goCount: number): { value: number; text?: string } {
  if (goCount === 0) return { value: base };
  if (goCount <= 2) return { value: base + goCount, text: `${goCount}고 +${goCount}점` };
  const factor = 2 ** (goCount - 2);
  return { value: (base + goCount) * factor, text: `${goCount}고 +${goCount}점 ×${factor}` };
}

export function settle(s: GameState, winner: PlayerIndex): RoundResult {
  const w = s.players[winner];
  const l = s.players[other(winner)];
  const detail = playerScore(w);
  const go = goAdjusted(detail.total, w.goCount);
  const multipliers: Multiplier[] = [];
  if (w.shakes) multipliers.push({ label: `흔들기${w.shakes > 1 ? ` ${w.shakes}회` : ''}`, factor: 2 ** w.shakes });
  if (w.bombs) multipliers.push({ label: `폭탄${w.bombs > 1 ? ` ${w.bombs}회` : ''}`, factor: 2 ** w.bombs });
  if (detail.piPoints > 0 && maxPiCount(l.captured) < PIBAK_LIMIT) multipliers.push({ label: '피박', factor: 2 });
  if (detail.gwangPoints > 0 && score(l.captured).gwangCount === 0) multipliers.push({ label: '광박', factor: 2 });
  if (detail.yeolCount >= MEONGBAK_YEOL) multipliers.push({ label: '멍박', factor: 2 });
  if (l.goCount > 0) multipliers.push({ label: '고박', factor: 2 });
  if (s.nagariMultiplier > 1) multipliers.push({ label: '나가리', factor: s.nagariMultiplier });
  const beforeMission = multipliers.reduce((acc, m) => acc * m.factor, go.value);
  const result: RoundResult = { winner, detail, base: detail.total, goBonusText: go.text, afterGo: go.value, multipliers, final: beforeMission };
  // 미션은 모든 배수를 계산한 뒤 맨 마지막에 적용한다. 패자가 완료한 미션은 효과가 없다
  if (s.mission && missionDone(s.mission, w.captured)) {
    result.missionDone = true;
    result.beforeMission = beforeMission;
    result.final = s.mission.op === 'add' ? beforeMission + s.mission.value : beforeMission * s.mission.value;
  }
  return result;
}

function endWin(s: GameState, winner: PlayerIndex) {
  s.phase = 'end';
  s.result = settle(s, winner);
}

/** 디버그·테스트용: 카드가 정확히 한 곳에만 있는지 */
export function cardLocations(s: GameState): number[] {
  return [...s.deck, ...s.floor, ...s.players[0].hand, ...s.players[1].hand, ...s.players[0].captured, ...s.players[1].captured];
}
