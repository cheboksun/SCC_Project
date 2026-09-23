const jwt = require("jsonwebtoken");
const { prisma } = require("../db");

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "로그인이 필요해요" });
  }
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: "로그인이 만료됐어요. 다시 로그인해 주세요" });
  }

  // 토큰 서명 자체는 유효해도, 그 사이 DB가 초기화되는 등으로 사용자가 사라졌을 수 있음.
  // 이 경우를 걸러내지 않으면 쓰기 요청에서 외래 키 위반으로 알아보기 힘든 500이 난다.
  const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true } });
  if (!user) {
    return res.status(401).json({ error: "계정을 찾을 수 없어요. 다시 로그인해 주세요" });
  }

  req.userId = payload.sub;
  next();
}

module.exports = { requireAuth };
