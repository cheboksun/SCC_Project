(function () {
  const $ = (id) => document.getElementById(id);
  const authScreen = $("authScreen");
  const appScreen = $("appScreen");
  const authTitle = $("authTitle");
  const authLead = $("authLead");
  const authSubmitBtn = $("authSubmitBtn");
  const authSwitchBtn = $("authSwitchBtn");
  const authError = $("authError");
  const displayNameField = $("displayNameField");
  const userChipName = $("userChipName");

  let mode = "login"; // login | signup

  function renderMode() {
    authError.textContent = "";
    if (mode === "login") {
      authTitle.textContent = "로그인";
      authLead.textContent = "같이보는 교과서에 오신 걸 환영해요";
      authSubmitBtn.textContent = "로그인";
      authSwitchBtn.textContent = "계정이 없으신가요? 회원가입";
      displayNameField.hidden = true;
    } else {
      authTitle.textContent = "회원가입";
      authLead.textContent = "몇 초면 계정을 만들 수 있어요";
      authSubmitBtn.textContent = "회원가입";
      authSwitchBtn.textContent = "이미 계정이 있으신가요? 로그인";
      displayNameField.hidden = false;
    }
  }

  authSwitchBtn.addEventListener("click", () => {
    mode = mode === "login" ? "signup" : "login";
    renderMode();
  });

  function showApp(user) {
    authScreen.hidden = true;
    appScreen.hidden = false;
    $("userChip").hidden = false;
    userChipName.textContent = user.displayName || user.email;
    window.VoxApp.initApp();
  }

  $("authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    authError.textContent = "";
    authSubmitBtn.disabled = true;
    const email = $("authEmail").value.trim();
    const password = $("authPassword").value;
    const displayName = $("authDisplayName").value.trim();
    try {
      const user =
        mode === "login"
          ? await VoxAPI.login(email, password)
          : await VoxAPI.signup(email, password, displayName || undefined);
      showApp(user);
    } catch (err) {
      authError.textContent = err.message;
    } finally {
      authSubmitBtn.disabled = false;
    }
  });

  $("logoutBtn").addEventListener("click", () => {
    VoxAPI.clearSession();
    window.location.reload();
  });

  renderMode();

  const existingUser = VoxAPI.getUser();
  if (VoxAPI.getToken() && existingUser) {
    showApp(existingUser);
  }
})();
