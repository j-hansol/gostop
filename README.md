# 맞고

AI와 1:1로 즐기는 고스톱(맞고) 웹 게임입니다. 규칙은 [docs/RULES.md](docs/RULES.md)를 참고하세요.

## 실행

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 규칙 엔진 테스트
npm run build    # dist/ 에 배포용 정적 파일 생성 (dist/index.html 을 더블클릭해 바로 실행 가능)
npm run sim 600  # AI 대 단순 탐욕 정책 대전 시뮬레이션
npm run build:blog  # 블로그 글용 HTML 생성 (아래 참고)
npm run bench:advice 300  # 추천대로 두는 나 vs AI 대전 비교
```

## 블로그에 올리기

`npm run build:blog`를 실행하면 두 파일이 생깁니다.

- `dist/blog-post.html`: 게임 전체(HTML·CSS·JS·카드 그림)를 담은 `<script>` 하나입니다. 티스토리 글쓰기에서 **HTML 모드**로 바꾼 뒤 내용을 그대로 붙여 넣으면 됩니다. 약 850KB입니다.
- `dist/blog-preview.html`: 일부러 스타일을 강하게 준 가짜 블로그 페이지에 위 글을 넣은 확인용 페이지입니다. `npx vite preview` 후 `/blog-preview.html`로 엽니다.

글에는 `맞고 게임 시작` 버튼이 놓이고, 누르면 게임이 화면 전체를 덮는 팝업으로 열립니다. 팝업은 닫힌 Shadow DOM 안의 iframe이라 블로그 스타일과 서로 영향을 주지 않습니다. 게임 오른쪽 위의 `닫기`로 닫으며, 판이 진행 중이면 기권패 처리를 확인한 뒤 닫습니다. 저장 데이터는 블로그 주소의 localStorage에 남아 다음에 열어도 이어집니다.

## 구조

| 경로 | 내용 |
|---|---|
| `src/engine/cards.ts` | 화투 50장 정의 (보너스 2피 1장, 3피 1장 포함) |
| `src/engine/scoring.ts` | 점수와 족보 계산 |
| `src/engine/game.ts` | 게임 상태 머신. 행동마다 애니메이션용 프레임과 이벤트를 돌려준다 |
| `src/engine/ai.ts` | AI. 더미에서 나올 수 있는 패를 모두 가정해 평균 기대값으로 수를 고른다 |
| `src/engine/advisor.ts` | 플레이어용 수 추천. 공개 정보(PublicView)만 받아 모르는 패를 무작위로 채운 가상 배치로 평가한다 |
| `src/engine/economy.ts` | 레벨, 점당 금액, 지급, AI 생성, 저장 |
| `src/ui/app.ts` | 화면 렌더링(FLIP 애니메이션), 입력, 진행 제어 |
| `src/ui/cardArt.ts` | 카드 그림. 일반 패는 `public/cards/<id>.svg`(화투 일러스트 .ai에서 변환), 보너스패·뒷면은 직접 작성 |
| `src/ui/sound.ts` | 효과음 (Web Audio API 합성) |
| `tools/blog.mjs` | 블로그 글용 단일 HTML 생성. 카드 SVG를 상대 좌표로 다시 써서 크기를 줄인다 |

저장 데이터는 브라우저 localStorage의 `gostop-save-v1` 키에 저장됩니다.
