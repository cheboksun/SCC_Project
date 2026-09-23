const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { app, prisma, request, createTestUser, deleteTestUser } = require("./helpers");

let user;
let otherUser;

test.before(async () => {
  user = await createTestUser();
  otherUser = await createTestUser();
});

test.after(async () => {
  await deleteTestUser(user.userId);
  await deleteTestUser(otherUser.userId);
  await prisma.$disconnect();
});

function bulkBody(overrides = {}) {
  return {
    bookTitle: "테스트 교과서",
    chapters: [
      { title: "테스트 교과서 1페이지", bodyText: "첫 번째 페이지 내용", unitNumber: 1 },
      { title: "테스트 교과서 2페이지", bodyText: "두 번째 페이지 내용", unitNumber: 1 },
    ],
    ...overrides,
  };
}

test("POST /api/chapters/bulk 은 단원들을 만들고 하나의 bookId로 묶는다", async () => {
  const res = await request(app)
    .post("/api/chapters/bulk")
    .set("Authorization", `Bearer ${user.token}`)
    .send(bulkBody({ chapters: [{ title: "1페이지", bodyText: "내용", unitTitle: "1단원 분수의 덧셈" }, { title: "2페이지", bodyText: "내용2" }] }));

  assert.equal(res.status, 201);
  assert.equal(res.body.chapters.length, 2);
  const bookIds = new Set(res.body.chapters.map((c) => c.bookId));
  assert.equal(bookIds.size, 1);
  assert.ok([...bookIds][0]);
  assert.equal(res.body.chapters[0].unitTitle, "1단원 분수의 덧셈");
  assert.equal(res.body.chapters[1].unitTitle, null);
});

test("같은 importFingerprint 로 다시 가져오면 409, force 면 통과한다", async () => {
  const fingerprint = crypto.randomUUID();

  const first = await request(app)
    .post("/api/chapters/bulk")
    .set("Authorization", `Bearer ${user.token}`)
    .send(bulkBody({ importFingerprint: fingerprint }));
  assert.equal(first.status, 201);

  const second = await request(app)
    .post("/api/chapters/bulk")
    .set("Authorization", `Bearer ${user.token}`)
    .send(bulkBody({ importFingerprint: fingerprint }));
  assert.equal(second.status, 409);
  assert.equal(second.body.duplicate, true);
  assert.equal(second.body.bookId, first.body.chapters[0].bookId);
  assert.equal(second.body.bookTitle, "테스트 교과서");

  const forced = await request(app)
    .post("/api/chapters/bulk")
    .set("Authorization", `Bearer ${user.token}`)
    .send(bulkBody({ importFingerprint: fingerprint, force: true }));
  assert.equal(forced.status, 201);
  assert.notEqual(forced.body.chapters[0].bookId, first.body.chapters[0].bookId);
});

test("다른 사용자의 지문은 서로 막지 않는다", async () => {
  const fingerprint = crypto.randomUUID();

  const mine = await request(app)
    .post("/api/chapters/bulk")
    .set("Authorization", `Bearer ${user.token}`)
    .send(bulkBody({ importFingerprint: fingerprint }));
  assert.equal(mine.status, 201);

  const theirs = await request(app)
    .post("/api/chapters/bulk")
    .set("Authorization", `Bearer ${otherUser.token}`)
    .send(bulkBody({ importFingerprint: fingerprint }));
  assert.equal(theirs.status, 201);
});

test("PATCH /api/chapters/:id 로 내 단원의 unitTitle 을 정할 수 있다", async () => {
  const created = await request(app)
    .post("/api/chapters/bulk")
    .set("Authorization", `Bearer ${user.token}`)
    .send(bulkBody());
  const chapterId = created.body.chapters[0].id;

  const res = await request(app)
    .patch(`/api/chapters/${chapterId}`)
    .set("Authorization", `Bearer ${user.token}`)
    .send({ unitTitle: "2단원 소수의 곱셈", unitNumber: 2, needsReview: false });

  assert.equal(res.status, 200);
  assert.equal(res.body.chapter.unitTitle, "2단원 소수의 곱셈");
  assert.equal(res.body.chapter.unitNumber, 2);
  assert.equal(res.body.chapter.needsReview, false);
});

test("남의 단원과 기본 제공 단원은 PATCH 로 수정할 수 없다", async () => {
  const theirs = await request(app)
    .post("/api/chapters/bulk")
    .set("Authorization", `Bearer ${otherUser.token}`)
    .send(bulkBody());
  const theirChapterId = theirs.body.chapters[0].id;

  const forbidden = await request(app)
    .patch(`/api/chapters/${theirChapterId}`)
    .set("Authorization", `Bearer ${user.token}`)
    .send({ unitTitle: "몰래 바꾸기" });
  assert.equal(forbidden.status, 404);

  const seed = await prisma.chapter.findFirst({ where: { userId: null } });
  assert.ok(seed, "기본 제공 단원(seed)이 DB에 있어야 이 테스트가 의미가 있어요");

  const seedRes = await request(app)
    .patch(`/api/chapters/${seed.id}`)
    .set("Authorization", `Bearer ${user.token}`)
    .send({ unitTitle: "기본 단원 바꾸기" });
  assert.equal(seedRes.status, 404);
});

test("GET /api/chapters 는 기본 제공 단원과 내 단원을 함께 돌려준다", async () => {
  await request(app)
    .post("/api/chapters/bulk")
    .set("Authorization", `Bearer ${user.token}`)
    .send(bulkBody());

  const res = await request(app)
    .get("/api/chapters")
    .set("Authorization", `Bearer ${user.token}`);

  assert.equal(res.status, 200);
  const userIds = new Set(res.body.chapters.map((c) => c.userId));
  assert.ok(userIds.has(null), "기본 제공 단원이 포함돼야 해요");
  assert.ok(userIds.has(user.userId), "내 단원이 포함돼야 해요");
  assert.ok(!userIds.has(otherUser.userId), "다른 사용자의 단원은 없어야 해요");
});
