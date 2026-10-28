# 맞고

![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5.4-646CFF?logo=vite&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-2.1-6E9F18?logo=vitest&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-5FA04E?logo=nodedotjs&logoColor=white)
![No framework](https://img.shields.io/badge/UI-Vanilla%20DOM-F7DF1E?logo=javascript&logoColor=black)
![Web Audio](https://img.shields.io/badge/Sound-Web%20Audio%20API-FF6F00)
![Tests](https://img.shields.io/badge/tests-21%20passed-brightgreen)
![AI Generated](https://img.shields.io/badge/AI%20Generated-Claude%20Code-D97757?logo=anthropic&logoColor=white)

AI와 1:1로 즐기는 고스톱(맞고) 웹 게임입니다. 규칙은 [docs/RULES.md](docs/RULES.md)를 참고하세요.

> [!NOTE]
> **AI 작성 고지** — 이 프로젝트의 코드, 테스트, 문서, 빌드 도구는 Anthropic의 AI인 **Claude**가 **[Claude Code](https://claude.com/claude-code)** 를 통해 작성했습니다. 사람은 게임 규칙과 요구사항을 정하고, 결과를 확인하며 수정 방향을 지시했습니다. AI가 작성한 코드에는 사람이 미처 검토하지 못한 오류가 있을 수 있습니다.

## 주요 기능

- **맞고 규칙 엔진**: 쪽·따닥·뻑·쓸, 흔들기·폭탄·총통, 고/스톱과 고박, 피박·광박·멍박, 나가리(다음 판 점수 누적 배수), 국진(9월 술잔) 쌍피 전환
- **보너스패**: 2피 1장·3피 1장. 가져오면 상대 피 1장을 빼앗습니다(일반 피 우선)
- **AI 상대**: 더미에서 나올 수 있는 패를 모두 가정해 기대값으로 수를 고릅니다
- **💡 수 추천**: 공개된 정보만으로 내가 둘 만한 패를 1~3위로 표시하고 이유를 보여 줍니다
- **족보 진행 표시**: 고도리·홍단·청단·초단·광의 진행 상황을 색상 칩과 카드 테두리로 표시합니다
- **레벨과 돈**: AI가 파산하면 레벨이 오르고 더 많은 돈을 가진 새 AI가 등장합니다. 진행 상황은 자동 저장됩니다
- **애니메이션과 효과음**: 패 이동(FLIP), 족보·고/스톱 배너, 합성 효과음
- **어디서나 실행**: 개발 서버, 빌드 결과 파일 더블클릭(`file://`), 블로그 글 삽입 모두 지원합니다

## 기술 스택

| 분류 | 사용 기술 |
|---|---|
| 언어 | TypeScript 5.6 (strict) |
| 빌드 | Vite 5.4 (일반 스크립트(IIFE)·상대 경로 출력, 파일로 직접 열기 지원) |
| 테스트 | Vitest 2.1 (규칙 엔진, 무작위 1000판 카드 보존 검사, 추천의 정보 유출 검사) |
| UI | 프레임워크 없이 DOM API 직접 사용, Web Animations API로 FLIP 애니메이션 |
| 그래픽 | SVG (카드 48장은 화투 일러스트 .ai 파일에서 변환, 보너스패·뒷면은 코드로 작성) |
| 사운드 | Web Audio API로 효과음 합성 (음원 파일 없음) |
| 저장 | 브라우저 localStorage |
| 블로그 삽입 | 닫힌 Shadow DOM + iframe `srcdoc` 단일 스크립트 (Node.js 스크립트로 생성) |
| 변환 도구 | Python + PyMuPDF (.ai 파일의 PostScript를 SVG로 변환, `tools/*.py`) |

## 실행

Node.js 18 이상이 필요합니다.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 규칙 엔진·추천 테스트
npm run build    # dist/ 에 배포용 정적 파일 생성 (dist/index.html 을 더블클릭해 바로 실행 가능)
npm run sim 600  # AI 대 단순 탐욕 정책 대전 시뮬레이션
npm run build:blog  # 블로그 글용 HTML 생성 (아래 참고)
npm run bench:advice 300  # 추천대로 두는 나 vs AI 대전 비교
```

## 블로그에 올리기

`npm run build:blog`를 실행하면 두 파일이 생깁니다.

- `dist/blog-post.html`: 게임 전체(HTML·CSS·JS·카드 그림)를 담은 `<script>` 하나입니다. 티스토리 글쓰기에서 **HTML 모드**로 바꾼 뒤 기존 스크립트를 지우고 내용을 그대로 붙여 넣으면 됩니다. 약 860KB입니다.
- `dist/blog-preview.html`: 일부러 스타일을 강하게 준 가짜 블로그 페이지에 위 글을 넣은 확인용 페이지입니다. `npx vite preview` 후 `/blog-preview.html`로 엽니다.

글에는 `맞고 게임 시작` 버튼이 놓이고, 누르면 게임이 화면 전체를 덮는 팝업으로 열립니다. 팝업은 닫힌 Shadow DOM 안의 iframe이라 블로그 스타일과 서로 영향을 주지 않습니다. 게임 오른쪽 위의 `닫기`로 닫으며, 판이 진행 중이면 기권패 처리를 확인한 뒤 닫습니다. 저장 데이터는 블로그 주소의 localStorage에 남아 다음에 열어도 이어집니다.

티스토리 페이지 콘솔에 보이는 `429` 오류는 티스토리가 자체적으로 넣는 카카오 오류 수집 서버(`aem-kakao-collector.onkakao.net`) 요청이 거절된 것으로, 게임과 관계없습니다.

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
| `tools/*.py` | 화투 일러스트 .ai 파일을 카드별 SVG로 변환하는 도구 |
| `tests/` | 엔진·추천 테스트와 대전 시뮬레이션 |
| `docs/RULES.md` | 고스톱 규칙 조사와 이 게임의 하우스 룰 |

저장 데이터는 브라우저 localStorage의 `gostop-save-v1` 키에 저장됩니다.

## 저작권과 출처

- 일반 패 48장의 그림은 designmecca의 화투 일러스트(.ai) 파일을 변환한 것입니다. 그림의 저작권은 원저작자에게 있으며, 이용과 재배포는 원저작자의 이용 조건을 따릅니다.
- 보너스패와 카드 뒷면, 효과음, 코드는 이 프로젝트에서 새로 작성했습니다.
