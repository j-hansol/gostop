# 맞고

AI와 1:1로 즐기는 고스톱(맞고) 웹 게임입니다. 규칙은 [docs/RULES.md](docs/RULES.md)를 참고하세요.

## 실행

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 규칙 엔진 테스트
npm run build    # dist/ 에 배포용 정적 파일 생성
npm run sim 600  # AI 대 단순 탐욕 정책 대전 시뮬레이션
```

## 구조

| 경로 | 내용 |
|---|---|
| `src/engine/cards.ts` | 화투 51장 정의 (보너스 2피 2장, 3피 1장 포함) |
| `src/engine/scoring.ts` | 점수와 족보 계산 |
| `src/engine/game.ts` | 게임 상태 머신. 행동마다 애니메이션용 프레임과 이벤트를 돌려준다 |
| `src/engine/ai.ts` | AI. 더미에서 나올 수 있는 패를 모두 가정해 평균 기대값으로 수를 고른다 |
| `src/engine/economy.ts` | 레벨, 점당 금액, 지급, AI 생성, 저장 |
| `src/ui/app.ts` | 화면 렌더링(FLIP 애니메이션), 입력, 진행 제어 |
| `src/ui/cardArt.ts` | 카드 그림. 일반 패는 `public/cards/<id>.svg`(화투 일러스트 .ai에서 변환), 보너스패·뒷면은 직접 작성 |
| `src/ui/sound.ts` | 효과음 (Web Audio API 합성) |

저장 데이터는 브라우저 localStorage의 `gostop-save-v1` 키에 저장됩니다.
