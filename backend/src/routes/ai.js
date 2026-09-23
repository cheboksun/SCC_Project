const express = require("express");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const { requireAuth } = require("../middleware/auth");
const { callGemini, callGeminiVision } = require("../utils/gemini");

const router = express.Router();
router.use(requireAuth);

// Gemini 호출은 비용이 드니, 사용자당 분당 요청 수를 제한
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  keyGenerator: (req) => req.userId,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "요청이 너무 잦아요. 잠시 후 다시 시도해 주세요" },
});
router.use(aiLimiter);

function handleAiError(res, err) {
  console.error("[ai]", err.message);
  res.status(502).json({ error: err.message });
}

const tutorSchema = z.object({
  chapterTitle: z.string().optional().default(""),
  chapterText: z.string().optional().default(""),
  question: z.string().min(1),
});

router.post("/tutor", async (req, res) => {
  const parsed = tutorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { chapterTitle, chapterText, question } = parsed.data;

  try {
    const answer = await callGemini(
      "너는 시각장애 학생을 돕는 친절한 AI 도우미야. 학생이 지금 보고 있는 교과서 단원 정보를 참고용으로 알려줄게. 질문이 그 단원 내용과 관련 있으면 그 내용을 바탕으로 답해줘. 하지만 질문이 교과서 내용과 무관한 다른 주제여도 성심껏 답해줘 — 교과서 내용에 없다고 답을 거절하지 마. 항상 쉬운 말로 짧게(3문장 이내) 설명하고, 음성으로 들었을 때 자연스럽게 들리도록 대답해.",
      `(참고용) 지금 학생이 보고 있는 단원: ${chapterTitle}\n(참고용) 그 단원 내용: ${chapterText}\n\n학생의 질문: ${question}`
    );
    res.json({ answer });
  } catch (err) {
    handleAiError(res, err);
  }
});

const simplifySchema = z.object({
  chapterTitle: z.string().optional().default(""),
  chapterText: z.string().min(1),
});

router.post("/simplify", async (req, res) => {
  const parsed = simplifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { chapterTitle, chapterText } = parsed.data;

  try {
    const easier = await callGemini(
      "너는 시각장애 학생을 돕는 과외 선생님이야. 학생이 이 내용을 세 번이나 다시 들었어. 원래보다 훨씬 쉬운 말과 짧은 비유를 써서, 2문장 이내로 다시 설명해줘.",
      `단원: ${chapterTitle}\n내용: ${chapterText}`
    );
    res.json({ easier });
  } catch (err) {
    handleAiError(res, err);
  }
});

const subjectSchema = z.object({ text: z.string().min(1) });
const SUBJECT_LIST = ["수학", "국어", "영어", "사회", "과학"];

router.post("/subject-detect", async (req, res) => {
  const parsed = subjectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  try {
    const guess = await callGemini(
      "너는 교과서 내용을 보고 과목을 분류하는 도우미야. 아래 목록 중 하나만, 단어 하나로만 답해: 수학, 국어, 영어, 사회, 과학. 다른 말은 절대 덧붙이지 마.",
      parsed.data.text
    );
    const subject = SUBJECT_LIST.find((s) => guess.includes(s)) || "기타";
    res.json({ subject });
  } catch (err) {
    handleAiError(res, err);
  }
});

const ocrSchema = z.object({
  imageBase64: z.string().min(1),
  mimeType: z.string().optional().default("image/jpeg"),
});

// 촬영한 교과서 페이지 사진을 Gemini Vision에 직접 보내서
// (1) 본문 텍스트 (2) 과목 (3) 그림/표/그래프 등 비텍스트 시각자료 설명을 한번에 받아옴.
// 시각장애 학생은 인식된 텍스트를 눈으로 검증할 수 없으므로, 그림 설명까지 함께 음성으로
// 들려줘서 "이 페이지에 뭐가 있는지"를 놓치지 않게 하는 게 목적.
router.post("/ocr", async (req, res) => {
  const parsed = ocrSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { imageBase64, mimeType } = parsed.data;

  try {
    const raw = await callGeminiVision(
      `너는 시각장애 학생을 돕는 교과서 촬영 도우미야. 사진 속 교과서 페이지를 보고 아래 형식 그대로, 세 줄로만 답해.
TEXT: 사진에 있는 모든 글자를 읽는 순서대로 옮겨 적어. 수식은 x^2+1 처럼 기호 그대로 옮겨 적어. 이 줄은 줄바꿈 없이 이어서 써.
SUBJECT: 수학, 국어, 영어, 사회, 과학 중 하나만.
VISUAL: 사진에 그림·사진·표·그래프처럼 글자가 아닌 시각 자료가 있으면, 그것이 무엇을 보여주는지 시각장애 학생에게 말로 설명해줘. 없으면 "없음"이라고만 써.`,
      "이 교과서 페이지를 인식해줘.",
      imageBase64,
      mimeType
    );

    const textMatch = raw.match(/TEXT:\s*([\s\S]*?)(?:\n?SUBJECT:|$)/i);
    const subjectMatch = raw.match(/SUBJECT:\s*(.+)/i);
    const visualMatch = raw.match(/VISUAL:\s*([\s\S]*)/i);

    const text = (textMatch ? textMatch[1] : raw).trim();
    const subjectGuess = subjectMatch ? subjectMatch[1].trim() : "";
    const subject = SUBJECT_LIST.find((s) => subjectGuess.includes(s)) || null;
    const visualRaw = visualMatch ? visualMatch[1].trim() : "";
    const visualDescription = visualRaw && !/^없음/.test(visualRaw) ? visualRaw : null;

    res.json({ text, subject, visualDescription });
  } catch (err) {
    handleAiError(res, err);
  }
});

const quizGenSchema = z.object({
  chapterTitle: z.string().optional().default(""),
  chapterText: z.string().min(1),
});

router.post("/quiz/generate", async (req, res) => {
  const parsed = quizGenSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { chapterTitle, chapterText } = parsed.data;

  try {
    const question = await callGemini(
      "너는 퀴즈 출제자야. 주어진 교과서 내용을 바탕으로, 학생이 이해했는지 확인할 수 있는 짧은 질문을 딱 하나만 만들어. " +
      "이 단원 내용에만 나오는 구체적인 숫자·용어·예시를 반드시 활용해서, 같은 주제를 다루는 다른 단원과 헷갈리지 않게 만들어. " +
      "질문만 출력하고, 정답은 절대 알려주지 마.",
      `단원: ${chapterTitle}\n내용: ${chapterText}`
    );
    res.json({ question });
  } catch (err) {
    handleAiError(res, err);
  }
});

const quizGradeSchema = z.object({
  question: z.string().min(1),
  chapterText: z.string().optional().default(""),
  studentAnswer: z.string().min(1),
});

router.post("/quiz/grade", async (req, res) => {
  const parsed = quizGradeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { question, chapterText, studentAnswer } = parsed.data;

  try {
    const feedback = await callGemini(
      "너는 친절한 채점자야. 교과서 내용과 문제, 학생의 답을 보고 맞았는지 판단해서, 2문장 이내로 다정하게 알려줘. 틀렸으면 정답도 짧게 알려줘. 마지막 줄에 반드시 'CORRECT: true' 또는 'CORRECT: false' 를 출력해.",
      `교과서 내용: ${chapterText}\n문제: ${question}\n학생의 답: ${studentAnswer}`
    );
    const isCorrect = /CORRECT:\s*true/i.test(feedback);
    const cleanFeedback = feedback.replace(/CORRECT:\s*(true|false)/i, "").trim();
    res.json({ feedback: cleanFeedback, isCorrect });
  } catch (err) {
    handleAiError(res, err);
  }
});

const graphSchema = z.object({ text: z.string().min(1) });

// 지문/직접 입력 텍스트에서 그래프로 그릴 수 있는 방정식을 뽑아냄.
// gemini.js는 JSON 스키마를 지원하지 않으므로, 다른 라우트들과 똑같이
// 고정된 마커 줄 형식으로 답하게 하고 정규식으로 파싱한다.
router.post("/graph-equation", async (req, res) => {
  const parsed = graphSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  try {
    const raw = await callGemini(
      `너는 수학 지문 텍스트에서 그래프로 나타낼 수 있는 방정식을 찾아 구조화하는 AI야. 지문에 명시적인 함수식(y=... 형태)이 있으면 FOUND를 true로 해.
COEFFICIENTS는 type별 의미가 다르다: linear는 a,b (y=ax+b), quadratic은 a,b,c (y=ax^2+bx+c), sine은 a,b,c (y=a*sin(bx+c)), exponential은 a,b (y=a*e^(bx)), logarithm은 a,b (y=a*ln(bx), b>0). 쓰지 않는 자리는 0으로 채워서 항상 세 개를 쉼표로 구분해 써.
DOMAIN_MIN/DOMAIN_MAX는 꼭짓점·교점 등 그래프의 특징이 잘 드러나는 x 구간을 제안해라(logarithm은 x>0만 가능).
지문에 명시적인 방정식이 없으면 FOUND를 false로 하고 나머지는 0 또는 빈 값으로 채워라.
반드시 아래 형식 그대로, 일곱 줄로만 답해. 다른 말은 절대 덧붙이지 마.
FOUND: true 또는 false
TYPE: linear 또는 quadratic 또는 sine 또는 exponential 또는 logarithm 중 하나
COEFFICIENTS: a,b,c (숫자 세 개, 쉼표 구분)
DOMAIN_MIN: 숫자
DOMAIN_MAX: 숫자
LABEL: 사람이 읽기 좋은 방정식 문자열 (예: y = x^2 - 4x + 3)
ANALYSIS: 이 그래프가 어떤 상황·현상을 나타내는지, 학생이 이해할 때 도움이 될 설명을 1~2문장으로. 꼭짓점 좌표 같은 수치는 따로 계산되니 숫자를 나열하지 말고 의미·맥락 위주로 써.`,
      parsed.data.text
    );

    // 값이 빈 줄일 때 정규식이 줄바꿈을 넘어 다음 마커 줄을 집어오지 않도록
    // 줄바꿈을 제외한 가로 공백만 건너뛴다.
    const pick = (key) => {
      const m = raw.match(new RegExp(key + ":[ \\t]*(.*)", "i"));
      return m ? m[1].trim() : "";
    };
    const num = (value, fallback) => {
      const n = parseFloat(value);
      return Number.isFinite(n) ? n : fallback;
    };

    const found = /^true/i.test(pick("FOUND"));
    const coefficients = pick("COEFFICIENTS")
      .split(",")
      .map((v) => num(v, 0));
    while (coefficients.length < 3) coefficients.push(0);

    res.json({
      found,
      type: pick("TYPE").toLowerCase(),
      coefficients: coefficients.slice(0, 3),
      domainMin: num(pick("DOMAIN_MIN"), 0),
      domainMax: num(pick("DOMAIN_MAX"), 0),
      equationLabel: pick("LABEL"),
      aiAnalysis: pick("ANALYSIS"),
    });
  } catch (err) {
    handleAiError(res, err);
  }
});

const tocSchema = z.object({ text: z.string().min(1) });

// 촬영/추출한 목차 페이지 텍스트를 단원 목록으로 정리
router.post("/toc-extract", async (req, res) => {
  const parsed = tocSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  try {
    const raw = await callGemini(
      `너는 교과서 목차 페이지의 텍스트를 구조화된 목차로 정리하는 AI야. 각 항목의 단원 번호(정수, 못 찾으면 나온 순서대로 1부터 부여)와 단원 제목을 뽑아.
반드시 아래 형식 그대로 답해. 첫 줄은 항상 "UNITS:" 이고, 그 다음 줄부터 한 줄에 하나씩 "번호|제목" 형태로 써. 다른 말은 절대 덧붙이지 마.
목차로 보이지 않는 텍스트면 "UNITS:" 한 줄만 쓰고 끝내라.
UNITS:
1|단원 제목
2|단원 제목`,
      parsed.data.text
    );

    const body = raw.split(/UNITS:/i)[1] || "";
    const units = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("|"))
      .map((line) => {
        const [numPart, ...rest] = line.split("|");
        return { unitNumber: parseInt(numPart, 10), unitTitle: rest.join("|").trim() };
      })
      .filter((u) => Number.isInteger(u.unitNumber) && u.unitTitle);

    res.json({ units });
  } catch (err) {
    handleAiError(res, err);
  }
});

const matchUnitSchema = z.object({
  units: z
    .array(z.object({ unitNumber: z.number().int(), unitTitle: z.string().min(1) }))
    .min(1)
    .max(200),
  pageText: z.string().min(1),
});

// 배치 가져오기에서 각 페이지가 어느 단원에 속하는지 판단
router.post("/match-unit", async (req, res) => {
  const parsed = matchUnitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { units, pageText } = parsed.data;

  const unitList = units.map((u) => `${u.unitNumber}: ${u.unitTitle}`).join("\n");

  try {
    const raw = await callGemini(
      `너는 교과서 페이지 텍스트를 보고 아래 목차 목록 중 어느 단원에 속하는지 판단하는 AI야. 반드시 아래 목록에 있는 단원 번호 중 하나만 골라야 하며, 목록에 없는 번호를 새로 만들어내면 안 된다. 확신이 없으면 MATCHED를 false로 하고 UNIT은 0으로 해라.
반드시 아래 형식 그대로, 두 줄로만 답해. 다른 말은 절대 덧붙이지 마.
MATCHED: true 또는 false
UNIT: 단원 번호(정수)

목차 목록:
${unitList}`,
      pageText
    );

    const matchedRaw = /MATCHED:\s*true/i.test(raw);
    const unitMatch = raw.match(/UNIT:[ \t]*(-?\d+)/i);
    const unitNumber = unitMatch ? parseInt(unitMatch[1], 10) : null;
    const isKnown = unitNumber !== null && units.some((u) => u.unitNumber === unitNumber);
    const matched = matchedRaw && isKnown;

    res.json({ unitNumber: matched ? unitNumber : null, matched });
  } catch (err) {
    handleAiError(res, err);
  }
});

const matchUnitsBatchSchema = z.object({
  units: z
    .array(z.object({ unitNumber: z.number().int(), unitTitle: z.string().min(1) }))
    .min(1)
    .max(200),
  pages: z
    .array(z.object({ index: z.number().int(), text: z.string().min(1) }))
    .min(1)
    .max(60),
});

// match-unit의 여러-페이지 한 번에 버전. 하루 무료 API 요청 한도(모델당 20회)가 낮아서,
// 배치 가져오기 한 번에 페이지 수만큼 요청을 쓰던 걸 이 엔드포인트 한 번으로 줄이기 위한 것.
router.post("/match-units-batch", async (req, res) => {
  const parsed = matchUnitsBatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { units, pages } = parsed.data;

  const unitList = units.map((u) => `${u.unitNumber}: ${u.unitTitle}`).join("\n");
  const pageList = pages.map((p) => `PAGE ${p.index}:\n${p.text.slice(0, 1500)}`).join("\n\n---\n\n");

  try {
    const raw = await callGemini(
      `너는 교과서 페이지 여러 개를 한 번에 보고 각각 어느 단원에 속하는지 판단하는 AI야. 반드시 아래 목차 목록에 있는 단원 번호 중 하나만 골라야 하며, 목록에 없는 번호를 새로 만들면 안 된다. 확신이 없는 페이지는 NONE으로 답해라.
반드시 페이지마다 정확히 한 줄, "PAGE <페이지번호>: <단원번호 또는 NONE>" 형식으로만 답해. 다른 말은 절대 덧붙이지 마.

목차 목록:
${unitList}`,
      pageList
    );

    const assignments = pages.map((p) => {
      const re = new RegExp(`PAGE[ \\t]*${p.index}[ \\t]*:[ \\t]*(\\d+|NONE)`, "i");
      const m = raw.match(re);
      const val = m ? m[1] : "NONE";
      const unitNumber = /^\d+$/.test(val) && units.some((u) => u.unitNumber === parseInt(val, 10))
        ? parseInt(val, 10)
        : null;
      return { index: p.index, unitNumber, matched: unitNumber !== null };
    });

    res.json({ assignments });
  } catch (err) {
    handleAiError(res, err);
  }
});

module.exports = router;
