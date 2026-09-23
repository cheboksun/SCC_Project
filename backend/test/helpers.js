const crypto = require("crypto");
const request = require("supertest");
const { app } = require("../src/app");
const { prisma } = require("../src/db");

// 이 프로젝트에는 아직 테스트 전용 DB가 없어서 개발 DB를 그대로 쓴다.
// 대신 테스트가 만든 사용자와 그에 딸린 단원만 끝나고 지운다(seed 단원은 userId=null이라 건드리지 않음).
async function createTestUser() {
  const email = `test-${crypto.randomUUID()}@voxbook.test`;
  const res = await request(app)
    .post("/api/auth/signup")
    .send({ email, password: "test-password-1234", displayName: "테스트" });
  if (res.status !== 201) {
    throw new Error(`테스트 사용자 생성 실패: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { token: res.body.token, userId: res.body.user.id, email };
}

async function deleteTestUser(userId) {
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
}

module.exports = { app, prisma, request, createTestUser, deleteTestUser };
