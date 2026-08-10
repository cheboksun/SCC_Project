require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const chapterRoutes = require("./routes/chapters");
const bookmarkRoutes = require("./routes/bookmarks");
const progressRoutes = require("./routes/progress");
const aiRoutes = require("./routes/ai");

const app = express();

app.use(express.json({ limit: "2mb" }));

const origin = process.env.FRONTEND_ORIGIN;
app.use(cors(origin ? { origin } : {}));

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/chapters", chapterRoutes);
app.use("/api/bookmarks", bookmarkRoutes);
app.use("/api/progress", progressRoutes);
app.use("/api/ai", aiRoutes);

app.use((req, res) => res.status(404).json({ error: "요청한 경로를 찾을 수 없어요" }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "서버 내부 오류가 발생했어요" });
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`VoxBook API listening on http://localhost:${port}`);
});
