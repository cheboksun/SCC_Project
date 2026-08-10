const express = require("express");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const { requireAuth } = require("../middleware/auth");
const { callGemini } = require("../utils/gemini");

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
      "너는 시각장애 학생을 돕는 과외 선생님이야. 학생이 이 내용을 세 번이나 다시 들었어. 원래보다 훨씬 쉽게 설명해줘.",
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
