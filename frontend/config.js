// 배포 환경에 맞게 이 값만 바꾸면 됩니다.
// 로컬 개발: http://localhost:4000
// 배포 후: 백엔드가 올라간 실제 주소 (예: https://voxbook-api.onrender.com)
window.VOXBOOK_API_BASE =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:4000"
    : "https://voxbook-api.onrender.com";
