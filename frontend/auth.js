// 로그인 화면 없이, 고정된 게스트 계정으로 조용히 로그인(없으면 자동 가입)해요.
// 백엔드(Render 무료)가 잠들어 있으면 깨어나는 데 최대 1분쯤 걸리므로,
// 그동안 빈 화면 대신 "서버 깨우는 중" 안내를 보여준다.
(function () {
  const appScreen = document.getElementById("appScreen");
  const loadingBanner = document.getElementById("loadingBanner");
  const loadingText = document.getElementById("loadingText");
  const loadingRetryBtn = document.getElementById("loadingRetryBtn");

  const GUEST_EMAIL = "guest@voxbook.local";
  const GUEST_PASSWORD = "voxbook-guest-account";
  const GUEST_NAME = "게스트";

  // 기다리는 시간이 길어질수록 문구를 바꿔서 멈춘 게 아님을 알려준다.
  const WAIT_MESSAGES = [
    [0, "서버를 깨우는 중이에요. 처음 접속하면 최대 1분쯤 걸릴 수 있어요."],
    [10000, "서버가 일어나는 중이에요… 조금만 더 기다려 주세요."],
    [30000, "거의 다 됐어요. 잠시만 기다려 주세요."],
  ];
  let waitTimers = [];

  function showLoading() {
    loadingBanner.hidden = false;
    loadingBanner.classList.remove("error");
    loadingRetryBtn.hidden = true;
    waitTimers.forEach(clearTimeout);
    waitTimers = WAIT_MESSAGES.map(([delay, msg]) =>
      setTimeout(() => { loadingText.textContent = msg; }, delay)
    );
  }

  function hideLoading() {
    waitTimers.forEach(clearTimeout);
    loadingBanner.hidden = true;
  }

  function showLoadingError() {
    waitTimers.forEach(clearTimeout);
    loadingBanner.classList.add("error");
    loadingText.textContent = "서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.";
    loadingRetryBtn.hidden = false;
    loadingRetryBtn.focus();
  }

  function showApp() {
    hideLoading();
    appScreen.hidden = false;
    window.VoxApp.initApp();
  }

  async function autoLogin() {
    if (VoxAPI.getToken() && VoxAPI.getUser()) {
      showApp();
      return;
    }
    showLoading();
    try {
      try {
        await VoxAPI.login(GUEST_EMAIL, GUEST_PASSWORD);
      } catch (err) {
        await VoxAPI.signup(GUEST_EMAIL, GUEST_PASSWORD, GUEST_NAME);
      }
    } catch (err) {
      showLoadingError();
      return;
    }
    showApp();
  }

  loadingRetryBtn.addEventListener("click", autoLogin);

  autoLogin();
})();
