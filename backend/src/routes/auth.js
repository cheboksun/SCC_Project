const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const { prisma } = require("../db");
const { catchAsync } = require("../utils/catchAsync");

const router = express.Router();

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "비밀번호는 8자 이상이어야 해요"),
  displayName: z.string().min(1).max(60).optional(),
});

function issueToken(user) {
  return jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: "30d" });
}

function toPublicUser(user) {
  return { id: user.id, email: user.email, displayName: user.displayName };
}

router.post("/signup", catchAsync(async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { email, password, displayName } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "이미 가입된 이메일이에요" });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { email, passwordHash, displayName, settings: { create: {} } },
  });

  res.status(201).json({ token: issueToken(user), user: toPublicUser(user) });
}));

router.post("/login", catchAsync(async (req, res) => {
  const parsed = credentialsSchema.pick({ email: true, password: true }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: "이메일 또는 비밀번호가 올바르지 않아요" });
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "이메일 또는 비밀번호가 올바르지 않아요" });
  }

  res.json({ token: issueToken(user), user: toPublicUser(user) });
}));

module.exports = router;
