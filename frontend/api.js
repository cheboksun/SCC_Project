// VoxBook 백엔드 API 클라이언트. JWT 토큰을 localStorage(voxbook_token)에 보관하고
// 모든 요청에 Authorization 헤더로 실어 보냄.
const VoxAPI = (() => {
  const BASE = window.VOXBOOK_API_BASE;
  const TOKEN_KEY = "voxbook_token";
  const USER_KEY = "voxbook_user";

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }
  function setSession(token, user) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch (e) {}
  }
  function clearSession() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch (e) {}
  }
  function getUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  async function request(path, options = {}) {
    const token = getToken();
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (token) headers.Authorization = "Bearer " + token;

    let response;
    try {
      response = await fetch(BASE + path, { ...options, headers });
    } catch (networkErr) {
      throw new Error("서버에 연결할 수 없어요. 네트워크를 확인해 주세요.");
    }

    if (response.status === 204) return null;

    let data;
    try {
      data = await response.json();
    } catch (e) {
      throw new Error("서버 응답을 해석하지 못했어요 (status " + response.status + ")");
    }

    if (!response.ok) {
      if (response.status === 401) clearSession();
      throw new Error(data.error || "요청이 실패했어요 (status " + response.status + ")");
    }
    return data;
  }

  return {
    getToken, getUser, clearSession,

    signup: (email, password, displayName) =>
      request("/api/auth/signup", { method: "POST", body: JSON.stringify({ email, password, displayName }) })
        .then((d) => { setSession(d.token, d.user); return d.user; }),

    login: (email, password) =>
      request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) })
        .then((d) => { setSession(d.token, d.user); return d.user; }),

    listChapters: () => request("/api/chapters").then((d) => d.chapters),

    addChapter: (title, subject, bodyText) =>
      request("/api/chapters", { method: "POST", body: JSON.stringify({ title, subject, bodyText }) })
        .then((d) => d.chapter),

    updateChapter: (id, patch) =>
      request("/api/chapters/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify(patch) })
        .then((d) => d.chapter),
    addChaptersBulk: (chapters, bookTitle) =>
      request("/api/chapters/bulk", { method: "POST", body: JSON.stringify({ chapters, bookTitle }) })
        .then((d) => d.chapters),

    listBookmarks: () => request("/api/bookmarks").then((d) => d.bookmarks),
    addBookmark: (chapterId) =>
      request("/api/bookmarks", { method: "POST", body: JSON.stringify({ chapterId }) }),
    removeBookmark: (chapterId) =>
      request("/api/bookmarks/" + encodeURIComponent(chapterId), { method: "DELETE" }),

    logReplay: (chapterId) =>
      request("/api/progress/replay", { method: "POST", body: JSON.stringify({ chapterId }) })
        .then((d) => d.replayCount),
    logQuizAttempt: (payload) =>
      request("/api/progress/quiz", { method: "POST", body: JSON.stringify(payload) }),
    getProgressSummary: () => request("/api/progress/summary"),

    aiOcr: (imageBase64, mimeType) =>
      request("/api/ai/ocr", { method: "POST", body: JSON.stringify({ imageBase64, mimeType }) }),

    aiTutor: (chapterTitle, chapterText, question) =>
      request("/api/ai/tutor", { method: "POST", body: JSON.stringify({ chapterTitle, chapterText, question }) })
        .then((d) => d.answer),
    aiSimplify: (chapterTitle, chapterText) =>
      request("/api/ai/simplify", { method: "POST", body: JSON.stringify({ chapterTitle, chapterText }) })
        .then((d) => d.easier),
    aiDetectSubject: (text) =>
      request("/api/ai/subject-detect", { method: "POST", body: JSON.stringify({ text }) })
        .then((d) => d.subject),
    aiGenerateQuiz: (chapterTitle, chapterText) =>
      request("/api/ai/quiz/generate", { method: "POST", body: JSON.stringify({ chapterTitle, chapterText }) })
        .then((d) => d.question),
    aiGradeQuiz: (question, chapterText, studentAnswer) =>
      request("/api/ai/quiz/grade", { method: "POST", body: JSON.stringify({ question, chapterText, studentAnswer }) }),

    aiParseGraphEquation: (text) =>
      request("/api/ai/graph-equation", { method: "POST", body: JSON.stringify({ text }) }),
    aiExtractToc: (text) =>
      request("/api/ai/toc-extract", { method: "POST", body: JSON.stringify({ text }) })
        .then((d) => d.units),
    aiMatchUnit: (units, pageText) =>
      request("/api/ai/match-unit", { method: "POST", body: JSON.stringify({ units, pageText }) }),
    aiMatchUnitsBatch: (units, pages) =>
      request("/api/ai/match-units-batch", { method: "POST", body: JSON.stringify({ units, pages }) })
        .then((d) => d.assignments),
  };
})();
