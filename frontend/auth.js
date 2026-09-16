// 로그인 화면 없이, 고정된 게스트 계정으로 조용히 로그인(없으면 자동 가입)해요.
(function () {
  const appScreen = document.getElementById("appScreen");

  const GUEST_EMAIL = "guest@voxbook.local";
  const GUEST_PASSWORD = "voxbook-guest-account";
  const GUEST_NAME = "게스트";

  function showApp() {
    appScreen.hidden = false;
    window.VoxApp.initApp();
  }

  async function autoLogin() {
    if (VoxAPI.getToken() && VoxAPI.getUser()) {
      showApp();
      return;
    }
    try {
      await VoxAPI.login(GUEST_EMAIL, GUEST_PASSWORD);
    } catch (err) {
      await VoxAPI.signup(GUEST_EMAIL, GUEST_PASSWORD, GUEST_NAME);
    }
    showApp();
  }

  autoLogin();
})();
