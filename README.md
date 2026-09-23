# 같이보는 교과서 (VoxBook)

시각장애·저시력 학생을 위한 음성 교과서 웹앱입니다. 교과서 페이지를 촬영하면 AI가 글을 읽어주고, 그림·표·그래프 같은 시각 자료도 말로 설명해줍니다.

## 주요 기능

- **촬영 → 음성 변환**: 카메라로 찍거나 사진 앱으로 찍은 교과서 페이지를 Gemini Vision이 인식해 (1) 본문 텍스트 (2) 과목 (3) 그림/표/그래프 등 시각 자료 설명까지 한 번에 뽑아냅니다.
- **음성 재생 & 접근 모드**: 소리만 / 소리+진동 / 진동만(화면리더 병행용) 세 가지 출력 방식을 지원합니다.
- **AI 튜터**: 교과서 내용이든 아니든 무엇이든 물어볼 수 있는 질의응답 기능.
- **이해도 확인 퀴즈**: 방금 들은 내용을 바탕으로 AI가 퀴즈를 내고 채점합니다.
- **학습 리포트**: 보호자·교사가 재청취 횟수, 퀴즈 정답률을 확인할 수 있습니다.
- **저시력 접근성 설정**: 글자 크기 확대(최대 2.2배), 고대비 모드, 읽는 속도 조절.
- **과목별 색상 코딩**: 단원 목록/상세 화면에서 수학·국어·영어·사회·과학을 색으로 구분.
- **검색 이동 / 북마크**: 원하는 내용으로 바로 이동, 음성 입력 지원.

## 폴더 구조

```
backend/     Express API 서버 (Prisma + PostgreSQL)
  src/
    routes/      auth, chapters, bookmarks, progress, ai
    middleware/  JWT 인증
    utils/       Gemini 호출 래퍼
  prisma/      스키마 & 시드 데이터
frontend/    정적 HTML/CSS/JS (빌드 도구 없음)
  index.html
  app.js       메인 앱 로직
  auth.js      게스트 계정 자동 로그인
  api.js       백엔드 API 클라이언트
  styles.css
```

## 로컬 실행

### 1. 백엔드

```bash
cd backend
npm install
cp .env.example .env   # 값 채우기 (아래 참고)
npx prisma migrate deploy
npm run dev             # http://localhost:4000
```

`.env` 필요한 값:

| 변수 | 설명 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 연결 문자열 (Neon, Supabase 등) |
| `JWT_SECRET` | 토큰 서명용 무작위 문자열 |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey)에서 발급 |
| `FRONTEND_ORIGIN` | 배포된 프론트 주소 (로컬 개발 중엔 비워두면 전체 허용) |
| `PORT` | 기본값 4000 |

### 2. 프론트엔드

빌드 과정이 없는 정적 파일이라 아무 정적 서버로 띄우면 됩니다.

```bash
cd frontend
npx serve -l 5500 .     # http://localhost:5500
```

`config.js`가 `localhost`/`127.0.0.1`에서는 자동으로 `http://localhost:4000`을 API 주소로 사용합니다.

로그인 화면은 없으며, 앱이 뜨면 고정 게스트 계정으로 조용히 자동 로그인/가입됩니다.

## 배포

`render.yaml` 기준으로 Render에 백엔드(Node 웹서비스) + 프론트엔드(정적 사이트)를 각각 배포합니다. 백엔드 환경변수(`DATABASE_URL`, `JWT_SECRET`, `GEMINI_API_KEY`, `FRONTEND_ORIGIN`)는 Render 대시보드에서 직접 설정해야 합니다(`sync: false`).

## 기술 스택

- **백엔드**: Node.js, Express, Prisma, PostgreSQL, JWT, Google Gemini API
- **프론트엔드**: 순수 HTML/CSS/JS (프레임워크 없음), Web Speech API, MediaDevices 카메라 API
