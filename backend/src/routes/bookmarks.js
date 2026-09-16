const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { catchAsync } = require("../utils/catchAsync");

const router = express.Router();
router.use(requireAuth);

router.get("/", catchAsync(async (req, res) => {
  const bookmarks = await prisma.bookmark.findMany({
    where: { userId: req.userId },
    include: { chapter: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({ bookmarks });
}));

const bodySchema = z.object({ chapterId: z.string().min(1) });

router.post("/", catchAsync(async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { chapterId } = parsed.data;

  const bookmark = await prisma.bookmark.upsert({
    where: { userId_chapterId: { userId: req.userId, chapterId } },
    create: { userId: req.userId, chapterId },
    update: {},
  });
  res.status(201).json({ bookmark });
}));

router.delete("/:chapterId", catchAsync(async (req, res) => {
  await prisma.bookmark.deleteMany({
    where: { userId: req.userId, chapterId: req.params.chapterId },
  });
  res.status(204).send();
}));

module.exports = router;
