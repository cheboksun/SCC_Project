const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { catchAsync } = require("../utils/catchAsync");

const router = express.Router();
router.use(requireAuth);

const replaySchema = z.object({ chapterId: z.string().min(1) });

// 재생할 때마다 호출. 같은 단원을 몇 번째 듣는지 반환해서
// 프론트가 3번째부터 "더 쉽게 설명" 트리거를 판단할 수 있게 함
router.post("/replay", catchAsync(async (req, res) => {
  const parsed = replaySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { chapterId } = parsed.data;

  await prisma.replayLog.create({ data: { userId: req.userId, chapterId } });
  const replayCount = await prisma.replayLog.count({
    where: { userId: req.userId, chapterId },
  });
  res.status(201).json({ replayCount });
}));

const quizSchema = z.object({
  chapterId: z.string().min(1),
  question: z.string().min(1),
  answer: z.string().min(1),
  isCorrect: z.boolean().nullable().optional(),
  feedback: z.string().optional(),
});

router.post("/quiz", catchAsync(async (req, res) => {
  const parsed = quizSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const attempt = await prisma.quizAttempt.create({
    data: { userId: req.userId, ...parsed.data },
  });
  res.status(201).json({ attempt });
}));

// 학부모/교사용 요약 리포트: 단원별 재청취 횟수 + 퀴즈 정답률
router.get("/summary", catchAsync(async (req, res) => {
  const [replays, quizzes] = await Promise.all([
    prisma.replayLog.groupBy({
      by: ["chapterId"],
      where: { userId: req.userId },
      _count: { chapterId: true },
    }),
    prisma.quizAttempt.findMany({
      where: { userId: req.userId },
      select: { chapterId: true, isCorrect: true },
    }),
  ]);

  const quizByChapter = {};
  for (const q of quizzes) {
    quizByChapter[q.chapterId] ||= { total: 0, correct: 0 };
    quizByChapter[q.chapterId].total += 1;
    if (q.isCorrect) quizByChapter[q.chapterId].correct += 1;
  }

  res.json({
    replayCounts: replays.map((r) => ({ chapterId: r.chapterId, count: r._count.chapterId })),
    quizStats: Object.entries(quizByChapter).map(([chapterId, s]) => ({ chapterId, ...s })),
  });
}));

module.exports = router;
