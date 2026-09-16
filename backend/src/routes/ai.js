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
      "너는 퀴즈 출제자야. 주어진 교과서 내용을 바탕으로, 학생이 이해했는지 확인할 수 있는 짧은 질문을 딱 하나만 만들어. 질문만 출력하고, 정답은 절대 알려주지 마.",
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

module.exports = router;
