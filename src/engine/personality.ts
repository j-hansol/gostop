// AI 성격. 판단 기준의 수치만 바꾸고, AI가 볼 수 있는 정보는 성격과 상관없이 같다.

export type PersonalityId = 'balanced' | 'gambler' | 'careful' | 'comboHunter' | 'piCollector' | 'spoiler';

export interface Persona {
  id: PersonalityId;
  label: string;
  desc: string;
  /** 이 성격의 AI 이름에 쓰는 형용사 */
  adjectives: string[];
  /** 상대 패 견제 비중 */
  oppWeight: number;
  /** 바닥 패를 내줄 위험 비중 */
  exposure: number;
  /** 족보·광 가치 배수 */
  comboMul: number;
  /** 피 가치 배수 */
  piMul: number;
  /** 미션 가치 배수 */
  missionMul: number;
  /** 폭탄에 더하는 가치 */
  bombBonus: number;
  /** 고 최대 횟수 */
  maxGo: number;
  /** 상대가 이 점수 이상이면 스톱 */
  stopOpp: number;
  /** 내가 이 점수 이상이면 스톱 */
  stopMy: number;
  /** 2고 이후에는 상대가 이 점수 이상이면 스톱 */
  secondGoOpp: number;
  /** 고를 이어 갈 조건. score: 점수 기준만, combo: 족보가 한 장 남았을 때, pi: 피 점수를 더 낼 수 있을 때 */
  goRule: 'score' | 'combo' | 'pi';
  /** 내 점수가 상대보다 낮으면 흔들지 않는다 */
  cautiousShake: boolean;
  /** 상대에게 빼앗을 피가 생길 때까지 보너스패를 아낀다 */
  holdBonus: boolean;
  /** 바닥 2장 중 고를 때 상대가 얻을 가치를 빼는 비중 */
  floorDeny: number;
  /** 바닥 2장 중 고를 때 지금 점수에 더하는 비중 */
  floorPoints: number;
}

/** 기본값. 추천 기능과 테스트가 쓰는 표준 판단 기준이다 */
export const BALANCED: Persona = {
  id: 'balanced', label: '균형', desc: '상황에 따라 고르게 둡니다.', adjectives: [],
  oppWeight: 0.9, exposure: 1, comboMul: 1, piMul: 1, missionMul: 1, bombBonus: 0,
  maxGo: 3, stopOpp: 5, stopMy: 15, secondGoOpp: 3, goRule: 'score',
  cautiousShake: false, holdBonus: false, floorDeny: 0, floorPoints: 0,
};

export const AI_PERSONAS: Persona[] = [
  {
    ...BALANCED, id: 'gambler', label: '승부사', desc: '큰 패와 폭탄을 노리고 고를 많이 부릅니다.', adjectives: ['겁 없는', '배짱 좋은', '허세 가득'],
    oppWeight: 0.6, exposure: 0.5, comboMul: 1.2, piMul: 0.8, missionMul: 1.5, bombBonus: 3,
    maxGo: 5, stopOpp: 6, stopMy: 25, secondGoOpp: 5,
  },
  {
    ...BALANCED, id: 'careful', label: '신중파', desc: '위험한 패를 피하고 일찍 스톱합니다.', adjectives: ['꼼꼼한', '깐깐한', '느긋한'],
    oppWeight: 1, exposure: 1.6, comboMul: 0.9, missionMul: 0.7,
    maxGo: 1, stopOpp: 3, stopMy: 9, cautiousShake: true, floorPoints: 1,
  },
  {
    ...BALANCED, id: 'comboHunter', label: '족보꾼', desc: '고도리·단·광을 노리고, 족보가 한 장 남으면 고를 부릅니다.', adjectives: ['전설의', '번개손'],
    oppWeight: 0.7, exposure: 0.9, comboMul: 1.8, piMul: 0.7, missionMul: 1.2,
    maxGo: 2, stopMy: 99, goRule: 'combo',
  },
  {
    ...BALANCED, id: 'piCollector', label: '피 수집가', desc: '피와 쌍피를 모으고, 피박을 씌울 수 있으면 스톱합니다.', adjectives: ['조용한', '수상한'],
    oppWeight: 0.8, comboMul: 0.7, piMul: 1.8, goRule: 'pi', holdBonus: true,
  },
  {
    ...BALANCED, id: 'spoiler', label: '훼방꾼', desc: '내 득점보다 상대의 족보와 미션을 끊는 데 집중합니다.', adjectives: ['눈치 빠른', '능청스런'],
    oppWeight: 1.5, exposure: 1.2, missionMul: 1.5,
    maxGo: 2, stopOpp: 4, stopMy: 12, floorDeny: 1,
  },
];

export const personaOf = (id: PersonalityId | undefined): Persona => AI_PERSONAS.find((p) => p.id === id) ?? BALANCED;

/** 성격이 없던 저장 데이터: 이름의 형용사로 성격을 찾고, 없으면 기본 성격으로 둔다 */
export function personalityFromName(name: string): PersonalityId {
  return AI_PERSONAS.find((p) => p.adjectives.some((a) => name.startsWith(`${a} `)))?.id ?? BALANCED.id;
}
