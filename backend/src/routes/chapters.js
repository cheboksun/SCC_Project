const crypto = require("crypto");
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

const bulkSchema = z.object({
  bookTitle: z.string().min(1).max(200).optional(),
  importFingerprint: z.string().min(1).max(128).nullish(),
  force: z.boolean().optional(),
  chapters: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        subject: z.string().min(1).max(20).nullish(),
        bodyText: z.string().min(1),
        unitNumber: z.number().int().nullish(),
        unitTitle: z.string().max(200).nullish(),
        needsReview: z.boolean().optional(),
        reviewReason: z.string().max(100).nullish(),
      })
    )
    .min(1)
    .max(500),
});

// 여러 페이지 넣기(PDF/이미지 배치 가져오기)에서 한 번에 여러 단원을 저장할 때 사용.
// 이 요청 한 번에 들어온 항목들을 전부 같은 "책"으로 취급해서 bookId를 서버에서 한 번만 생성해 붙인다.
// 그래야 같은 과목·단원번호를 쓰는 다른 책을 나중에 또 가져와도 페이지가 서로 섞이지 않는다.
router.post("/bulk", catchAsync(async (req, res) => {
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { chapters: items, bookTitle, importFingerprint, force } = parsed.data;

  // 같은 파일을 실수로 두 번 가져오는 경우를 막는다. 일부러 다시 넣고 싶으면 force로 넘어올 수 있음
  if (importFingerprint && force !== true) {
    const existing = await prisma.chapter.findFirst({
      where: { userId: req.userId, importFingerprint },
    });
    if (existing) {
      return res.status(409).json({
        error: "이미 가져온 파일과 같아 보여요",
        duplicate: true,
        bookId: existing.bookId,
        bookTitle: existing.bookTitle,
      });
    }
  }

  const bookId = crypto.randomUUID();

  // slug/orderIndex 카운터는 한 번만 읽고 항목마다 증가시켜야 유니크 제약에 걸리지 않음
  const count = await prisma.chapter.count({ where: { userId: req.userId } });

  const chapters = await prisma.$transaction(
    items.map((item, i) =>
      prisma.chapter.create({
        data: {
          userId: req.userId,
          slug: `custom${count + i + 1}`,
          title: item.title,
          subject: item.subject ?? null,
          bodyText: item.bodyText,
          source: "ocr",
          orderIndex: 1000 + count + i,
          unitNumber: item.unitNumber ?? null,
          unitTitle: item.unitTitle ?? null,
          needsReview: item.needsReview ?? false,
          reviewReason: item.reviewReason ?? null,
          bookId,
          bookTitle: bookTitle ?? null,
          importFingerprint: importFingerprint ?? null,
        },
      })
    )
  );
  res.status(201).json({ chapters });
}));

const patchSchema = z
  .object({
    bodyText: z.string().min(1).optional(),
    subject: z.string().min(1).max(20).nullish(),
    unitNumber: z.number().int().nullish(),
    unitTitle: z.string().max(200).nullish(),
    needsReview: z.boolean().optional(),
    reviewReason: z.string().max(100).nullish(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "수정할 항목이 없어요" });

router.patch("/:id", catchAsync(async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  // 기본 제공 단원(userId=null)은 사용자가 수정할 수 없음
  const existing = await prisma.chapter.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.userId !== req.userId) {
    return res.status(404).json({ error: "단원을 찾을 수 없어요" });
  }
  const chapter = await prisma.chapter.update({
    where: { id: existing.id },
    data: parsed.data,
  });
  res.json({ chapter });
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
