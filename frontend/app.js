// 수식 -> 한국어 낭독 변환기 (원본 프로토타입에서 그대로 이식)
function mathToSpeech(expr) {
  function tokenize(s) {
    const tokens = []; let i = 0; s = s.replace(/\s+/g, "");
    while (i < s.length) {
      const c = s[i];
      if ("+-*/^(),".includes(c)) { tokens.push(c); i++; }
      else if (/[a-zA-Z가-힣]/.test(c)) {
        let j = i; while (j < s.length && /[a-zA-Z0-9가-힣]/.test(s[j])) j++;
        tokens.push(s.slice(i, j)); i = j;
      } else if (/[0-9.]/.test(c)) {
        let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++;
        tokens.push(s.slice(i, j)); i = j;
      } else { i++; }
    }
    return tokens;
  }
  class Parser {
    constructor(t) { this.tokens = t; this.pos = 0; }
    peek() { return this.tokens[this.pos]; }
    next() { return this.tokens[this.pos++]; }
    parseExpr() {
      let n = this.parseTerm();
      while (this.peek() === "+" || this.peek() === "-") {
        const op = this.next(); n = { type: op === "+" ? "add" : "sub", left: n, right: this.parseTerm() };
      }
      return n;
    }
    parseTerm() {
      let n = this.parsePow();
      while (this.peek() === "*" || this.peek() === "/") {
        const op = this.next(); n = { type: op === "*" ? "mul" : "div", left: n, right: this.parsePow() };
      }
      return n;
    }
    parsePow() {
      let n = this.parseAtom();
      if (this.peek() === "^") { this.next(); n = { type: "pow", base: n, exp: this.parseAtom() }; }
      return n;
    }
    parseAtom() {
      const tok = this.peek();
      if (tok === "(") { this.next(); const n = this.parseExpr(); this.next(); return { type: "group", inner: n }; }
      if (tok === "sqrt") { this.next(); this.next(); const inner = this.parseExpr(); this.next(); return { type: "sqrt", inner }; }
      if (tok === "frac") { this.next(); this.next(); const num = this.parseExpr(); this.next(); const den = this.parseExpr(); this.next(); return { type: "frac", num, den }; }
      this.next(); return { type: "value", token: tok };
    }
  }
  function toKorean(n) {
    switch (n.type) {
      case "value": return n.token;
      case "add": return `${toKorean(n.left)} 더하기 ${toKorean(n.right)}`;
      case "sub": return `${toKorean(n.left)} 빼기 ${toKorean(n.right)}`;
      case "mul": return `${toKorean(n.left)} 곱하기 ${toKorean(n.right)}`;
      case "div": return `${toKorean(n.left)} 나누기 ${toKorean(n.right)}`;
      case "pow":
        if (n.exp.type === "value" && n.exp.token === "2") return `${toKorean(n.base)}의 제곱`;
        if (n.exp.type === "value" && n.exp.token === "3") return `${toKorean(n.base)}의 세제곱`;
        return `${toKorean(n.base)}의 ${toKorean(n.exp)}제곱`;
      case "sqrt": return `루트 ${toKorean(n.inner)}`;
      case "frac": return `${toKorean(n.den)}분의 ${toKorean(n.num)}`;
      case "group": return toKorean(n.inner);
      default: return "";
    }
  }
  return toKorean(new Parser(tokenize(expr)).parseExpr());
}

// 시드 단원 중 두 개는 화면에 부가 UI가 필요한 데모 기능을 가짐 (수식 원문 표기 / 고전 원문)
const SPECIAL_BY_SLUG = {
  ch4: { formula: "sqrt(x^2+1)" },
  ch5: { original: "불휘 기픈 남ᄀᆞᆫ ᄇᆞᄅᆞ매 아니 뮐ᄊᆡ" },
};

(function () {
  const $ = (id) => document.getElementById(id);
  const toast = $("toast");
  const modeIndicator = $("modeIndicator");
  const nowPlaying = $("nowPlaying");
  const playBtn = $("playBtn");

  const state = {
    chapters: [],       // [{id, slug, title, subject, bodyText, source}]
    bookmarkIds: new Set(),
    currentId: null,
    mode: localStorage.getItem("voxbook_mode") || "sound",
    speechRate: parseFloat(localStorage.getItem("voxbook_rate") || "1.0"),
    isPlaying: false,
    hasRecording: false,
  };

  function chapterById(id) { return state.chapters.find((c) => c.id === id); }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1400);
  }

  function vibrate(pattern) {
    if ((state.mode === "vibe" || state.mode === "both") && navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  }

  function stopSpeaking() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  function speak(text) {
    if (state.mode === "vibe") return;
    if (!("speechSynthesis" in window)) {
      showToast("이 기기는 음성 재생을 지원하지 않아요");
      return;
    }
    stopSpeaking();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ko-KR";
    u.rate = state.speechRate;
    window.speechSynthesis.speak(u);
  }

  function playEarcon(chapter) {
    if (state.mode === "vibe") return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const idx = state.chapters.indexOf(chapter);
      let freq = 440 + (idx % 5) * 60;
      if (chapter.slug === "ch4") freq = 720;
      if (chapter.slug === "ch5") freq = 300;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.2);
    } catch (e) {}
  }

  function openDetailView() {
    $("content").classList.add("open");
    $("backToListBtn").style.display = "inline-block";
    document.querySelector(".toc.grid-cards").style.display = "none";
  }
  function closeDetailView() {
    $("content").classList.remove("open");
    $("backToListBtn").style.display = "none";
    document.querySelector(".toc.grid-cards").style.display = "grid";
  }

  function getPreviewFor(chapter) {
    if (chapter.slug === "ch4") return "수식을 낭독 순서 문장으로 자동 변환해서 들려줘요";
    if (chapter.slug === "ch6") return "손가락으로 그래프를 만져서 진동으로 탐색해요";
    const t = (chapter.bodyText || "").trim();
    return t.length > 40 ? t.slice(0, 40) + "…" : t;
  }

  function renderTocCard(chapter) {
    const btn = document.createElement("button");
    btn.dataset.id = chapter.id;
    btn.setAttribute("aria-current", "false");
    btn.innerHTML = `
      <span class="card-subject">${chapter.subject || (chapter.source === "ocr" ? "촬영" : "")}</span>
      <span class="card-title">${chapter.title}</span>
      <span class="card-preview">${getPreviewFor(chapter)}</span>`;
    btn.addEventListener("click", () => setCurrentChapter(chapter.id));
    return btn;
  }

  function renderChapterSection(chapter) {
    const section = document.createElement("section");
    section.className = "chapter";
    section.id = "chapter-" + chapter.id;
    section.tabIndex = -1;
    section.dataset.id = chapter.id;

    const bookmarked = state.bookmarkIds.has(chapter.id);
    let extra = "";
    if (chapter.slug === "ch4") {
      extra = `<p>화면에 보이는 수식 표기: <code>${SPECIAL_BY_SLUG.ch4.formula}</code></p>
        <div class="guide-line">↑ 수식을 "읽는 순서" 문장으로 자동 변환한 결과예요</div>`;
    } else if (chapter.slug === "ch5") {
      extra = `<p style="font-size:15.5px;">${SPECIAL_BY_SLUG.ch5.original}</p>`;
    }

    section.innerHTML = `
      <span class="eyebrow">${chapter.subject || (chapter.source === "ocr" ? "촬영으로 추가됨" : "")}</span>
      <h2>${chapter.title}</h2>
      ${extra}
      <p class="chapter-body">${chapter.slug === "ch5" ? "(현대어 풀이: " + chapter.bodyText + ")" : chapter.bodyText}</p>
      <div class="row-actions">
        <button class="icon-btn play-this" data-id="${chapter.id}">▶ 이 부분 듣기</button>
        <button class="icon-btn bookmark-btn" data-id="${chapter.id}" aria-pressed="${bookmarked}">${bookmarked ? "★ 북마크됨" : "☆ 북마크"}</button>
        ${chapter.slug === "ch5" ? `<button class="icon-btn" id="toggleRecording">🎙 녹음 있음/없음 전환 (데모)</button>` : ""}
      </div>
      ${chapter.slug === "ch5" ? `<div class="guide-line" id="ch5-status">지금 상태: 사람 녹음 없음 → 현대어 풀이를 음성으로 재생함</div>` : ""}
      ${chapter.slug === "ch6" ? renderGraphBlockHtml() : ""}
    `;
    return section;
  }

  function renderGraphBlockHtml() {
    return `
      <canvas id="graphCanvas" width="600" height="300"
        style="width:100%;height:220px;touch-action:none;background:var(--surface-2);border-radius:10px;display:block;margin-top:10px;"
        aria-hidden="true"></canvas>
      <div class="guide-line" id="graphStatus">아직 손가락을 대지 않았어요</div>
      <div class="row-actions" style="margin-top:8px;">
        <button class="icon-btn" id="graphDescribeBtn">🔊 이 그래프 설명 듣기</button>
        <button class="icon-btn" id="graphStepBtn">🔊 화면리더용: 단계별로 순서대로 듣기</button>
      </div>`;
  }

  function renderAllChapters() {
    const tocEl = document.querySelector(".toc.grid-cards");
    const contentEl = $("content");
    tocEl.innerHTML = "";
    contentEl.innerHTML = "";
    state.chapters.forEach((chapter) => {
      tocEl.appendChild(renderTocCard(chapter));
      contentEl.appendChild(renderChapterSection(chapter));
    });
    wireDynamicHandlers();
    if (state.chapters[0]) setCurrentChapter(state.chapters[0].id, { silent: true });
  }

  function wireDynamicHandlers() {
    document.querySelectorAll(".play-this").forEach((btn) => {
      btn.onclick = () => playChapter(btn.dataset.id);
    });
    document.querySelectorAll(".bookmark-btn").forEach((btn) => {
      btn.onclick = () => toggleBookmark(btn.dataset.id, btn);
    });
    const toggleRec = $("toggleRecording");
    if (toggleRec) {
      toggleRec.onclick = () => {
        state.hasRecording = !state.hasRecording;
        const statusEl = $("ch5-status");
        statusEl.textContent = state.hasRecording
          ? "지금 상태: 사람 녹음 있음 → 실제 옛 발음 녹음을 재생함"
          : "지금 상태: 사람 녹음 없음 → 현대어 풀이를 음성으로 재생함";
        showToast(state.hasRecording ? "녹음 있음으로 전환" : "녹음 없음으로 전환");
        vibrate(30);
      };
    }
    if ($("graphCanvas")) setupGraphCanvas();
  }

  function setCurrentChapter(id, opts = {}) {
    state.currentId = id;
    const chapter = chapterById(id);
    document.querySelectorAll("section.chapter").forEach((s) => s.classList.remove("current"));
    const sectionEl = $("chapter-" + id);
    if (sectionEl) sectionEl.classList.add("current");
    document.querySelectorAll(".toc.grid-cards button").forEach((b) => {
      b.setAttribute("aria-current", b.dataset.id === id ? "true" : "false");
    });
    nowPlaying.textContent = chapter ? chapter.title : "";
    if (!opts.silent) {
      openDetailView();
      vibrate(20);
      playEarcon(chapter);
      if (sectionEl) {
        sectionEl.focus({ preventScroll: false });
        sectionEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }

  async function playChapter(id) {
    const chapter = chapterById(id);
    if (!chapter) return;
    setCurrentChapter(id);

    if (chapter.slug === "ch5") {
      if (state.hasRecording) {
        showToast("사람이 녹음한 원문 발음 재생 중 (시뮬레이션)");
        speak(SPECIAL_BY_SLUG.ch5.original + " 라는 원문을, 국어 선생님이 녹음한 정확한 발음으로 들려드립니다.");
      } else {
        showToast("녹음이 없어 현대어 풀이로 대신 재생함");
        speak(chapter.bodyText);
      }
    } else if (chapter.slug === "ch4") {
      const spoken = mathToSpeech(SPECIAL_BY_SLUG.ch4.formula);
      speak(spoken);
    } else {
      speak(chapter.bodyText);
    }

    state.isPlaying = true;
    playBtn.textContent = "⏸";
    playBtn.setAttribute("aria-label", "일시정지");
    vibrate([15, 40, 15]);

    try {
      const replayCount = await VoxAPI.logReplay(id);
      if (replayCount === 3) {
        setTimeout(async () => {
          showToast("여러 번 다시 들으셨네요. 더 쉽게 설명해드릴게요");
          vibrate([10, 30, 10, 30, 10]);
          try {
            const easier = await VoxAPI.aiSimplify(chapter.title, chapter.bodyText);
            if (easier) speak(easier);
          } catch (e) {}
        }, 4500);
      }
    } catch (e) { /* 진도 기록 실패는 재생 경험을 막지 않음 */ }
  }

  async function toggleBookmark(id, btn) {
    const chapter = chapterById(id);
    const pressed = btn.getAttribute("aria-pressed") === "true";
    try {
      if (pressed) {
        await VoxAPI.removeBookmark(id);
        state.bookmarkIds.delete(id);
        btn.setAttribute("aria-pressed", "false");
        btn.textContent = "☆ 북마크";
        showToast("북마크 해제됨");
      } else {
        await VoxAPI.addBookmark(id);
        state.bookmarkIds.add(id);
        btn.setAttribute("aria-pressed", "true");
        btn.textContent = "★ 북마크됨";
        showToast((chapter ? chapter.title : "") + " 북마크됨");
      }
      vibrate(state.mode === "sound" ? [] : [10, 30, 10, 30, 10]);
    } catch (e) {
      showToast("북마크 저장에 실패했어요");
    }
  }

  // ---- 목차/뒤로가기 ----
  $("backToListBtn").addEventListener("click", () => { closeDetailView(); vibrate(15); });

  // ---- 재생 컨트롤 ----
  playBtn.addEventListener("click", () => {
    if (state.isPlaying) {
      stopSpeaking();
      state.isPlaying = false;
      playBtn.textContent = "▶";
      playBtn.setAttribute("aria-label", "재생");
    } else if (state.currentId) {
      playChapter(state.currentId);
    }
  });
  $("prevBtn").addEventListener("click", () => {
    const i = state.chapters.findIndex((c) => c.id === state.currentId);
    const next = state.chapters[(i - 1 + state.chapters.length) % state.chapters.length];
    if (next) playChapter(next.id);
  });
  $("nextBtn").addEventListener("click", () => {
    const i = state.chapters.findIndex((c) => c.id === state.currentId);
    const next = state.chapters[(i + 1) % state.chapters.length];
    if (next) playChapter(next.id);
  });
  $("bookmarkJump").addEventListener("click", () => {
    if (state.bookmarkIds.size === 0) {
      showToast("북마크한 곳이 없어요");
      vibrate(200);
      return;
    }
    const firstId = [...state.bookmarkIds][0];
    setCurrentChapter(firstId);
    const chapter = chapterById(firstId);
    showToast((chapter ? chapter.title : "") + "(으)로 이동");
  });

  // ---- 검색 이동 ----
  function doJump() {
    const q = $("jumpInput").value.trim();
    if (!q) return;
    const found = state.chapters.find(
      (c) => c.title.includes(q) || (c.bodyText || "").includes(q)
    );
    if (found) {
      setCurrentChapter(found.id);
      showToast(found.title + "(으)로 이동했어요");
    } else {
      showToast("찾는 내용이 없어요");
      vibrate(200);
    }
  }
  $("jumpBtn").addEventListener("click", doJump);
  $("jumpInput").addEventListener("keydown", (e) => { if (e.key === "Enter") doJump(); });

  // ---- 출력 방식 ----
  document.querySelectorAll(".seg button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", "false"));
      btn.setAttribute("aria-pressed", "true");
      state.mode = btn.dataset.mode;
      localStorage.setItem("voxbook_mode", state.mode);
      modeIndicator.textContent = btn.textContent;
      showToast(btn.textContent + " 모드로 변경됨");
      vibrate(30);
    });
  });

  // ---- 촬영 -> OCR -> 백엔드에 단원으로 추가 ----
  const guideLine = $("guideLine");
  const cameraVideo = $("cameraVideo");
  const captureCanvas = $("captureCanvas");
  const cameraStartBtn = $("cameraStartBtn");
  const shutterBtn = $("shutterBtn");
  const ocrResultBox = $("ocrResultBox");
  const ocrResultText = $("ocrResultText");
  const subjectBox = $("subjectBox");
  let mediaStream = null;
  let detectedSubject = null;
  const SUBJECT_LIST = ["수학", "국어", "영어", "사회", "과학"];

  const fileCaptureBtn = $("fileCaptureBtn");
  const fileCaptureInput = $("fileCaptureInput");
  fileCaptureBtn.addEventListener("click", () => fileCaptureInput.click());
  fileCaptureInput.addEventListener("change", async () => {
    const file = fileCaptureInput.files[0];
    if (!file) return;
    await runOcr(file);
    fileCaptureInput.value = "";
  });

  cameraStartBtn.addEventListener("click", async () => {
    guideLine.textContent = "카메라를 켜는 중...";
    speak("카메라를 켜는 중이에요");
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      cameraVideo.srcObject = mediaStream;
      cameraVideo.style.display = "block";
      cameraStartBtn.style.display = "none";
      shutterBtn.style.display = "inline-block";
      guideLine.textContent = "페이지가 화면 가운데 오도록 맞추고 촬영하기를 누르세요";
      speak("페이지가 화면 가운데 오도록 맞추고, 촬영하기 버튼을 눌러주세요");
      vibrate(20);
    } catch (err) {
      guideLine.textContent = "카메라를 켤 수 없어요. 권한을 확인해 주세요.";
      showToast("카메라 권한이 필요해요");
      vibrate(200);
    }
  });

  shutterBtn.addEventListener("click", async () => {
    guideLine.textContent = "촬영 중...";
    vibrate([20, 40, 20]);
    captureCanvas.width = cameraVideo.videoWidth;
    captureCanvas.height = cameraVideo.videoHeight;
    captureCanvas.getContext("2d").drawImage(cameraVideo, 0, 0);
    if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
    cameraVideo.style.display = "none";
    shutterBtn.style.display = "none";
    cameraStartBtn.style.display = "inline-block";
    cameraStartBtn.textContent = "다시 촬영하기";
    await runOcr(captureCanvas);
  });

  async function runOcr(source) {
    guideLine.textContent = "글자를 읽는 중... (몇 초 걸릴 수 있어요)";
    speak("글자를 읽는 중이에요. 잠시만 기다려 주세요.");
    try {
      const { data: { text } } = await Tesseract.recognize(source, "kor+eng");
      const cleaned = text.replace(/\n{2,}/g, "\n").trim();
      ocrResultText.value = cleaned || "";
      ocrResultBox.style.display = "block";
      if (cleaned) detectSubject(cleaned);
      guideLine.textContent = cleaned
        ? "글자를 인식했어요. 아래에서 확인하고 추가해 주세요."
        : "글자를 잘 못 읽었어요. 다시 찍거나 직접 수정해 주세요.";
      speak(cleaned ? "글자를 인식했어요. 확인 후 추가해 주세요." : "글자를 잘 못 읽었어요.");
      vibrate([20, 40, 20, 40, 60]);
    } catch (err) {
      guideLine.textContent = "인식에 실패했어요. 다시 시도해 주세요.";
      vibrate(200);
    }
  }

  function renderSubjectChips(current) {
    detectedSubject = current;
    const chips = SUBJECT_LIST.map(
      (s) => `<button type="button" class="icon-btn subject-chip" data-subject="${s}" style="${s === current ? "background:var(--accent-dim);color:var(--accent);border-color:var(--accent);" : ""}">${s}</button>`
    ).join(" ");
    subjectBox.innerHTML = `AI가 분석한 과목: <strong>${current || "판단 중..."}</strong><br>
      <span style="display:block;margin:6px 0 4px;">다른 과목인가요?</span>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">${chips}</div>`;
    subjectBox.querySelectorAll(".subject-chip").forEach((btn) => {
      btn.addEventListener("click", () => { renderSubjectChips(btn.dataset.subject); vibrate(15); });
    });
  }

  async function detectSubject(text) {
    subjectBox.innerHTML = `<span style="color:var(--text-dim);">AI가 과목을 분석하는 중...</span>`;
    try {
      const subject = await VoxAPI.aiDetectSubject(text);
      renderSubjectChips(subject);
    } catch (e) {
      subjectBox.innerHTML = `<span style="color:var(--text-dim);">과목 분석 실패 — 직접 골라 주세요</span>`;
      renderSubjectChips(null);
    }
  }

  $("addOcrChapterBtn").addEventListener("click", async () => {
    const text = ocrResultText.value.trim();
    if (!text) { showToast("내용이 비어있어요"); return; }
    const label = detectedSubject ? `촬영한 내용 [${detectedSubject}]` : "촬영한 내용";
    try {
      const chapter = await VoxAPI.addChapter(label, detectedSubject, text);
      state.chapters.push(chapter);
      const tocEl = document.querySelector(".toc.grid-cards");
      const contentEl = $("content");
      tocEl.appendChild(renderTocCard(chapter));
      contentEl.appendChild(renderChapterSection(chapter));
      wireDynamicHandlers();
      setCurrentChapter(chapter.id);
      vibrate([15, 40, 15, 40, 15]);
      ocrResultBox.style.display = "none";
      ocrResultText.value = "";
      detectedSubject = null;
      subjectBox.innerHTML = "";
      showToast("교과서에 추가됐어요");
    } catch (e) {
      showToast("추가에 실패했어요: " + e.message);
    }
  });

  // ---- AI 튜터 ----
  const askBtn = $("askBtn");
  const askInput = $("askInput");
  const askStatus = $("askStatus");

  async function askTutor() {
    const question = askInput.value.trim();
    if (!question) { showToast("궁금한 걸 입력해 주세요"); return; }
    const chapter = chapterById(state.currentId);
    askStatus.textContent = "AI 튜터가 생각하는 중...";
    askBtn.disabled = true;
    vibrate(15);
    try {
      const answer = await VoxAPI.aiTutor(chapter ? chapter.title : "", chapter ? chapter.bodyText : "", question);
      askStatus.textContent = "AI 튜터: " + answer;
      speak(answer);
      vibrate([15, 40, 15]);
    } catch (err) {
      askStatus.textContent = "AI 튜터 연결에 실패했어요. (" + err.message + ")";
      vibrate(200);
    } finally {
      askBtn.disabled = false;
    }
  }
  askBtn.addEventListener("click", askTutor);
  askInput.addEventListener("keydown", (e) => { if (e.key === "Enter") askTutor(); });

  // ---- 음성 입력 (Web Speech API, 공유 인식 엔진) ----
  const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
  let sharedRecognition = null;
  let activeVoiceTarget = null;
  let pendingVoiceTarget = null;
  let alwaysListenOn = false;

  function resetMicBtn(target) {
    if (target && target.micBtn) {
      target.micBtn.textContent = "🎤";
      target.micBtn.style.background = "var(--surface-2)";
    }
  }
  function actuallyStartRecognition(target) {
    activeVoiceTarget = target;
    try { sharedRecognition.start(); }
    catch (e) { setTimeout(() => { try { sharedRecognition.start(); } catch (e2) {} }, 200); }
  }

  const alwaysListenStatus = $("alwaysListenStatus");

  if (SpeechRecognitionAPI) {
    sharedRecognition = new SpeechRecognitionAPI();
    sharedRecognition.lang = "ko-KR";
    sharedRecognition.interimResults = false;
    sharedRecognition.maxAlternatives = 1;

    sharedRecognition.addEventListener("start", () => {
      if (!activeVoiceTarget) return;
      if (activeVoiceTarget.micBtn) {
        activeVoiceTarget.micBtn.textContent = "⏺";
        activeVoiceTarget.micBtn.style.background = "var(--danger)";
      }
      if (activeVoiceTarget.statusEl) activeVoiceTarget.statusEl.textContent = "듣고 있어요... 말씀해 주세요";
      vibrate(20);
    });
    sharedRecognition.addEventListener("result", (e) => {
      if (!activeVoiceTarget) return;
      const resultList = e.results[e.results.length - 1];
      const said = ((resultList && resultList[0] && resultList[0].transcript) || "").trim();
      const { inputEl, statusEl, onResult } = activeVoiceTarget;
      if (!said) {
        if (statusEl) statusEl.textContent = "말씀을 못 알아들었어요. 다시 눌러서 또렷하게 말씀해 주세요.";
        vibrate(200);
        return;
      }
      if (inputEl) inputEl.value = said;
      if (statusEl) statusEl.textContent = "인식됨: " + said;
      vibrate([15, 30, 15]);
      if (onResult) onResult(said);
    });
    sharedRecognition.addEventListener("error", (e) => {
      if (activeVoiceTarget && activeVoiceTarget.statusEl && e.error !== "no-speech") {
        activeVoiceTarget.statusEl.textContent = "음성 인식 실패 (" + e.error + "). 다시 눌러서 시도해 주세요.";
      }
      if (e.error !== "no-speech") vibrate(200);
    });
    sharedRecognition.addEventListener("end", () => {
      const wasAlwaysListen = activeVoiceTarget && activeVoiceTarget.isAlwaysListen;
      resetMicBtn(activeVoiceTarget);
      activeVoiceTarget = null;
      if (pendingVoiceTarget) {
        const next = pendingVoiceTarget;
        pendingVoiceTarget = null;
        sharedRecognition.continuous = !!next.isAlwaysListen;
        actuallyStartRecognition(next);
      } else if (alwaysListenOn && wasAlwaysListen) {
        actuallyStartRecognition({ micBtn: null, inputEl: askInput, statusEl: alwaysListenStatus, onResult: () => askTutor(), isAlwaysListen: true });
      }
    });
  }

  function startVoiceCapture(target) {
    if (!SpeechRecognitionAPI) { showToast("이 브라우저는 음성 인식을 지원하지 않아요"); return; }
    if (activeVoiceTarget) {
      pendingVoiceTarget = target;
      try { sharedRecognition.stop(); } catch (e) {}
    } else {
      sharedRecognition.continuous = !!target.isAlwaysListen;
      actuallyStartRecognition(target);
    }
  }
  function setupVoiceInput(micBtn, inputEl, statusEl, onResult) {
    if (!SpeechRecognitionAPI) {
      micBtn.addEventListener("click", () => { showToast("이 브라우저는 음성 인식을 지원하지 않아요"); vibrate(200); });
      return;
    }
    micBtn.addEventListener("click", () => {
      if (activeVoiceTarget && activeVoiceTarget.micBtn === micBtn) {
        try { sharedRecognition.stop(); } catch (e) {}
        return;
      }
      startVoiceCapture({ micBtn, inputEl, statusEl, onResult });
    });
  }

  setupVoiceInput($("askMicBtn"), askInput, askStatus, () => askTutor());
  setupVoiceInput($("jumpMicBtn"), $("jumpInput"), null, () => doJump());
  setupVoiceInput($("quizMicBtn"), $("quizAnswerInput"), $("quizFeedback"), () => checkQuizAnswer());

  // ---- 화면·음성 접근성 설정 ----
  let fontZoom = parseFloat(localStorage.getItem("voxbook_fontzoom") || "1.0");
  document.body.style.zoom = fontZoom;
  $("fontIncreaseBtn").addEventListener("click", () => {
    fontZoom = Math.min(fontZoom + 0.1, 1.8);
    document.body.style.zoom = fontZoom;
    localStorage.setItem("voxbook_fontzoom", fontZoom);
    vibrate(15);
  });
  $("fontDecreaseBtn").addEventListener("click", () => {
    fontZoom = Math.max(fontZoom - 0.1, 0.8);
    document.body.style.zoom = fontZoom;
    localStorage.setItem("voxbook_fontzoom", fontZoom);
    vibrate(15);
  });

  const contrastBtn = $("contrastToggleBtn");
  if (localStorage.getItem("voxbook_contrast") === "true") {
    document.body.classList.add("high-contrast");
    contrastBtn.setAttribute("aria-pressed", "true");
  }
  contrastBtn.addEventListener("click", () => {
    const on = document.body.classList.toggle("high-contrast");
    contrastBtn.setAttribute("aria-pressed", on ? "true" : "false");
    localStorage.setItem("voxbook_contrast", on ? "true" : "false");
    showToast(on ? "고대비 모드 켜짐" : "고대비 모드 꺼짐");
    vibrate(20);
  });

  const rateSlider = $("rateSlider");
  rateSlider.value = state.speechRate;
  rateSlider.addEventListener("input", (e) => {
    state.speechRate = parseFloat(e.target.value);
    localStorage.setItem("voxbook_rate", state.speechRate);
  });

  const alwaysListenBtn = $("alwaysListenBtn");
  alwaysListenBtn.addEventListener("click", () => {
    if (!SpeechRecognitionAPI) { showToast("이 브라우저는 음성 인식을 지원하지 않아요"); return; }
    alwaysListenOn = !alwaysListenOn;
    alwaysListenBtn.setAttribute("aria-pressed", alwaysListenOn ? "true" : "false");
    alwaysListenBtn.textContent = alwaysListenOn ? "🎙 항상 듣기: 켜짐" : "🎙 항상 듣기: 꺼짐";
    if (alwaysListenOn) {
      sharedRecognition.continuous = true;
      startVoiceCapture({ micBtn: null, inputEl: askInput, statusEl: alwaysListenStatus, onResult: () => askTutor(), isAlwaysListen: true });
      alwaysListenStatus.textContent = "항상 듣기 모드 켜짐 — 아무 때나 말하면 자동으로 질문으로 인식돼요";
      showToast("항상 듣기 모드 켜짐");
    } else {
      sharedRecognition.continuous = false;
      try { sharedRecognition.stop(); } catch (e) {}
      activeVoiceTarget = null;
      alwaysListenStatus.textContent = "";
      showToast("항상 듣기 모드 꺼짐");
    }
    vibrate(20);
  });

  // ---- 마이크 테스트 ----
  const micTestStatus = $("micTestStatus");
  const micVolumeTestBtn = $("micVolumeTestBtn");
  const micEchoTestBtn = $("micEchoTestBtn");
  let micTestStream = null, micTestAudioCtx = null, micTestRAF = null;

  async function startVolumeTest() {
    try { micTestStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (err) {
      micTestStatus.textContent = "마이크에 접근할 수 없어요. 브라우저의 마이크 권한을 확인해 주세요.";
      speak("마이크에 접근할 수 없어요. 마이크 권한을 확인해 주세요.");
      vibrate(200);
      return;
    }
    micTestAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = micTestAudioCtx.createMediaStreamSource(micTestStream);
    const analyser = micTestAudioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    micVolumeTestBtn.textContent = "⏹ 소리 감지 테스트 종료";
    micTestStatus.textContent = "테스트 중이에요. 평소 말하는 크기로 말씀해 보세요.";
    speak("소리 감지 테스트를 시작해요. 평소처럼 말씀해 보세요.");
    let lastFeedback = 0;
    function tick() {
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sumSquares += v * v; }
      const rms = Math.sqrt(sumSquares / data.length);
      const now = Date.now();
      if (rms > 0.02 && now - lastFeedback > 250) {
        lastFeedback = now;
        const strong = rms > 0.15, mid = rms > 0.06;
        vibrate(strong ? 45 : mid ? 20 : 8);
        micTestStatus.textContent = strong ? "소리가 잘 들려요 (크게 감지됨)"
          : mid ? "소리가 감지되고 있어요 (적당히)"
          : "아주 작게 감지되고 있어요 — 마이크에 조금 더 가까이서 말해 보세요";
      }
      micTestRAF = requestAnimationFrame(tick);
    }
    tick();
  }
  function stopVolumeTest() {
    if (micTestRAF) cancelAnimationFrame(micTestRAF);
    if (micTestStream) micTestStream.getTracks().forEach((t) => t.stop());
    if (micTestAudioCtx) { try { micTestAudioCtx.close(); } catch (e) {} }
    micTestStream = null; micTestAudioCtx = null; micTestRAF = null;
    micVolumeTestBtn.textContent = "① 소리가 감지되는지 확인";
    micTestStatus.textContent = "소리 감지 테스트를 종료했어요.";
    speak("테스트를 종료했어요.");
  }
  micVolumeTestBtn.addEventListener("click", () => { if (micTestStream) stopVolumeTest(); else startVolumeTest(); });
  micEchoTestBtn.addEventListener("click", () => {
    if (!SpeechRecognitionAPI) { showToast("이 브라우저는 음성 인식을 지원하지 않아요"); return; }
    micTestStatus.textContent = "듣고 있어요, 아무 문장이나 말씀해 보세요.";
    speak("듣고 있어요. 아무 문장이나 말씀해 보세요.");
    startVoiceCapture({
      micBtn: micEchoTestBtn, inputEl: { value: "" }, statusEl: null,
      onResult: (said) => { micTestStatus.textContent = "이렇게 알아들었어요: " + said; speak("이렇게 알아들었어요: " + said); },
    });
  });

  // ---- 이해도 확인 퀴즈 ----
  const quizStartBtn = $("quizStartBtn");
  const quizQuestionBox = $("quizQuestionBox");
  const quizAnswerRow = $("quizAnswerRow");
  const quizAnswerInput = $("quizAnswerInput");
  const quizCheckBtn = $("quizCheckBtn");
  const quizFeedback = $("quizFeedback");
  let currentQuizQuestion = null;

  quizStartBtn.addEventListener("click", async () => {
    const chapter = chapterById(state.currentId);
    quizQuestionBox.textContent = "퀴즈를 만드는 중...";
    quizFeedback.textContent = "";
    quizAnswerRow.style.display = "none";
    quizStartBtn.disabled = true;
    try {
      const question = await VoxAPI.aiGenerateQuiz(chapter ? chapter.title : "", chapter ? chapter.bodyText : "");
      currentQuizQuestion = question;
      quizQuestionBox.textContent = "Q. " + question;
      speak(question);
      quizAnswerRow.style.display = "flex";
      vibrate([15, 40, 15]);
    } catch (e) {
      quizQuestionBox.textContent = "퀴즈를 만들지 못했어요. (" + e.message + ")";
      vibrate(200);
    } finally {
      quizStartBtn.disabled = false;
    }
  });

  async function checkQuizAnswer() {
    const studentAnswer = quizAnswerInput.value.trim();
    if (!studentAnswer || !currentQuizQuestion) { showToast("답을 입력해 주세요"); return; }
    const chapter = chapterById(state.currentId);
    quizFeedback.textContent = "채점하는 중...";
    quizCheckBtn.disabled = true;
    try {
      const { feedback, isCorrect } = await VoxAPI.aiGradeQuiz(currentQuizQuestion, chapter ? chapter.bodyText : "", studentAnswer);
      quizFeedback.textContent = feedback;
      speak(feedback);
      vibrate([15, 40, 15]);
      if (chapter) {
        VoxAPI.logQuizAttempt({
          chapterId: chapter.id, question: currentQuizQuestion, answer: studentAnswer, isCorrect, feedback,
        }).catch(() => {});
      }
    } catch (e) {
      quizFeedback.textContent = "채점에 실패했어요. (" + e.message + ")";
      vibrate(200);
    } finally {
      quizCheckBtn.disabled = false;
    }
  }
  quizCheckBtn.addEventListener("click", checkQuizAnswer);
  quizAnswerInput.addEventListener("keydown", (e) => { if (e.key === "Enter") checkQuizAnswer(); });

  // ---- 그래프를 손끝 진동으로 탐색하기 (ch6 전용) ----
  function setupGraphCanvas() {
    const graphCanvas = $("graphCanvas");
    const graphCtx = graphCanvas.getContext("2d");
    const graphStatus = $("graphStatus");
    const W = graphCanvas.width, H = graphCanvas.height;
    const padding = 30;

    function graphValue(rNorm) { return rNorm * rNorm; }
    function toScreenY(v) { return H - padding - v * (H - padding * 2); }
    function toScreenX(r) { return padding + r * (W - padding * 2); }

    function drawGraph() {
      graphCtx.clearRect(0, 0, W, H);
      graphCtx.strokeStyle = "#444a55";
      graphCtx.lineWidth = 2;
      graphCtx.beginPath();
      graphCtx.moveTo(padding, padding * 0.3);
      graphCtx.lineTo(padding, H - padding);
      graphCtx.lineTo(W - padding * 0.3, H - padding);
      graphCtx.stroke();
      graphCtx.strokeStyle = "#5ec8a8";
      graphCtx.lineWidth = 4;
      graphCtx.beginPath();
      for (let i = 0; i <= 100; i++) {
        const rNorm = i / 100;
        const x = toScreenX(rNorm), y = toScreenY(graphValue(rNorm));
        if (i === 0) graphCtx.moveTo(x, y); else graphCtx.lineTo(x, y);
      }
      graphCtx.stroke();
    }
    drawGraph();

    function handleGraphTouch(clientX, clientY) {
      const rect = graphCanvas.getBoundingClientRect();
      const x = (clientX - rect.left) * (W / rect.width);
      const y = (clientY - rect.top) * (H / rect.height);
      const rNorm = Math.min(Math.max((x - padding) / (W - padding * 2), 0), 1);
      const curveY = toScreenY(graphValue(rNorm));
      const distance = Math.abs(y - curveY);

      if (state.mode !== "sound") {
        if (distance < 8) navigator.vibrate && navigator.vibrate(45);
        else if (distance < 20) navigator.vibrate && navigator.vibrate(20);
        else if (distance < 40) navigator.vibrate && navigator.vibrate(6);
        else navigator.vibrate && navigator.vibrate(0);
      }
      if (state.mode !== "vibe" && distance < 40) {
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.frequency.value = 300 + (40 - distance) * 8;
          gain.gain.setValueAtTime(0.05, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
          osc.connect(gain).connect(ctx.destination);
          osc.start(); osc.stop(ctx.currentTime + 0.08);
        } catch (e) {}
      }
      graphStatus.textContent = distance < 8
        ? `곡선 위예요! 반지름 비율 약 ${Math.round(rNorm * 100)}%`
        : "곡선을 찾는 중... 손가락을 위아래로 움직여 보세요";
    }

    graphCanvas.addEventListener("touchmove", (e) => { e.preventDefault(); const t = e.touches[0]; if (t) handleGraphTouch(t.clientX, t.clientY); }, { passive: false });
    graphCanvas.addEventListener("touchstart", (e) => { const t = e.touches[0]; if (t) handleGraphTouch(t.clientX, t.clientY); });
    let mouseDown = false;
    graphCanvas.addEventListener("mousedown", () => (mouseDown = true));
    window.addEventListener("mouseup", () => (mouseDown = false));
    graphCanvas.addEventListener("mousemove", (e) => { if (mouseDown) handleGraphTouch(e.clientX, e.clientY); });

    $("graphDescribeBtn").addEventListener("click", () => playChapter(state.currentId));
    $("graphStepBtn").addEventListener("click", () => {
      const steps = [0, 0.25, 0.5, 0.75, 1.0];
      const labels = ["시작 지점", "4분의 1 지점", "절반 지점", "4분의 3 지점", "끝 지점"];
      let i = 0;
      function speakStep() {
        if (i >= steps.length) {
          speak("설명이 끝났어요. 전체적으로 처음엔 완만하게, 갈수록 점점 가파르게 올라가는 곡선이에요.");
          return;
        }
        const heightPercent = Math.round(graphValue(steps[i]) * 100);
        speak(`${labels[i]}, 반지름 비율 ${Math.round(steps[i] * 100)}퍼센트일 때, 넓이는 최대치의 약 ${heightPercent}퍼센트예요.`);
        graphStatus.textContent = `${labels[i]} — 넓이 약 ${heightPercent}%`;
        i++;
        setTimeout(speakStep, 3200);
      }
      speakStep();
    });
  }

  // ---- 초기 모드 표시 동기화 ----
  document.querySelectorAll(".seg button").forEach((b) => {
    const active = b.dataset.mode === state.mode;
    b.setAttribute("aria-pressed", active ? "true" : "false");
    if (active) modeIndicator.textContent = b.textContent;
  });

  // ---- 앱 초기화: 챕터/북마크 불러오기 ----
  async function initApp() {
    try {
      const [chapters, bookmarks] = await Promise.all([VoxAPI.listChapters(), VoxAPI.listBookmarks()]);
      state.chapters = chapters;
      state.bookmarkIds = new Set(bookmarks.map((b) => b.chapterId));
      renderAllChapters();
    } catch (e) {
      showToast("교과서를 불러오지 못했어요: " + e.message);
    }
  }

  window.VoxApp = { initApp };
})();
