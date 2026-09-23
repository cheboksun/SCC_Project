// async 라우트 핸들러에서 던진 에러(예: DB 연결 실패)가 unhandled rejection으로
// 새어나가 프로세스 전체를 죽이는 것을 막고, Express 에러 미들웨어로 넘김.
function catchAsync(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { catchAsync };
