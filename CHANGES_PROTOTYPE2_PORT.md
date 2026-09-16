# 프로토타입 2 기능 이식 (VoxBook)

구 프로토타입 `/Users/fellindilemma/Desktop/Project/SCC` (단독 실행형, localStorage 기반, 멀티 스크린 SPA)의
접근성/교과서 기능을 VoxBook(`SCC_PROJECT`, Express + Prisma + Postgres 백엔드 + 정적 프론트엔드)으로 이식했다.
구조가 다르기 때문에 그대로 복사하지 않고 VoxBook의 아키텍처(Chapter 테이블 기반, 단일 스크롤 페이지)에 맞게 적응시켰다.

---

## 1. 이식한 기능 (feature by feature)

| 기능 | 원본 | VoxBook에서의 형태 |
|---|---|---|
| 실시간 프레임 품질 안내 | `js/frameQuality.js` + `js/main.js`의 `startFrameLoop()` | 모듈은 그대로 복사, 카메라 루프는 `app.js`에 새로 작성 (0.5초 간격, 음성 안내 throttle, 연속 3회 "good" 시 자동 촬영) |
| 그래프 소리·진동 청취 | `js/graphSound.js` | 그대로 복사. ch6 전용 하드코딩 데모를 대체해 **모든 수학 단원**에 붙음 |
| 손으로 그래프 따라 그리기 | `js/graphTrace.js` | 그대로 복사. 단원별 캔버스에 필요할 때만 `bind()` |
| 상시 듣기(TTS 중 자동 음소거) | `js/voiceControl.js` + `js/speech.js`의 mute/unmute 규율 | 모듈은 그대로 복사, mute/unmute 배선은 VoxBook의 `speak()`/`sharedRecognition`에 새로 작성 |
| 여러 페이지 넣기 (배치 가져오기) | `js/pdfImport.js` + `js/main.js`의 `importPdfFile()`/`importImageFiles()` | `pdfImport.js`는 그대로 복사, 가져오기 로직은 `MockAI` 대신 `VoxAPI`를 쓰도록 재작성 |
| 교과서 목차 (library/TOC) | `js/library.js` | **이식하지 않음.** localStorage 별도 저장소 대신, 백엔드 `Chapter` 행을 과목·단원으로 묶어 보여주는 뷰로 재구현 |

---

## 2. 생성한 파일

| 파일 | 설명 |
|---|---|
| `frontend/frameQuality.js` | 원본 그대로 복사 (밝기/엣지 밀도/라플라시안 분산 휴리스틱). 끝에 `window.FrameQuality = FrameQuality;` 한 줄 추가 |
| `frontend/graphSound.js` | 원본 그대로 복사. 끝에 `window.GraphSound = GraphSound;` 추가 |
| `frontend/graphTrace.js` | 원본 그대로 복사. 끝에 `window.GraphTrace = GraphTrace;` 추가 |
| `frontend/voiceControl.js` | 원본 그대로 복사. 끝에 `window.VoiceControl = VoiceControl;` 추가 |
| `frontend/pdfImport.js` | 원본 그대로 복사 (CDN ESM pdf.js import 유지, 이미 `window.PdfImport`를 설정함) |
| `backend/prisma/migrations/20260916065859_add_unit_review_fields/` | 새 마이그레이션 |
| `CHANGES_PROTOTYPE2_PORT.md` | 이 문서 |

> **`window.X = X` 한 줄을 덧붙인 이유:** 원본 모듈들은 클래식 스크립트 최상단에서 `const FrameQuality = ...` 형태로
> 선언하는데, top-level `const`는 `window`에 붙지 않는다. 따라서 `window.VoiceControl` 같은 존재 확인 가드가
> 항상 `undefined`가 되어 mute/unmute가 통째로 no-op이 된다(원본 `speech.js`에 실재하는 잠재 버그).
> `pdfImport.js`가 이미 쓰고 있는 방식과 동일하게 명시적으로 노출해서 해결했다. 모듈 내부 로직은 손대지 않았다.

## 3. 수정한 파일

| 파일 | 변경 내용 |
|---|---|
| `backend/prisma/schema.prisma` | `Chapter`에 `unitNumber Int?`, `needsReview Boolean @default(false)`, `reviewReason String?` 추가 |
| `backend/src/routes/chapters.js` | `POST /bulk`(최대 200건 일괄 생성), `PATCH /:id`(부분 수정) 추가 |
| `backend/src/routes/ai.js` | `POST /graph-equation`, `POST /toc-extract`, `POST /match-unit` 추가 |
| `frontend/index.html` | 새 모듈 5개 script 태그 추가, "교과서 만들기" 패널 + `#batchImportPanel` + `#libraryPanel` 추가 |
| `frontend/api.js` | `updateChapter`, `addChaptersBulk`, `aiParseGraphEquation`, `aiExtractToc`, `aiMatchUnit` 추가 |
| `frontend/app.js` | 아래 4절 참고 (변경량 대부분이 여기에 있음) |
| `frontend/styles.css` | `.graph-panel`, `.graph-select`, `.graph-trace-canvas`, `.library-unit-list`, `.flagged-box`, `.review-row`, `.badge-warning` 추가 (기존 토큰·클래스 재사용) |

## 4. `frontend/app.js` 변경 상세

- **음성 아키텍처 통합** — `vcSupported/vcStart/vcStop/vcMute/vcUnmute` 헬퍼 추가.
  `speak()`가 발화 시작 시 마이크를 끄고 `onend`/`onerror`에서 되살린다. 한 번 듣기(`sharedRecognition`)가
  도는 동안에는 상시 듣기를 재우고, 체인이 완전히 끝난 뒤에만 되살린다.
  `alwaysListenBtn`은 `sharedRecognition` 재활용을 그만두고 `VoiceControl`을 쓴다.
- **카메라** — `startFrameLoop()`/`stopFrameLoop()`/`capturePhoto()`/`restoreListeningAfterCamera()`/`handleCaptureCommand()` 추가.
  셔터 버튼과 "캡처" 음성 명령이 같은 `capturePhoto()`를 호출한다.
- **그래프** — ch6 전용 `setupGraphCanvas()`(원 넓이 하드코딩 데모, 90줄)를 삭제하고
  `hasGraphPanel()`/`renderGraphBlockHtml(chapter)`/`setupGraphPanel(chapter)`/`buildEquationFn()`/`buildEquationDescription()`로 교체.
- **배치 가져오기** — `importPdfFile()`, `importImageFiles()`, `readFileAsDataUrl()`, `deriveUnitNumber()`,
  `detectSubjectOrDefault()`, `speakMilestone()` 추가.
- **목차** — `buildLibraryGroups()`, `renderLibraryPanel()`, `openLibraryPanel()` 추가.
- **확인 필요 배지** — `renderReviewBadgeHtml()`, `markReviewed()` 추가.

---

## 5. 백엔드 추가 사항

### 스키마 (`Chapter`)
```prisma
unitNumber   Int?
needsReview  Boolean  @default(false)
reviewReason String?
```
마이그레이션: `20260916065859_add_unit_review_fields` (`npx prisma migrate dev`로 생성·적용, `prisma generate` 완료)

### 엔드포인트

| 메서드 | 경로 | 요청 | 응답 |
|---|---|---|---|
| `PATCH` | `/api/chapters/:id` | `{bodyText?, subject?, unitNumber?, needsReview?, reviewReason?}` (최소 1개) | `{chapter}` |
| `POST` | `/api/chapters/bulk` | `{chapters:[{title, bodyText, subject?, unitNumber?, needsReview?, reviewReason?}]}` (1~200) | `{chapters:[...]}` |
| `POST` | `/api/ai/graph-equation` | `{text}` | `{found, type, coefficients:[a,b,c], domainMin, domainMax, equationLabel, aiAnalysis}` |
| `POST` | `/api/ai/toc-extract` | `{text}` | `{units:[{unitNumber, unitTitle}]}` |
| `POST` | `/api/ai/match-unit` | `{units, pageText}` | `{unitNumber, matched}` |

- `PATCH`는 `chapter.userId === req.userId`인 단원만 수정 가능(기본 제공 seed 단원은 404).
- `POST /bulk`는 `count`를 한 번만 읽고 항목마다 증가시켜 slug 유니크 충돌을 피하며, `$transaction`으로 감쌌다.
- AI 라우트 3종은 기존 라우트와 **동일한 패턴**(zod → `callGemini` → 고정 마커 형식 프롬프트 → 정규식 파싱 → `handleAiError`)을 따른다. `gemini.js`는 수정하지 않았고 responseSchema도 쓰지 않았다.

---

## 6. 의도적인 범위 축소 (원본 대비)

1. **목차를 별도 저장소가 아니라 Chapter 행에서 실시간 계산.**
   원본 `Library` 모듈(localStorage의 `units`/`pages` 배열)은 이식하지 않았다. VoxBook은 이미 사용자별
   Postgres `Chapter` 테이블이 진실의 원천이라, 별도 저장소를 두면 두 데이터가 갈라진다.
   따라서 "단원"은 `Chapter.unitNumber` 컬럼이고, 목차 화면은 `(subject, unitNumber)`로 그룹핑한 뷰다.
2. **단원 제목(`unitTitle`)을 저장하지 않는다.**
   원본은 단원별 제목을 별도 저장했지만, 여기서는 그룹 버튼이 `"수학 3단원 — 5페이지"`처럼 번호만 쓴다.
   제목까지 저장하려면 `Unit` 테이블이 필요한데 이번 범위를 넘어선다. AI가 뽑은 `unitTitle`은
   페이지 매칭(`match-unit`)에만 쓰고 저장하지 않는다.
3. **"확인 필요" 목록은 전용 검수 화면이 아니라 "첫 항목으로 점프".**
   원본은 flagged 페이지를 순회하는 별도 스크린(이전/다음/확인완료)이 있었다. 여기서는
   `libraryFlaggedBtn`이 첫 번째 flagged 단원으로 이동하고, 단원 상세에 `⚠ 확인이 필요해요` 배지와
   `확인 완료` 버튼(→ `PATCH`)이 붙는다. 하나씩 처리하면 배지가 사라진다.
4. **단원 열람 시 자동 방정식 인식 없음.**
   원본은 수학 지문을 열 때마다 `parseGraphEquation`을 자동 호출했다. 매번 Gemini를 호출하면
   비용·지연이 크고 VoxBook의 AI 라우트에는 분당 20회 rate limit이 있어서, **"적용하기" 버튼을 눌렀을 때만** 호출한다.
5. **목차 음성 명령("3단원") 없음.**
   원본은 목차 화면에서 `handleLibraryTranscript`로 "3단원" 발화를 처리했다. VoxBook의 상시 듣기는
   AI 튜터 질문 한 가지 용도로 통일되어 있어, 화면별 발화 모드 분기는 넣지 않았다.
6. **배치 가져오기는 파일 입력만 (카메라 연속 촬영 세션 없음).**
   원본에는 `btn-batch-camera`로 "캡처"를 반복해 여러 장을 모으는 모드가 있었다. 지시 범위(파일로 넣기)에 맞춰 제외했다.
7. **`GraphTrace`는 싱글턴 그대로.**
   한 번에 캔버스 하나에만 묶인다. 다른 수학 단원의 따라 그리기를 열면 그 캔버스로 다시 묶는다
   (이전 캔버스는 화면에 없어서 이벤트를 받지 않으므로 무해). 다중 인스턴스화는 하지 않았다.
8. **OCR 실패 페이지의 본문 텍스트.**
   백엔드 `bodyText`가 `min(1)` 필수라서, 글자를 못 읽은 페이지는 빈 문자열 대신
   `"(이 페이지에서는 글자를 읽지 못했어요)"`를 넣고 `needsReview: true, reviewReason: "ocr_empty"`로 표시한다.
9. **목차 그룹에 seed 단원도 포함.**
   요약 줄은 `내가 만든 항목 N개 · 전체 M개 · 확인 필요 K건`으로 둘 다 보여준다.
   기본 제공 9개 단원을 그룹에서 빼면 가져오기 전에는 목차가 완전히 비어 혼란스럽고,
   빼지 않으면 개수가 헷갈리므로 둘을 명시적으로 구분해서 표기했다.

### 이식 중 고친 것 (원본의 잠재 버그)
- 원본 `speech.js`의 `window.VoiceControl` 참조는 항상 `undefined`였다(2절 참고). 명시적 전역 노출로 실제 동작하게 했다.
- `speak()`에 세대 카운터(`speakGen`)를 넣었다. `speechSynthesis.cancel()`은 이전 발화의 `onend`를
  **비동기로** 발생시키므로, 이게 없으면 새 발화 직후에 취소된 발화의 `onend`가 마이크를 열어버려
  되울림 방지가 무너진다. (원본 `speech.js`와 같은 설계)
- 백엔드 마커 파싱에서 `KEY:\s*(.+)` 대신 `KEY:[ \t]*(.*)`를 썼다. `\s`는 줄바꿈을 포함해서,
  값이 빈 줄일 때 정규식이 다음 마커 줄을 값으로 집어오는 문제가 실제로 재현됐다
  (`equationLabel`이 `"ANALYSIS:"`로 나옴 → 수정 후 `""`).

---

## 7. 검증 결과 (백엔드, curl)

테스트 계정: `port-test@example.com` / `testpass123`

| 검사 | 결과 |
|---|---|
| `GET /api/health` | `{"ok":true}` |
| `POST /api/auth/signup` / `login` | 토큰 발급 정상 |
| `GET /api/chapters` | 11건, 새 필드(`unitNumber`/`needsReview`/`reviewReason`) 정상 직렬화 |
| `POST /api/chapters` (기존) | `custom3` 생성 정상 (회귀 없음) |
| `POST /api/chapters/bulk` | 2건 생성, slug `custom1`/`custom2`, orderIndex 1000/1001 |
| `PATCH /api/chapters/:id` | 본인 단원 수정 성공 / seed 단원 **404** / 빈 body **400** |
| `POST /api/ai/tutor` (기존) | 정상 응답 (회귀 없음) |
| `POST /api/ai/graph-equation` | `"y = 2x^2 - 3x + 1"` → `found:true, type:"quadratic", coefficients:[2,-3,1], domain -1~2.5` |
| `POST /api/ai/graph-equation` (방정식 없음) | `found:false`, 계수 `[0,0,0]` |
| `POST /api/ai/toc-extract` | 목차 텍스트 → 단원 4개 / 일반 지문 → `units: []` |
| `POST /api/ai/match-unit` | 원 넓이 지문 → `unitNumber:2, matched:true` / 무관한 지문 → `null, false` |

> Gemini API가 간헐적으로 `high demand` 오류를 반환한다(기존 `/api/ai/tutor`도 동일하게 실패 → 상류 문제).
> 재시도하면 성공한다.

**프론트엔드 정적 검증** (브라우저 없이 수행):
- 편집한 모든 파일 `node --check` 통과.
- `app.js`의 모든 `$("...")` 참조 id가 `index.html` 또는 런타임 생성 마크업에 실재함을 스크립트로 대조 확인.
- 동적 생성 id(`graph-*-${chapter.id}`, `review-row-${chapter.id}`)와 조회 문자열이 정확히 일치함을 확인.
- 새로 만든 함수 전부가 최소 한 곳에서 호출됨을 확인.
- 제거한 로직(`setupGraphCanvas`, `graphCanvas`, `graphDescribeBtn`, `graphStepBtn`, `isAlwaysListen`,
  `sharedRecognition.continuous`)의 잔여 참조 0건 확인.
- 정적 서버에서 새 파일 5개 모두 HTTP 200.

---

## 8. 브라우저 수동 테스트 체크리스트 (http://localhost:5500)

로그인 화면은 없다. 페이지를 열면 게스트 계정으로 자동 로그인된다.
마이크·카메라 권한을 허용해야 하고, **음성 인식은 Chrome 계열에서만 동작**한다.

### A. 상시 듣기 + TTS 자동 음소거 (되울림 방지)
1. "화면·음성 설정" 패널에서 `🎙 항상 듣기: 꺼짐` 클릭 → `켜짐`으로 바뀌고 안내 문구가 뜬다.
2. 아무 말이나 한다 → 질문 입력창에 인식된 문장이 채워지고 AI 튜터가 답한다.
3. **핵심:** AI 튜터가 음성으로 답하는 동안, 그 답변 음성이 다시 질문으로 인식돼서 무한 루프가 돌면 안 된다.
   답변이 끝난 뒤에는 다시 듣기 상태로 돌아와야 한다.
4. 다시 눌러 끄면 마이크가 멈춘다.

### B. 카메라 실시간 거리·밝기 안내 + 자동 촬영
1. "1. 페이지 찍기"에서 `카메라 켜기` 클릭.
2. 렌즈를 손으로 가린다 → `너무 어둡습니다. 밝은 곳에서 비춰주세요.` 가 안내줄에 뜨고 음성으로 나온다.
3. 교과서에 아주 가까이 댄다 → `너무 가깝습니다. 조금 멀리서 비춰주세요.`
4. 멀리서 비춘다 → `학습 자료가 잘 보이지 않습니다. 조금 더 가까이 대주세요.`
5. 같은 상태를 유지하면 약 4초마다 한 번씩만 다시 말해야 한다(0.5초마다 떠들면 안 됨).
6. 적당한 거리에서 안정시키면 `좋습니다. 그대로 유지해주세요.` 가 3번 연속 나온 뒤 **자동으로 촬영**되고 OCR이 시작된다.
7. 카메라가 켜진 상태에서 **"캡처"라고 말하면** 셔터 버튼을 누른 것과 동일하게 촬영된다.
8. 촬영 후 상시 듣기가 켜져 있었다면 AI 튜터 듣기 모드로 되돌아가야 한다.

### C. 그래프 소리·진동 + 손으로 따라 그리기
1. 목차에서 아무 **수학** 단원(예: `2. 원의 넓이`)을 연다 → 본문 아래 그래프 패널이 보인다.
   (예전엔 `6. 그래프 촉각 탐색` 하나에만 있었다.)
2. 드롭다운에서 `2차함수 (아래로 볼록한 포물선)` 선택 → `🔊 소리·진동으로 듣기` 클릭.
   → 음이 높→낮→높으로 3.2초간 변하고, 끝난 뒤 설명을 읽어준다. 모바일이면 진동도 함께 온다.
3. 입력칸에 `y = 2x^2 - 3x + 1`을 넣고 `적용하기` → 드롭다운 맨 위에
   `직접 입력한 방정식: y = 2x^2 - 3x + 1` 항목이 생기고 자동 선택된다.
   다시 `소리·진동으로 듣기` → 꼭짓점 좌표가 포함된 설명이 나온다.
4. `손으로 그래프 따라 그리기` 클릭 → 캔버스가 나타나고 곡선이 그려진다.
   캔버스를 누른 채 왼→오른쪽으로 끌면, 손가락이 곡선 위에 있을 때만 진동이 온다(모바일).
5. 다른 수학 단원으로 이동해서 따라 그리기를 열어도 정상 동작해야 한다.
6. `5. 중세 국어`(국어 단원)에는 그래프 패널이 **없어야** 한다.

### D. 여러 페이지 넣기 (배치 가져오기)
1. "2. 교과서 만들기"에서 `여러 페이지 넣기 (교과서 만들기)` 클릭 → 패널이 열린다.
2. `파일로 넣기` 클릭 → 교과서 사진 **여러 장**을 한 번에 선택.
3. `1 / 3장 처리 중 (33%)` 처럼 진행률이 갱신되고, 25%마다 음성 안내가 나온다.
4. 끝나면 `총 3장 중 3장은 확인이 필요합니다.` 안내와 함께 배치 패널이 닫히고 **교과서 목차 패널이 자동으로 열린다**.
5. 목차에 `{과목} 미배정 — 3페이지` 그룹이 생겨 있어야 한다.
6. **PDF 1개**를 선택하면: 북마크가 있는 PDF는 단원이 자동 배정되고, 없으면 첫 3페이지에 "목차/차례"가
   있을 때 AI가 목차를 뽑아 페이지를 배정한다. 배정 실패 페이지만 "확인 필요"가 된다.
7. 처리 중 오류가 나면 상태줄에 오류 메시지가 뜨고 버튼이 다시 활성화돼야 한다(멈춰 있으면 안 됨).

### E. 교과서 목차 (library)
1. `📖 교과서 목차 열기` 클릭 → 요약줄 `내가 만든 항목 N개 · 전체 M개 · 확인 필요 K건`이 뜨고
   음성 안내가 나온다.
2. 과목·단원 그룹 버튼이 과목 순서(수학→국어→영어→사회→과학), 단원 번호 오름차순, "미배정"은 맨 뒤로 정렬돼 있다.
3. 그룹 버튼 클릭 → 그 그룹의 첫 단원 상세로 이동하고 목차 패널이 닫히며 `수학 2단원으로 이동` 토스트가 뜬다.
4. 확인 필요가 1건 이상이면 `⚠ 확인이 필요한 항목 N건 보기` 버튼이 보인다. 클릭 → 첫 flagged 단원으로 이동.
5. 그 단원 상세 상단에 `⚠ 확인이 필요해요` 배지와 `확인 완료` 버튼이 있다.
6. `확인 완료` 클릭 → 배지가 즉시 사라지고 토스트가 뜬다.
   목차를 다시 열면 "확인 필요" 건수가 1 줄어 있어야 한다. (새로고침 후에도 유지돼야 함 = DB 저장됨)
7. `닫기`로 패널을 닫을 수 있다.

### F. 회귀 확인 (기존 기능이 안 깨졌는지)
- 목차 카드 클릭 → 단원 상세 열림, `◀ 목록으로` 동작.
- 하단 재생바 `▶`/`⏮`/`⏭`/`★` 동작, 일시정지 후 마이크가 계속 먹통이 되지 않는지 확인.
- 🎤 버튼(질문/검색/퀴즈 정답) 한 번 듣기 동작. **상시 듣기가 켜진 상태에서도** 🎤 한 번 듣기가
  정상 인식돼야 하고(두 엔진이 마이크를 두고 다투면 안 됨), 끝나면 상시 듣기가 되살아나야 한다.
- 퀴즈 내기 / 정답 확인, AI 튜터 질문, 학습 리포트 불러오기.
- 단일 촬영(📱 사진 앱으로 찍기 → OCR → 교과서에 추가하기).
- 글자 크기 / 고대비 / 읽는 속도 설정.
