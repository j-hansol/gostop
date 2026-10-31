import type { PlayerIndex } from './game';
import { AI_PERSONAS, PersonalityId, personalityFromName } from './personality';

export const INITIAL_MONEY = 50000;
export const FORFEIT_POINTS = 7;
/** 각자의 첫 턴에 뻑이 나면 상대에게서 받는 점수 */
export const FIRST_PPEOK_POINTS = 7;
export const SAVE_KEY = 'gostop-save-v1';

export interface AiProfile {
  name: string;
  money: number;
  initialMoney: number;
  personality: PersonalityId;
}

export interface Profile {
  version: 1;
  playerMoney: number;
  level: number;
  ai: AiProfile;
  /** 다음 판 선 (0: 나, 1: AI) */
  dealer: PlayerIndex;
  nagariStreak: number;
  inProgress: boolean;
  stats: { wins: number; losses: number; draws: number };
}

export const pointRate = (level: number): number => (Math.floor(level / 5) + 1) * 100;
export const nagariMultiplier = (streak: number): number => 2 ** streak;

const NOUN = ['곰', '여우', '너구리', '호랑이', '두꺼비', '부엉이', '고양이', '거북이', '까치', '수달', '오소리', '독수리'];

export function createAi(prev: AiProfile | null, rng: () => number = Math.random): AiProfile {
  const money = prev ? Math.round((prev.initialMoney * (1 + rng() * 0.4)) / 100) * 100 : INITIAL_MONEY;
  // 직전 AI와 다른 성격을 고르고, 이름의 형용사는 그 성격에 맞춘다
  const pool = AI_PERSONAS.filter((p) => p.id !== prev?.personality);
  const persona = pool[Math.floor(rng() * pool.length)];
  const name = `${persona.adjectives[Math.floor(rng() * persona.adjectives.length)]} ${NOUN[Math.floor(rng() * NOUN.length)]}`;
  return { name, money, initialMoney: money, personality: persona.id };
}

export function newProfile(rng: () => number = Math.random): Profile {
  return {
    version: 1,
    playerMoney: INITIAL_MONEY,
    level: 1,
    ai: createAi(null, rng),
    dealer: rng() < 0.5 ? 0 : 1,
    nagariStreak: 0,
    inProgress: false,
    stats: { wins: 0, losses: 0, draws: 0 },
  };
}

export interface Settlement {
  winner: PlayerIndex | null;
  points: number;
  rate: number;
  amount: number;
  paid: number;
  aiBankrupt: boolean;
  playerBankrupt: boolean;
  /** AI 파산 시 새로 등장한 AI */
  newAi?: AiProfile;
  oldAi: AiProfile;
  levelBefore: number;
  levelAfter: number;
}

/** 판 결과를 프로필에 반영한다. 원본은 바꾸지 않는다. */
/** to에게 amount를 옮긴다. 주는 쪽 보유금이 모자라면 있는 만큼만. 실제로 옮긴 금액을 돌려준다 */
function transfer(p: Profile, to: PlayerIndex, amount: number): number {
  const paid = Math.min(amount, to === 0 ? p.ai.money : p.playerMoney);
  if (to === 0) {
    p.ai.money -= paid;
    p.playerMoney += paid;
  } else {
    p.playerMoney -= paid;
    p.ai.money += paid;
  }
  return paid;
}

/** 판 도중 정산 (첫뻑). 파산 처리는 판이 끝날 때 applyResult에서 한다 */
export function payBonus(p: Profile, to: PlayerIndex, points: number): { profile: Profile; amount: number; paid: number } {
  const next: Profile = structuredClone(p);
  const amount = points * pointRate(p.level);
  const paid = transfer(next, to, amount);
  return { profile: next, amount, paid };
}

export function applyResult(p: Profile, winner: PlayerIndex | null, points: number, rng: () => number = Math.random): { profile: Profile; settlement: Settlement } {
  const next: Profile = structuredClone(p);
  next.inProgress = false;
  const rate = pointRate(p.level);
  const base: Settlement = {
    winner, points, rate, amount: 0, paid: 0, aiBankrupt: false, playerBankrupt: false,
    oldAi: { ...p.ai }, levelBefore: p.level, levelAfter: p.level,
  };
  let settlement: Settlement = base;
  if (winner === null) {
    next.nagariStreak++;
    next.stats.draws++;
  } else {
    next.nagariStreak = 0;
    next.dealer = winner;
    const amount = points * rate;
    const paid = transfer(next, winner, amount);
    if (winner === 0) next.stats.wins++;
    else next.stats.losses++;
    settlement = { ...base, amount, paid };
  }
  // 판 도중 첫뻑 지급으로 보유금이 바닥났을 수도 있으므로 나가리여도 파산을 확인한다
  if (next.ai.money <= 0) {
    settlement.aiBankrupt = true;
    next.level++;
    next.ai = createAi(p.ai, rng);
    settlement.newAi = { ...next.ai };
    settlement.levelAfter = next.level;
  }
  if (next.playerMoney <= 0) {
    settlement.playerBankrupt = true;
  }
  return { profile: next, settlement };
}

export function loadProfile(storage: Storage | undefined): Profile | null {
  try {
    const raw = storage?.getItem(SAVE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Profile;
    if (p?.version !== 1 || typeof p.playerMoney !== 'number' || !p.ai) return null;
    p.ai.personality ??= personalityFromName(p.ai.name);
    return p;
  } catch {
    return null;
  }
}

export function saveProfile(storage: Storage | undefined, p: Profile): void {
  try {
    storage?.setItem(SAVE_KEY, JSON.stringify(p));
  } catch {
    // 저장 불가 환경(시크릿 모드 등)에서는 무시
  }
}
