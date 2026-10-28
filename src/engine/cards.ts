export type Kind = 'gwang' | 'yeol' | 'tti' | 'pi';
export type Ribbon = 'hong' | 'cheong' | 'cho' | 'bi';

export interface Card {
  id: number;
  /** 1~12, 보너스패는 0 */
  month: number;
  kind: Kind;
  /** 피로 계산할 때의 장수 (일반 피 1, 쌍피 2, 쓰리피 3) */
  piValue: number;
  ribbon?: Ribbon;
  /** 고도리 새 (2·4·8월 열끗) */
  godori?: boolean;
  /** 비광 */
  biGwang?: boolean;
  /** 9월 열끗(국진): 열끗 또는 쌍피로 사용 가능 */
  gukjin?: boolean;
  bonus?: boolean;
  name: string;
}

export const MONTH_NAMES = ['', '송학', '매조', '벚꽃', '흑싸리', '난초', '모란', '홍싸리', '공산', '국진', '단풍', '오동', '비'];

type Spec = Omit<Card, 'id' | 'month'>;
const gw = (name: string, extra: Partial<Spec> = {}): Spec => ({ kind: 'gwang', piValue: 0, name, ...extra });
const ye = (name: string, extra: Partial<Spec> = {}): Spec => ({ kind: 'yeol', piValue: 0, name, ...extra });
const tt = (ribbon: Ribbon, name: string): Spec => ({ kind: 'tti', piValue: 0, ribbon, name });
const pi = (piValue = 1, name = piValue === 2 ? '쌍피' : '피'): Spec => ({ kind: 'pi', piValue, name });

const SPECS: Spec[][] = [
  [],
  [gw('송학 광'), tt('hong', '홍단'), pi(), pi()],
  [ye('꾀꼬리', { godori: true }), tt('hong', '홍단'), pi(), pi()],
  [gw('벚꽃 광'), tt('hong', '홍단'), pi(), pi()],
  [ye('두견새', { godori: true }), tt('cho', '초단'), pi(), pi()],
  [ye('다리'), tt('cho', '초단'), pi(), pi()],
  [ye('나비'), tt('cheong', '청단'), pi(), pi()],
  [ye('멧돼지'), tt('cho', '초단'), pi(), pi()],
  [gw('공산 광'), ye('기러기', { godori: true }), pi(), pi()],
  [ye('국진', { gukjin: true }), tt('cheong', '청단'), pi(), pi()],
  [ye('사슴'), tt('cheong', '청단'), pi(), pi()],
  [gw('오동 광'), pi(2), pi(), pi()],
  [gw('비광', { biGwang: true }), ye('제비'), tt('bi', '비띠'), pi(2)],
];

export const CARDS: Card[] = [];
for (let m = 1; m <= 12; m++) {
  SPECS[m].forEach((s, i) => CARDS.push({ ...s, id: (m - 1) * 4 + i, month: m }));
}
CARDS.push({ id: 48, month: 0, kind: 'pi', piValue: 2, bonus: true, name: '보너스 쌍피' });
CARDS.push({ id: 49, month: 0, kind: 'pi', piValue: 3, bonus: true, name: '보너스 쓰리피' });

export const TOTAL_CARDS = CARDS.length;
export const card = (id: number): Card => CARDS[id];
export const monthOf = (id: number): number => CARDS[id].month;
export const isBonus = (id: number): boolean => !!CARDS[id].bonus;

export const DAN_SETS: Record<'hong' | 'cheong' | 'cho', number[]> = {
  hong: [1, 2, 3],
  cheong: [6, 9, 10],
  cho: [4, 5, 7],
};
