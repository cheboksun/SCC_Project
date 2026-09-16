const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { catchAsync } = require("../utils/catchAsync");

const router = express.Router();
router.use(requireAuth);

// 기본 제공 단원(seed, userId=null) + 이 사용자가 촬영으로 추가한 단원을 함께 반환
router.get("/", catchAsync(async (req, res) => {
  const chapters = await prisma.chapter.findMany({
    where: { OR: [{ userId: null }, { userId: req.userId }] },
    orderBy: { orderIndex: "asc" },
  });
  res.json({ chapters });
}));

const createSchema = z.object({
  title: z.string().min(1).max(200),
  subject: z.string().min(1).max(20).optional(),
  bodyText: z.string().min(1),
});

// 촬영(OCR) 또는 수동으로 새 단원 추가
router.post("/", catchAsync(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { title, subject, bodyText } = parsed.data;

  const count = await prisma.chapter.count({ where: { userId: req.userId } });
  const slug = `custom${count + 1}`;

  const chapter = await prisma.chapter.create({
    data: {
      userId: req.userId,
      slug,
      title,
      subject,
      bodyText,
      source: "ocr",
      orderIndex: 1000 + count,
    },
  });
  res.status(201).json({ chapter });
}));

router.delete("/:id", catchAsync(async (req, res) => {
  const chapter = await prisma.chapter.findUnique({ where: { id: req.params.id } });
  if (!chapter || chapter.userId !== req.userId) {
    return res.status(404).json({ error: "단원을 찾을 수 없어요" });
  }
  await prisma.chapter.delete({ where: { id: chapter.id } });
  res.status(204).send();
}));

module.exports = router;
