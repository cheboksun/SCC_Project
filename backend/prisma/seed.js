const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const seedChapters = [
  {
    slug: "ch1",
    title: "1. 원의 뜻",
    subject: "수학",
    orderIndex: 1,
    bodyText:
      "원은 한 점에서 같은 거리에 있는 점들을 모두 이은 도형입니다. 이 한 점을 원의 중심이라고 부릅니다. 중심에서 원 위의 한 점까지의 거리는 항상 똑같은데, 이 거리를 반지름이라고 합니다. 예를 들어 훌라후프를 떠올리면, 훌라후프의 한가운데가 중심이고, 그 중심에서 훌라후프 테두리까지의 거리가 반지름입니다. 반지름이 길수록 원은 더 커지고, 짧을수록 더 작아집니다. 원의 중심을 지나면서 양쪽 끝이 원 위에 닿는 선분은 지름이라고 하며, 지름은 항상 반지름의 두 배입니다.",
  },
  {
    slug: "ch2",
    title: "2. 원의 넓이",
    subject: "수학",
    orderIndex: 2,
    bodyText:
      "원의 넓이는 반지름 곱하기 반지름 곱하기 원주율로 구합니다. 원주율은 원의 둘레가 지름의 몇 배인지를 나타내는 값으로, 약 3.14입니다. 반지름이 5센티미터인 원이 있다면, 5 곱하기 5는 25, 25 곱하기 3.14는 78.5이므로 이 원의 넓이는 78.5제곱센티미터입니다.",
  },
  {
    slug: "ch3",
    title: "3. 연습 문제",
    subject: "수학",
    orderIndex: 3,
    bodyText:
      "반지름이 10센티미터인 원의 넓이를 구해 보세요. 반지름 곱하기 반지름 곱하기 원주율을 순서대로 계산하면서, 풀이 과정을 소리 내어 말해 보세요. (정답: 314제곱센티미터)",
  },
  {
    slug: "ch4",
    title: "4. 수식 변환",
    subject: "수학",
    orderIndex: 4,
    bodyText: "루트 x의 제곱 더하기 1",
  },
  {
    slug: "ch5",
    title: "5. 중세 국어",
    subject: "국어",
    orderIndex: 5,
    bodyText: "(현대어 풀이: 뿌리 깊은 나무는 바람에 흔들리지 않으므로)",
  },
  {
    slug: "ch6",
    title: "6. 그래프 촉각 탐색",
    subject: "수학",
    orderIndex: 6,
    bodyText:
      "반지름이 커질수록 원의 넓이는 점점 더 빠르게 늘어나요. 처음엔 완만하게 올라가다가, 오른쪽으로 갈수록 곡선이 가파르게 휘어져요.",
  },
  {
    slug: "ch7",
    title: "7. 원의 둘레",
    subject: "수학",
    orderIndex: 7,
    bodyText:
      "원의 둘레는 원 테두리를 따라 한 바퀴 도는 거리를 말합니다. 원의 둘레는 지름 곱하기 원주율로 구합니다. 반지름이 5센티미터인 원이라면 지름은 10센티미터이고, 10 곱하기 3.14는 31.4이므로 이 원의 둘레는 31.4센티미터입니다.",
  },
  {
    slug: "ch8",
    title: "8. 부채꼴의 넓이",
    subject: "수학",
    orderIndex: 8,
    bodyText:
      "부채꼴은 원의 일부분으로, 피자 한 조각처럼 생긴 모양입니다. 부채꼴의 넓이는 원 전체의 넓이에 중심각을 360도로 나눈 비율을 곱해서 구합니다. 반지름 6센티미터, 중심각 90도인 부채꼴의 넓이는 113.04를 4로 나눈 28.26제곱센티미터입니다.",
  },
  {
    slug: "ch9",
    title: "9. 원기둥의 부피",
    subject: "수학",
    orderIndex: 9,
    bodyText:
      "원기둥의 부피는 밑면인 원의 넓이에 높이를 곱해서 구합니다. 밑면 반지름 3센티미터, 높이 10센티미터인 원기둥의 부피는 28.26 곱하기 10인 282.6세제곱센티미터입니다.",
  },
];

async function main() {
  // Prisma는 nullable 컬럼이 낀 복합 unique(where)에 null을 직접 못 받아들여서
  // upsert 대신 findFirst로 직접 존재 여부를 확인.
  for (const ch of seedChapters) {
    const existing = await prisma.chapter.findFirst({
      where: { userId: null, slug: ch.slug },
    });
    if (existing) {
      await prisma.chapter.update({ where: { id: existing.id }, data: { ...ch } });
    } else {
      await prisma.chapter.create({ data: { ...ch, userId: null, source: "seed" } });
    }
  }
  console.log(`Seeded ${seedChapters.length} default chapters.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
