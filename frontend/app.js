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
    libraryOpenBookId: null, // null = 교과서 목차에서 책 목록 보는 중, 아니면 그 책의 단원 목록 보는 중
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

  // VoiceControl(상시 듣기 엔진)은 브라우저가 음성 인식을 지원할 때만 존재하므로
  // 호출부마다 반복되는 방어 코드를 여기 모아둔다.
  function vcSupported() { return !!(window.VoiceControl && VoiceControl.supported()); }
  function vcStart(onFinal) { if (vcSupported()) VoiceControl.start(onFinal); }
  function vcStop() { if (vcSupported()) VoiceControl.stop(); }
  function vcMute() { if (vcSupported()) VoiceControl.mute(); }
  function vcUnmute() { if (vcSupported()) VoiceControl.unmute(); }

  // 말을 끊기만 하고 마이크는 여기서 풀지 않는다. 취소된 발화의 onend가 대신 풀어주는데,
  // speak()가 새 발화를 시작하려고 부른 경우에는 그 onend가 한 세대 뒤처진 상태라
  // (speakGen 불일치) 마이크를 풀지 않는다. 이 세대 검사가 없으면 cancel()의 비동기 onend가
  // 새 발화 직후에 마이크를 열어버려서, AI 음성을 마이크가 되받아 인식하게 된다.
  let speakGen = 0;
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
    speakGen++;
    const myGen = speakGen;
    vcMute();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ko-KR";
    u.rate = state.speechRate;
    u.onend = u.onerror = () => { if (myGen === speakGen) vcUnmute(); };
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

  // 표지 하단에 들어가는 짧은 안내 문구. 실제 책 표지처럼 본문 미리보기는 넣지 않고,
  // 꼭 필요한 힌트(특수 조작법, 촬영으로 추가됨)만 남긴다.
  function getPreviewFor(chapter) {
    if (chapter.slug === "ch4") return "수식을 낭독 순서 문장으로 들려줘요";
    if (chapter.slug === "ch6") return "손가락으로 그래프를 탐색해요";
    if (chapter.source === "ocr") return "촬영으로 추가됨";
    return "";
  }

  // 목차를 책장에 꽂힌 교과서 표지처럼 보여준다: 과목 색이 꽉 찬 세로 표지 카드.
  function renderTocCard(chapter) {
    const btn = document.createElement("button");
    btn.dataset.id = chapter.id;
    btn.dataset.subject = chapter.subject || "";
    btn.setAttribute("aria-current", "false");
    btn.innerHTML = `
      <span class="card-subject">${chapter.subject || (chapter.source === "ocr" ? "촬영" : "교과서")}</span>
      <span class="card-title">${chapter.title}</span>
      <span class="card-preview">${getPreviewFor(chapter)}</span>`;
    btn.addEventListener("click", () => setCurrentChapter(chapter.id));
    return btn;
  }

  // 여러 페이지 넣기로 들어온 책은 단원별로 쪼개서 보여주지 않고, "책" 표지 한 장으로만 보여준다.
  // 뒤에 페이지가 겹쳐 보이는 그림자(CSS)로 "여러 장짜리 묶음"임을 표현한다.
  // 누르면 그 책의 단원 목록("교과서 목차 열기")으로 들어간다 — 단원은 그 안에서 고른다.
  function renderFolderCard(book) {
    const btn = document.createElement("button");
    btn.className = "folder-card";
    btn.dataset.bookId = book.bookId;
    btn.dataset.subject = book.subject || "";
    btn.setAttribute("aria-current", "false");
    const flagged = book.chapters.filter((c) => c.needsReview).length;
    btn.innerHTML = `
      <span class="card-subject">${book.subject || "교과서"}</span>
      <span class="card-title">${book.bookTitle}</span>
      <span class="card-preview">${book.chapters.length}페이지${flagged ? ` · 확인 필요 ${flagged}` : ""}</span>`;
    btn.addEventListener("click", () => openLibraryPanel(book.bookId));
    return btn;
  }

  // 상세화면에 "이 단원의 N페이지 중 K번째" 이전/다음 페이지 내비게이션을 붙인다(책 느낌 탐색).
  function renderGroupNavHtml(chapter) {
    if (!chapterBelongsToBook(chapter)) return "";
    const siblings = sortGroupChapters(state.chapters.filter((c) => groupKey(c) === groupKey(chapter)));
    if (siblings.length <= 1) return "";
    const idx = siblings.findIndex((c) => c.id === chapter.id);
    const unitLabel = chapter.unitNumber == null ? "미배정" : `${chapter.unitNumber}단원`;
    const label = chapter.bookTitle ? `${chapter.bookTitle} · ${unitLabel}` : `${chapter.subject || ""} ${unitLabel}`;
    return `<div class="guide-line group-nav" id="group-nav-${chapter.id}">
        📁 ${label} · ${idx + 1}/${siblings.length}페이지
        <button class="icon-btn" data-group-prev="${chapter.id}" ${idx <= 0 ? "disabled" : ""}>◀ 이전 페이지</button>
        <button class="icon-btn" data-group-next="${chapter.id}" ${idx >= siblings.length - 1 ? "disabled" : ""}>다음 페이지 ▶</button>
      </div>`;
  }

  function jumpGroupPage(id, delta) {
    const chapter = chapterById(id);
    if (!chapter) return;
    const siblings = sortGroupChapters(state.chapters.filter((c) => groupKey(c) === groupKey(chapter)));
    const idx = siblings.findIndex((c) => c.id === id);
    const target = siblings[idx + delta];
    if (target) setCurrentChapter(target.id);
  }

  function renderChapterSection(chapter) {
    const section = document.createElement("section");
    section.className = "chapter";
    section.id = "chapter-" + chapter.id;
    section.tabIndex = -1;
    section.dataset.id = chapter.id;
    section.dataset.subject = chapter.subject || "";

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
      ${renderReviewBadgeHtml(chapter)}
      ${renderGroupNavHtml(chapter)}
      ${extra}
      <p class="chapter-body">${chapter.slug === "ch5" ? "(현대어 풀이: " + chapter.bodyText + ")" : chapter.bodyText}</p>
      <div class="row-actions">
        <button class="icon-btn play-this" data-id="${chapter.id}">▶ 이 부분 듣기</button>
        <button class="icon-btn bookmark-btn" data-id="${chapter.id}" aria-pressed="${bookmarked}">${bookmarked ? "★ 북마크됨" : "☆ 북마크"}</button>
        ${chapter.slug === "ch5" ? `<button class="icon-btn" id="toggleRecording">🎙 녹음 있음/없음 전환 (데모)</button>` : ""}
      </div>
      ${chapter.slug === "ch5" ? `<div class="guide-line" id="ch5-status">지금 상태: 사람 녹음 없음 → 현대어 풀이를 음성으로 재생함</div>` : ""}
      ${hasGraphPanel(chapter) ? renderGraphBlockHtml(chapter) : ""}
    `;
    return section;
  }

  // 그래프 패널은 수학 단원 전체에 붙는다(시드 단원이든 촬영·배치로 추가된 단원이든 동일).
  function hasGraphPanel(chapter) { return chapter.subject === "수학" && !!window.GraphSound; }

  // 단원 자동 매칭에 실패한 페이지("unit_unmatched")는 "확인 완료"를 눌러도 그냥 경고만
  // 사라질 뿐 영원히 미배정으로 남았었다. 그 책의 다른 페이지들이 이미 아는 단원 번호를
  // 골라서 직접 지정하게 해서, 실제로 그 단원으로 옮겨지도록 한다.
  function renderReviewBadgeHtml(chapter) {
    if (!chapter.needsReview) return "";
    if (chapter.reviewReason === "unit_unmatched" && chapter.bookId) {
      const knownUnits = [...new Set(
        state.chapters
          .filter((c) => c.bookId === chapter.bookId && c.unitNumber != null)
          .map((c) => c.unitNumber)
      )].sort((a, b) => a - b);
      const picker = knownUnits.length
        ? `<select id="review-unit-input-${chapter.id}" aria-label="단원 선택">
             <option value="">미배정으로 두기</option>
             ${knownUnits.map((n) => `<option value="${n}">${n}단원</option>`).join("")}
           </select>`
        : `<input type="number" id="review-unit-input-${chapter.id}" min="1" step="1"
             placeholder="단원 번호" style="width:88px;" aria-label="단원 번호 입력">`;
      return `<div class="review-row" id="review-row-${chapter.id}">
          <span class="badge-warning">⚠ 단원을 확인해주세요</span>
          ${picker}
          <button class="icon-btn" data-assign-unit="${chapter.id}">지정</button>
        </div>`;
    }
    return `<div class="review-row" id="review-row-${chapter.id}">
        <span class="badge-warning">⚠ 확인이 필요해요</span>
        <button class="icon-btn" data-review-done="${chapter.id}">확인 완료</button>
      </div>`;
  }

  function renderGraphBlockHtml(chapter) {
    const id = chapter.id;
    const options = GraphSound.GRAPH_TYPES
      .map((g) => `<option value="${g.id}">${g.label}</option>`)
      .join("");
    return `
      <div class="graph-panel">
        <label for="graph-equation-text-${id}">그래프로 볼 방정식 직접 입력하기</label>
        <div class="field-row">
          <input id="graph-equation-text-${id}" type="text" placeholder="y = 2x^2 - 3x + 1" aria-label="그래프로 볼 방정식 입력">
          <button class="btn" id="graph-apply-equation-${id}">적용하기</button>
        </div>
        <label for="graph-type-select-${id}" style="margin-top:12px;">또는 그래프 모양 고르기</label>
        <select id="graph-type-select-${id}" class="graph-select" aria-label="그래프 모양 선택">${options}</select>
        <div class="row-actions" style="margin-top:10px;">
          <button class="icon-btn" id="graph-play-${id}">🔊 소리·진동으로 듣기</button>
          <button class="icon-btn" id="graph-toggle-trace-${id}" aria-pressed="false">손으로 그래프 따라 그리기</button>
        </div>
        <canvas id="graph-trace-${id}" class="graph-trace-canvas" aria-hidden="true" hidden></canvas>
        <div class="guide-line" id="graph-desc-${id}" aria-live="polite"></div>
      </div>`;
  }

  function renderAllChapters() {
    const tocEl = document.querySelector(".toc.grid-cards");
    const contentEl = $("content");
    tocEl.innerHTML = "";
    contentEl.innerHTML = "";
    // 여러 페이지 넣기로 들어온 단원은 개별 카드 대신 단원별 폴더 카드 한 장으로 묶어서 보여준다
    // ("페이지로 하지 말고 책/폴더 느낌으로" 요청 반영). 시드/단일 촬영 단원은 기존처럼 개별 카드.
    state.chapters.filter((c) => !chapterBelongsToBook(c)).forEach((chapter) => {
      tocEl.appendChild(renderTocCard(chapter));
    });
    buildTocFolders().forEach((group) => {
      tocEl.appendChild(renderFolderCard(group));
    });
    state.chapters.forEach((chapter) => {
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
    document.querySelectorAll("[data-review-done]").forEach((btn) => {
      btn.onclick = () => markReviewed(btn.dataset.reviewDone);
    });
    document.querySelectorAll("[data-assign-unit]").forEach((btn) => {
      btn.onclick = () => assignUnit(btn.dataset.assignUnit);
    });
    document.querySelectorAll("[data-group-prev]").forEach((btn) => {
      btn.onclick = () => jumpGroupPage(btn.dataset.groupPrev, -1);
    });
    document.querySelectorAll("[data-group-next]").forEach((btn) => {
      btn.onclick = () => jumpGroupPage(btn.dataset.groupNext, 1);
    });
    state.chapters.forEach((chapter) => {
      if (hasGraphPanel(chapter) && $("graph-type-select-" + chapter.id)) setupGraphPanel(chapter);
    });
  }

  async function markReviewed(id) {
    const chapter = chapterById(id);
    if (!chapter) return;
    try {
      await VoxAPI.updateChapter(id, { needsReview: false, reviewReason: null });
      chapter.needsReview = false;
      chapter.reviewReason = null;
      const row = $("review-row-" + id);
      if (row) row.remove();
      showToast("확인 완료로 표시했어요");
      speak("확인 완료로 표시했어요.");
      vibrate([15, 30, 15]);
    } catch (e) {
      showToast("확인 완료 처리에 실패했어요: " + e.message);
    }
  }

  async function assignUnit(id) {
    const chapter = chapterById(id);
    if (!chapter) return;
    const input = $("review-unit-input-" + id);
    const raw = input ? input.value.trim() : "";
    const unitNumber = raw ? parseInt(raw, 10) : null;
    if (raw && !Number.isInteger(unitNumber)) {
      showToast("단원 번호는 숫자로 입력해주세요");
      return;
    }
    try {
      await VoxAPI.updateChapter(id, { unitNumber, needsReview: false, reviewReason: null });
      chapter.unitNumber = unitNumber;
      chapter.needsReview = false;
      chapter.reviewReason = null;
      const row = $("review-row-" + id);
      if (row) row.remove();
      showToast(unitNumber ? `${unitNumber}단원으로 지정했어요` : "미배정으로 남겨뒀어요");
      speak(unitNumber ? `${unitNumber}단원으로 지정했습니다.` : "미배정으로 남겼습니다.");
      vibrate([15, 30, 15]);
    } catch (e) {
      showToast("단원 지정에 실패했어요: " + e.message);
    }
  }

  function setCurrentChapter(id, opts = {}) {
    state.currentId = id;
    const chapter = chapterById(id);
    document.querySelectorAll("section.chapter").forEach((s) => s.classList.remove("current"));
    const sectionEl = $("chapter-" + id);
    if (sectionEl) sectionEl.classList.add("current");
    document.querySelectorAll(".toc.grid-cards button").forEach((b) => {
      const current = b.dataset.id
        ? b.dataset.id === id
        : !!b.dataset.bookId && chapter && chapter.bookId === b.dataset.bookId;
      b.setAttribute("aria-current", current ? "true" : "false");
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

  // ---- 촬영 -> Gemini Vision으로 직접 읽기 -> 백엔드에 단원으로 추가 ----
  const guideLine = $("guideLine");
  const cameraVideo = $("cameraVideo");
  const captureCanvas = $("captureCanvas");
  const cameraStartBtn = $("cameraStartBtn");
  const shutterBtn = $("shutterBtn");
  const ocrResultBox = $("ocrResultBox");
  const ocrResultText = $("ocrResultText");
  const visualDescBox = $("visualDescBox");
  const subjectBox = $("subjectBox");
  let mediaStream = null;
  let detectedSubject = null;
  let lastVisualDescription = null;
  const SUBJECT_LIST = ["수학", "국어", "영어", "사회", "과학"];

  // 사진을 그대로 보내면 용량이 크니, 인식에 충분한 크기로 줄여서 base64로 만듦
  async function imageSourceToResizedBase64(source) {
    const srcW = source.naturalWidth || source.width;
    const srcH = source.naturalHeight || source.height;
    const MAX_W = 1400;
    const scale = Math.min(1, MAX_W / srcW);
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));
    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    out.getContext("2d").drawImage(source, 0, 0, w, h);
    const dataUrl = out.toDataURL("image/jpeg", 0.85);
    return dataUrl.split(",")[1];
  }

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(img.src); resolve(img); };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  const fileCaptureBtn = $("fileCaptureBtn");
  const fileCaptureInput = $("fileCaptureInput");
  fileCaptureBtn.addEventListener("click", () => fileCaptureInput.click());
  fileCaptureInput.addEventListener("change", async () => {
    const file = fileCaptureInput.files[0];
    if (!file) return;
    try {
      const img = await loadImageFromFile(file);
      await runOcr(img);
    } catch (e) {
      showToast("이미지를 불러오지 못했어요");
    }
    fileCaptureInput.value = "";
  });

  // 실시간 프레임 품질 안내(너무 가까움/어두움/흔들림)와 자동 촬영에 쓰는 상태
  let frameLoopId = null;
  let goodStreak = 0;
  let lastSpokenStatus = null;
  let lastSpokenAt = 0;

  function stopFrameLoop() {
    if (frameLoopId) clearInterval(frameLoopId);
    frameLoopId = null;
    goodStreak = 0;
    lastSpokenStatus = null;
  }

  function startFrameLoop() {
    if (!window.FrameQuality) return;
    stopFrameLoop();
    lastSpokenAt = 0;
    frameLoopId = setInterval(() => {
      if (!mediaStream || cameraVideo.readyState < 2) return;
      const evalResult = FrameQuality.evaluate(FrameQuality.analyze(cameraVideo));
      guideLine.textContent = evalResult.message;

      const now = Date.now();
      if (evalResult.status !== lastSpokenStatus || now - lastSpokenAt > 4000) {
        speak(evalResult.message);
        lastSpokenStatus = evalResult.status;
        lastSpokenAt = now;
      }

      if (evalResult.status !== "good") {
        goodStreak = 0;
        return;
      }
      goodStreak++;
      if (goodStreak >= 3) {
        goodStreak = 0;
        capturePhoto();
      }
    }, 500);
  }

  // 촬영이 끝나면(또는 카메라를 끄면) 상시 듣기 모드가 켜져 있던 경우에만 AI 튜터 듣기로 돌아간다.
  function restoreListeningAfterCamera() {
    if (alwaysListenOn) vcStart(handleAlwaysListenTranscript);
    else vcStop();
  }

  function handleCaptureCommand(transcript) {
    const t = (transcript || "").replace(/\s/g, "");
    if (/캡처|찍어줘|촬영/.test(t)) capturePhoto();
  }

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
      speak("페이지가 화면 가운데 오도록 맞춰주세요. 촬영하기 버튼을 누르거나 캡처라고 말씀하시면 촬영합니다.");
      vibrate(20);
      startFrameLoop();
      vcStart(handleCaptureCommand);
    } catch (err) {
      guideLine.textContent = "카메라를 켤 수 없어요. 권한을 확인해 주세요.";
      showToast("카메라 권한이 필요해요");
      vibrate(200);
      stopFrameLoop();
      restoreListeningAfterCamera();
    }
  });

  async function capturePhoto() {
    if (!mediaStream) return;
    stopFrameLoop();
    guideLine.textContent = "촬영 중...";
    vibrate([20, 40, 20]);
    captureCanvas.width = cameraVideo.videoWidth;
    captureCanvas.height = cameraVideo.videoHeight;
    captureCanvas.getContext("2d").drawImage(cameraVideo, 0, 0);
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
    cameraVideo.style.display = "none";
    shutterBtn.style.display = "none";
    cameraStartBtn.style.display = "inline-block";
    cameraStartBtn.textContent = "다시 촬영하기";
    restoreListeningAfterCamera();
    await runOcr(captureCanvas);
  }

  shutterBtn.addEventListener("click", () => capturePhoto());

  async function runOcr(source) {
    guideLine.textContent = "AI가 페이지를 읽는 중... (몇 초 걸릴 수 있어요)";
    speak("AI가 페이지를 읽는 중이에요. 잠시만 기다려 주세요.");
    ocrResultBox.style.display = "none";
    visualDescBox.style.display = "none";
    lastVisualDescription = null;
    try {
      const base64 = await imageSourceToResizedBase64(source);
      const { text, subject, visualDescription } = await VoxAPI.aiOcr(base64, "image/jpeg");
      const cleaned = (text || "").trim();
      ocrResultText.value = cleaned;
      ocrResultBox.style.display = "block";
      lastVisualDescription = visualDescription || null;
      if (lastVisualDescription) {
        visualDescBox.textContent = "🖼 이 페이지의 그림/표: " + lastVisualDescription;
        visualDescBox.style.display = "block";
      }
      renderSubjectChips(subject || null);

      if (cleaned) {
        guideLine.textContent = "글자를 인식했어요. 읽어드릴게요.";
        let toSpeak = "이렇게 인식했어요. " + cleaned;
        if (lastVisualDescription) toSpeak += " 그리고 이 페이지에는 그림이나 표가 있어요. " + lastVisualDescription;
        toSpeak += " 내용이 맞으면 추가하기 버튼을, 이상하면 다시 촬영 버튼을 눌러주세요.";
        speak(toSpeak);
      } else {
        guideLine.textContent = "글자를 잘 못 읽었어요. 다시 찍거나 직접 수정해 주세요.";
        speak("글자를 잘 못 읽었어요. 다시 촬영해 주세요.");
      }
      vibrate([20, 40, 20, 40, 60]);
    } catch (err) {
      guideLine.textContent = "인식에 실패했어요: " + err.message;
      speak("인식에 실패했어요. 다시 시도해 주세요.");
      vibrate(200);
    }
  }

  $("ocrReplayBtn").addEventListener("click", () => {
    const cleaned = ocrResultText.value.trim();
    if (!cleaned) { showToast("들려줄 내용이 없어요"); return; }
    let toSpeak = cleaned;
    if (lastVisualDescription) toSpeak += " 그리고 " + lastVisualDescription;
    speak(toSpeak);
  });

  $("ocrRetakeBtn").addEventListener("click", () => {
    ocrResultBox.style.display = "none";
    visualDescBox.style.display = "none";
    ocrResultText.value = "";
    lastVisualDescription = null;
    detectedSubject = null;
    subjectBox.innerHTML = "";
    guideLine.textContent = "다시 촬영해 주세요.";
    speak("다시 촬영해 주세요.");
    vibrate(20);
  });

  function renderSubjectChips(current) {
    detectedSubject = current;
    const chips = SUBJECT_LIST.map(
      (s) => `<button type="button" class="icon-btn subject-chip${s === current ? " selected" : ""}" data-subject="${s}">${s}</button>`
    ).join(" ");
    subjectBox.innerHTML = `AI가 분석한 과목: <strong>${current || "판단 중..."}</strong><br>
      <span class="subject-hint">다른 과목인가요?</span>
      <div class="subject-chips">${chips}</div>`;
    subjectBox.querySelectorAll(".subject-chip").forEach((btn) => {
      btn.addEventListener("click", () => { renderSubjectChips(btn.dataset.subject); vibrate(15); });
    });
  }

  $("addOcrChapterBtn").addEventListener("click", async () => {
    const text = ocrResultText.value.trim();
    if (!text) { showToast("내용이 비어있어요"); return; }
    const fullText = lastVisualDescription ? `${text}\n\n[그림 설명] ${lastVisualDescription}` : text;
    const label = detectedSubject ? `촬영한 내용 [${detectedSubject}]` : "촬영한 내용";
    try {
      const chapter = await VoxAPI.addChapter(label, detectedSubject, fullText);
      state.chapters.push(chapter);
      const tocEl = document.querySelector(".toc.grid-cards");
      const contentEl = $("content");
      tocEl.appendChild(renderTocCard(chapter));
      contentEl.appendChild(renderChapterSection(chapter));
      wireDynamicHandlers();
      setCurrentChapter(chapter.id);
      vibrate([15, 40, 15, 40, 15]);
      ocrResultBox.style.display = "none";
      visualDescBox.style.display = "none";
      ocrResultText.value = "";
      detectedSubject = null;
      lastVisualDescription = null;
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
      resetMicBtn(activeVoiceTarget);
      activeVoiceTarget = null;
      if (pendingVoiceTarget) {
        const next = pendingVoiceTarget;
        pendingVoiceTarget = null;
        actuallyStartRecognition(next);
      } else {
        // 한 번 듣기 체인이 완전히 끝났을 때만 상시 듣기 마이크를 돌려준다.
        vcUnmute();
      }
    });
  }

  // 두 개의 SpeechRecognition이 동시에 마이크를 잡으면 서로 인식을 방해하므로,
  // 한 번 듣기(sharedRecognition)가 도는 동안에는 상시 듣기(VoiceControl)를 재운다.
  function startVoiceCapture(target) {
    if (!SpeechRecognitionAPI) { showToast("이 브라우저는 음성 인식을 지원하지 않아요"); return; }
    if (activeVoiceTarget) {
      pendingVoiceTarget = target;
      try { sharedRecognition.stop(); } catch (e) {}
    } else {
      vcMute();
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

  // 상시 듣기로 들어온 말은 그대로 AI 튜터 질문으로 넘긴다.
  function handleAlwaysListenTranscript(transcript) {
    const said = (transcript || "").trim();
    if (!said) return;
    askInput.value = said;
    alwaysListenStatus.textContent = "인식됨: " + said;
    vibrate([15, 30, 15]);
    askTutor();
  }

  setupVoiceInput($("askMicBtn"), askInput, askStatus, () => askTutor());
  setupVoiceInput($("jumpMicBtn"), $("jumpInput"), null, () => doJump());
  setupVoiceInput($("quizMicBtn"), $("quizAnswerInput"), $("quizFeedback"), () => checkQuizAnswer());

  // ---- 화면·음성 접근성 설정 ----
  let fontZoom = parseFloat(localStorage.getItem("voxbook_fontzoom") || "1.0");
  document.body.style.zoom = fontZoom;
  $("fontIncreaseBtn").addEventListener("click", () => {
    fontZoom = Math.min(fontZoom + 0.1, 2.2);
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
    if (!vcSupported()) { showToast("이 브라우저는 음성 인식을 지원하지 않아요"); return; }
    alwaysListenOn = !alwaysListenOn;
    alwaysListenBtn.setAttribute("aria-pressed", alwaysListenOn ? "true" : "false");
    alwaysListenBtn.textContent = alwaysListenOn ? "🎙 항상 듣기: 켜짐" : "🎙 항상 듣기: 꺼짐";
    if (alwaysListenOn) {
      vcStart(handleAlwaysListenTranscript);
      alwaysListenStatus.textContent = "항상 듣기 모드 켜짐 — 아무 때나 말하면 자동으로 질문으로 인식돼요";
      showToast("항상 듣기 모드 켜짐");
    } else {
      vcStop();
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
    quizAnswerInput.value = ""; // 이전 문제에 썼던 답이 새 문제에 그대로 남아있지 않게 비움
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

  // ---- 보호자/교사용 학습 리포트: 단원별 재청취 횟수 + 퀴즈 정답률 ----
  const reportLoadBtn = $("reportLoadBtn");
  const reportSpeakBtn = $("reportSpeakBtn");
  const reportBox = $("reportBox");
  let lastReportSpeech = "";

  reportLoadBtn.addEventListener("click", async () => {
    reportBox.innerHTML = `<span style="color:var(--text-dim);font-size:13px;">불러오는 중...</span>`;
    reportSpeakBtn.style.display = "none";
    try {
      const { replayCounts, quizStats } = await VoxAPI.getProgressSummary();
      const byChapter = {};
      replayCounts.forEach((r) => {
        byChapter[r.chapterId] ||= { replay: 0, quizTotal: 0, quizCorrect: 0 };
        byChapter[r.chapterId].replay = r.count;
      });
      quizStats.forEach((q) => {
        byChapter[q.chapterId] ||= { replay: 0, quizTotal: 0, quizCorrect: 0 };
        byChapter[q.chapterId].quizTotal = q.total;
        byChapter[q.chapterId].quizCorrect = q.correct;
      });

      const rows = Object.entries(byChapter)
        .map(([chapterId, s]) => ({ chapter: chapterById(chapterId), ...s }))
        .filter((r) => r.chapter)
        .sort((a, b) => b.replay - a.replay);

      if (rows.length === 0) {
        reportBox.innerHTML = `<span style="color:var(--text-dim);font-size:13px;">아직 쌓인 학습 기록이 없어요.</span>`;
        return;
      }

      reportBox.innerHTML = rows.map((r) => {
        const acc = r.quizTotal > 0 ? Math.round((r.quizCorrect / r.quizTotal) * 100) : null;
        const struggling = r.replay >= 3 || (acc !== null && acc < 50);
        return `<div style="padding:10px 0;border-top:1px solid var(--surface-border);${struggling ? "color:var(--focus);" : ""}">
          <strong>${r.chapter.title}</strong><br>
          <span style="font-size:12.5px;color:var(--text-dim);">
            다시 듣기 ${r.replay}회 · ${acc !== null ? `퀴즈 정답률 ${acc}% (${r.quizCorrect}/${r.quizTotal})` : "퀴즈 기록 없음"}
            ${struggling ? " · ⚠ 어려워하는 것 같아요" : ""}
          </span>
        </div>`;
      }).join("");

      lastReportSpeech = "학습 리포트예요. " + rows.map((r) => {
        const acc = r.quizTotal > 0 ? Math.round((r.quizCorrect / r.quizTotal) * 100) : null;
        return `${r.chapter.title}, 다시 듣기 ${r.replay}번${acc !== null ? `, 퀴즈 정답률 ${acc}퍼센트` : ""}.`;
      }).join(" ");
      reportSpeakBtn.style.display = "inline-flex";
    } catch (e) {
      reportBox.innerHTML = `<span style="color:var(--danger);font-size:13px;">불러오기 실패: ${e.message}</span>`;
    }
  });

  reportSpeakBtn.addEventListener("click", () => {
    if (lastReportSpeech) speak(lastReportSpeech);
  });

  // ---- 그래프를 소리·진동으로 듣고 손으로 따라 그리기 (수학 단원 공통) ----
  // 단원별로 "직접 입력한 방정식"을 기억해 둔다. wireDynamicHandlers()가 다시 돌아도
  // 적용해 둔 방정식이 사라지지 않도록 클로저 밖(모듈 스코프)에 보관한다.
  const equationGraphs = new Map();
  let boundTraceCanvas = null;

  // AI가 뽑아준 type/coefficients로 실제 계산 가능한 함수를 만든다.
  // 정의역 정규화는 GraphSound.normalizeFn/playFromEquation이 맡는다.
  function buildEquationFn(type, coefficients) {
    const [a = 0, b = 0, c = 0] = coefficients || [];
    switch (type) {
      case "linear": return (x) => a * x + b;
      case "quadratic": return (x) => a * x * x + b * x + c;
      case "sine": return (x) => a * Math.sin(b * x + c);
      case "exponential": return (x) => a * Math.exp(b * x);
      case "logarithm": return (x) => a * Math.log(b * x);
      default: return null;
    }
  }

  function formatNum(n) {
    if (!Number.isFinite(n)) return String(n);
    return String(Math.round(n * 100) / 100);
  }

  // 꼭짓점·기울기 같은 수치는 AI에 묻지 않고 계수로 직접 계산한다(숫자를 지어낼 위험 없음).
  function buildEquationDescription(type, coefficients, equationLabel, aiAnalysis) {
    const [a = 0, b = 0, c = 0] = coefficients || [];
    let base;
    switch (type) {
      case "linear": {
        const dir = a > 0 ? "오른쪽 위로 올라가는" : a < 0 ? "오른쪽 아래로 내려가는" : "가로로 평평한";
        base = `${equationLabel}은 기울기 ${formatNum(a)}, y절편 ${formatNum(b)}인 ${dir} 직선입니다.`;
        break;
      }
      case "quadratic": {
        if (a === 0) {
          base = `${equationLabel} 그래프의 모양을 소리로 들려드립니다.`;
        } else {
          const vx = -b / (2 * a);
          const vy = a * vx * vx + b * vx + c;
          const shape = a > 0 ? "아래로 볼록한" : "위로 볼록한";
          base = `${equationLabel}은 ${shape} 포물선이며, 꼭짓점은 (${formatNum(vx)}, ${formatNum(vy)})입니다.`;
        }
        break;
      }
      case "sine": {
        const period = b !== 0 ? (2 * Math.PI) / Math.abs(b) : 0;
        base = `${equationLabel}은 진폭 ${formatNum(Math.abs(a))}, 주기 약 ${formatNum(period)}인 파도 모양의 곡선입니다.`;
        break;
      }
      case "exponential": {
        const trend = b > 0 ? "증가하는" : b < 0 ? "감소하는" : "변화 없는";
        base = `${equationLabel}은 x가 0일 때 값이 ${formatNum(a)}이고, x가 커질수록 ${trend} 지수함수 곡선입니다.`;
        break;
      }
      case "logarithm": {
        const trend = a > 0 ? "증가하는" : "감소하는";
        base = `${equationLabel}은 x가 커질수록 완만하게 ${trend} 로그함수 곡선입니다.`;
        break;
      }
      default:
        base = `${equationLabel} 그래프의 모양을 소리로 들려드립니다.`;
    }
    const extra = (aiAnalysis || "").trim();
    return extra ? `${base} ${extra}` : base;
  }

  function setupGraphPanel(chapter) {
    const id = chapter.id;
    const equationInput = $("graph-equation-text-" + id);
    const applyBtn = $("graph-apply-equation-" + id);
    const select = $("graph-type-select-" + id);
    const playBtnEl = $("graph-play-" + id);
    const traceToggle = $("graph-toggle-trace-" + id);
    const traceCanvas = $("graph-trace-" + id);
    const descEl = $("graph-desc-" + id);

    function currentEquation() { return equationGraphs.get(id) || null; }

    function ensureEquationOption() {
      const eq = currentEquation();
      if (!eq || select.querySelector('option[value="from-equation"]')) return;
      const opt = document.createElement("option");
      opt.value = "from-equation";
      opt.textContent = eq.label;
      select.insertBefore(opt, select.firstChild);
      select.value = "from-equation";
    }
    // 목차를 다시 그리면 select가 새로 만들어지므로, 적용해 둔 방정식 항목을 복구한다.
    ensureEquationOption();

    function updateTraceGraphFn() {
      if (!window.GraphTrace) return;
      const eq = currentEquation();
      if (select.value === "from-equation" && eq) {
        const normFn = GraphSound.normalizeFn(eq.fn, eq.domainMin, eq.domainMax);
        if (normFn) GraphTrace.setGraphFn(normFn);
        return;
      }
      const type = GraphSound.GRAPH_TYPES.find((g) => g.id === select.value);
      if (type) GraphTrace.setGraphFn(type.fn);
    }

    applyBtn.onclick = async () => {
      const text = equationInput.value.trim();
      if (!text) { speak("방정식을 입력해주세요."); showToast("방정식을 입력해주세요"); return; }
      applyBtn.disabled = true;
      descEl.textContent = "방정식을 분석하는 중...";
      speak("방정식을 분석하고 있습니다.");
      try {
        const parsed = await VoxAPI.aiParseGraphEquation(text);
        const fn = parsed.found ? buildEquationFn(parsed.type, parsed.coefficients) : null;
        if (!fn || !(parsed.domainMax > parsed.domainMin)) {
          descEl.textContent = "방정식을 인식하지 못했어요.";
          speak("방정식을 인식하지 못했습니다. 예를 들어 y = 2x^2 - 3x + 1처럼 입력해보세요.");
          return;
        }
        equationGraphs.set(id, {
          fn,
          domainMin: parsed.domainMin,
          domainMax: parsed.domainMax,
          label: `직접 입력한 방정식: ${parsed.equationLabel}`,
          desc: buildEquationDescription(parsed.type, parsed.coefficients, parsed.equationLabel, parsed.aiAnalysis),
        });
        const existing = select.querySelector('option[value="from-equation"]');
        if (existing) existing.remove();
        ensureEquationOption();
        updateTraceGraphFn();
        descEl.textContent = equationGraphs.get(id).label;
        speak(`${parsed.equationLabel} 방정식을 적용했습니다. 소리·진동으로 듣기 버튼을 눌러보세요.`);
      } catch (e) {
        descEl.textContent = "방정식을 분석하는 중 오류가 발생했어요.";
        speak("방정식을 분석하는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
      } finally {
        applyBtn.disabled = false;
      }
    };

    select.onchange = updateTraceGraphFn;

    playBtnEl.onclick = () => {
      // 마이크가 켜져 있으면 iOS가 오디오를 리시버로 라우팅해서 오실레이터 소리가
      // 거의 안 들리므로, 재생하는 동안은 마이크를 잠깐 끈다.
      vcMute();
      const eq = currentEquation();
      const type = select.value === "from-equation" && eq
        ? GraphSound.playFromEquation(eq.fn, eq.domainMin, eq.domainMax, eq)
        : GraphSound.play(select.value);
      if (!type) {
        // 뒤따를 speak()가 없으므로 여기서 직접 마이크를 돌려준다.
        vcUnmute();
        descEl.textContent = "그래프 소리를 재생하지 못했어요.";
        return;
      }
      descEl.textContent = `${type.label} · ${type.desc} [진동 상태: ${type.vibrateInfo}]`;
      // 오실레이터 음이 끝난 뒤에 설명을 읽어준다. speak()가 끝나면 onend에서 마이크가 자동 재개된다.
      setTimeout(() => speak(type.desc), GraphSound.DURATION * 1000);
    };

    traceToggle.onclick = () => {
      const opening = traceCanvas.hidden;
      traceCanvas.hidden = !opening;
      traceToggle.setAttribute("aria-pressed", opening ? "true" : "false");
      if (!opening) return;
      // GraphTrace는 한 번에 캔버스 하나에만 묶이는 싱글턴이다. 같은 캔버스에 중복으로
      // 리스너가 쌓이지 않도록, 지금 묶여 있는 캔버스와 다를 때만 다시 묶는다.
      if (window.GraphTrace && boundTraceCanvas !== traceCanvas) {
        GraphTrace.bind(traceCanvas);
        boundTraceCanvas = traceCanvas;
      }
      updateTraceGraphFn();
      speak("화면을 손가락으로 누르고 왼쪽에서 오른쪽으로 밀면서 그래프를 따라 그려보세요.");
    };
  }

  // ---- 여러 페이지 넣기 (PDF / 이미지 배치 가져오기) ----
  const batchImportPanel = $("batchImportPanel");
  const batchImportStatus = $("batchImportStatus");
  const batchPickFileBtn = $("batchPickFileBtn");
  const batchFileInput = $("batchFileInput");
  const libraryPanel = $("libraryPanel");

  const EMPTY_PAGE_TEXT = "(이 페이지에서는 글자를 읽지 못했어요)";

  function updateBatchStatus(text) { batchImportStatus.textContent = text; }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  // 북마크 제목에 "N단원"처럼 번호가 있으면 그걸 쓰고, 없으면 목차 안에서의 순서(1부터)를 쓴다.
  function deriveUnitNumber(title, indexFallback) {
    const m = (title || "").match(/(\d+)\s*단원/) || (title || "").match(/^[\s\S]{0,4}?(\d+)[.\s]/);
    if (m) return parseInt(m[1], 10);
    return indexFallback + 1;
  }

  async function detectSubjectOrDefault(text) {
    if (!text) return null;
    try { return await VoxAPI.aiDetectSubject(text); } catch (e) { return null; }
  }

  function speakMilestone(pct, spoken) {
    if (pct < spoken + 25 || pct >= 100) return spoken;
    const next = Math.floor(pct / 25) * 25;
    speak(`${next}퍼센트 처리했습니다.`);
    return next;
  }

  // 목차로 보이는 페이지를 찾아서(있으면) 단원 목록을 뽑고, 나머지 페이지를 한 번의 AI 요청으로
  // 일괄 매칭한다. PDF(북마크 없을 때)와 여러 장 사진 넣기 양쪽에서 공통으로 쓴다.
  async function recognizeUnitsFromPages(pagesText) {
    // 문장 중간에 "목차"라는 단어가 우연히 들어간 페이지(표지 소개 문구 등)까지 걸리지 않도록,
    // 페이지가 "목차"/"차례"라는 말로 시작할 때만 진짜 목차 페이지로 인정한다.
    const tocPageIndex = pagesText.slice(0, 3).findIndex((t) => t && /^(목차|차례)/.test(t.trim()));
    let units = null;
    if (tocPageIndex !== -1) {
      try {
        const parsed = await VoxAPI.aiExtractToc(pagesText[tocPageIndex]);
        if (parsed && parsed.length) units = parsed;
      } catch (e) { /* 목차 파싱 실패 시 목차 없이 진행 */ }
    }

    const matchedByIndex = new Map();
    if (units && units.length) {
      const pagesToMatch = [];
      for (let i = 0; i < pagesText.length; i++) {
        if (i === tocPageIndex) continue;
        if (pagesText[i]) pagesToMatch.push({ index: i, text: pagesText[i] });
      }
      if (pagesToMatch.length) {
        try {
          const assignments = await VoxAPI.aiMatchUnitsBatch(units, pagesToMatch);
          assignments.forEach((a) => matchedByIndex.set(a.index, a.unitNumber));
        } catch (e) { /* 매칭 실패 시 전부 미배정으로 진행 */ }
      }
    }

    return { tocPageIndex, matchedByIndex };
  }

  async function importPdfFile(file) {
    updateBatchStatus("PDF를 여는 중입니다...");
    speak("PDF를 처리하고 있습니다. 잠시만 기다려주세요.");

    // 파일 이름을 책 제목으로 써서, 같은 과목·단원번호를 쓰는 다른 책과 목차에서 구분되게 한다.
    const bookTitle = file.name.replace(/\.pdf$/i, "").trim() || "가져온 교과서";

    const pdfDoc = await window.PdfImport.openPdf(file);
    const totalPages = pdfDoc.numPages;
    const outline = await window.PdfImport.extractOutline(pdfDoc);

    // 1단계: 페이지별 텍스트 확보(텍스트 레이어 우선, 없으면 렌더링 + OCR)
    const pagesText = [];
    let spokenMilestone = 0;
    for (let i = 0; i < totalPages; i++) {
      let text = await window.PdfImport.extractPageText(pdfDoc, i);
      if (!text) {
        try {
          const dataUrl = await window.PdfImport.renderPageToDataUrl(pdfDoc, i);
          const result = await VoxAPI.aiOcr(dataUrl.split(",")[1], "image/jpeg");
          text = (result.text || "").trim() || null;
        } catch (e) {
          text = null;
        }
      }
      pagesText.push(text);

      const pct = Math.round(((i + 1) / totalPages) * 100);
      updateBatchStatus(`${i + 1} / ${totalPages}페이지 처리 중 (${pct}%)`);
      spokenMilestone = speakMilestone(pct, spokenMilestone);
    }

    // 과목은 책 전체에서 한 번만 분류한다(페이지마다 다시 분류하지 않음).
    const subject = await detectSubjectOrDefault(pagesText.find((t) => t && t.trim()));

    // 2단계: 목차 확정. 북마크가 있으면 그대로 쓰고, 없으면 목차로 보이는 페이지를 AI로 파싱해서
    // 단원을 매칭한다(recognizeUnitsFromPages). 목차 페이지 자체는 "책 내용"이 아니라 AI가 단원을
    // 인식하는 데만 쓰는 자료이므로, 실제 책 페이지 목록(payload)에는 넣지 않는다.
    let tocPageIndex = -1;
    let matchedByIndex = new Map();
    if (!outline) {
      const recognized = await recognizeUnitsFromPages(pagesText);
      tocPageIndex = recognized.tocPageIndex;
      matchedByIndex = recognized.matchedByIndex;
    }

    updateBatchStatus("단원을 배정하는 중입니다...");
    const payload = [];
    for (let i = 0; i < totalPages; i++) {
      if (i === tocPageIndex) continue; // 목차 페이지는 건너뛰고 AI 인식에만 활용
      const text = pagesText[i];
      if (!text) {
        payload.push({
          title: `${bookTitle} ${i + 1}페이지`,
          subject, bodyText: EMPTY_PAGE_TEXT, unitNumber: null,
          needsReview: true, reviewReason: "ocr_empty",
        });
        continue;
      }
      let unitNumber = null;
      if (outline) {
        const entry = window.PdfImport.findOutlineEntryForPage(outline, i);
        unitNumber = entry ? deriveUnitNumber(entry.title, outline.indexOf(entry)) : null;
      } else if (matchedByIndex.has(i)) {
        unitNumber = matchedByIndex.get(i);
      }
      const needsReview = unitNumber === null;
      payload.push({
        title: `${bookTitle} ${i + 1}페이지`,
        subject, bodyText: text, unitNumber,
        needsReview, reviewReason: needsReview ? "unit_unmatched" : null,
      });
    }

    const created = await VoxAPI.addChaptersBulk(payload, bookTitle);
    return {
      total: payload.length,
      needsReview: payload.filter((p) => p.needsReview).length,
      unit: "페이지",
      bookId: created[0] && created[0].bookId,
    };
  }

  async function importImageFiles(files) {
    updateBatchStatus(`0 / ${files.length}장 처리 중`);
    speak(`이미지 ${files.length}장을 처리하고 있습니다. 잠시만 기다려주세요.`);

    const pagesText = [];
    let spokenMilestone = 0;
    for (let i = 0; i < files.length; i++) {
      let text = null;
      try {
        const dataUrl = await readFileAsDataUrl(files[i]);
        const result = await VoxAPI.aiOcr(dataUrl.split(",")[1], files[i].type || "image/jpeg");
        text = (result.text || "").trim() || null;
      } catch (e) {
        text = null;
      }
      pagesText.push(text);

      const pct = Math.round(((i + 1) / files.length) * 100);
      updateBatchStatus(`${i + 1} / ${files.length}장 처리 중 (${pct}%)`);
      spokenMilestone = speakMilestone(pct, spokenMilestone);
    }

    const subject = await detectSubjectOrDefault(pagesText.find((t) => t && t.trim()));

    // 사진 여러 장을 한 번에 넣은 것도 하나의 책으로 취급 — 다른 배치와 목차에서 섞이지 않게 이름을 붙인다.
    const now = new Date();
    const stamp = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const bookTitle = `사진으로 넣은 교과서 (${stamp})`;

    // 찍은 사진 중에 목차 페이지가 섞여 있으면(예: 표지 다음에 목차를 찍은 경우) 그걸로 단원을
    // 인식해서 나머지 사진들을 자동 배정한다. PDF와 똑같은 인식 로직을 그대로 쓴다.
    updateBatchStatus("단원을 배정하는 중입니다...");
    const { tocPageIndex, matchedByIndex } = await recognizeUnitsFromPages(pagesText);

    const payload = [];
    for (let i = 0; i < files.length; i++) {
      if (i === tocPageIndex) continue; // 목차를 찍은 사진은 책 내용으로 넣지 않는다
      const text = pagesText[i];
      const unitNumber = text && matchedByIndex.has(i) ? matchedByIndex.get(i) : null;
      const needsReview = unitNumber === null;
      payload.push({
        title: `${bookTitle} ${i + 1}장`,
        subject,
        bodyText: text || EMPTY_PAGE_TEXT,
        unitNumber,
        needsReview,
        reviewReason: needsReview ? (text ? "unit_unmatched" : "ocr_empty") : null,
      });
    }

    const created = await VoxAPI.addChaptersBulk(payload, bookTitle);
    return {
      total: payload.length,
      needsReview: payload.filter((p) => p.needsReview).length,
      unit: "장",
      bookId: created[0] && created[0].bookId,
    };
  }

  $("openBatchImportBtn").addEventListener("click", () => {
    batchImportPanel.hidden = false;
    updateBatchStatus("PDF 한 개, 또는 이미지 여러 장을 고르면 한 번에 읽어서 교과서로 만들어요.");
    speak("여러 페이지 넣기를 열었습니다. 파일로 넣기 버튼을 눌러주세요.");
    vibrate(20);
  });
  $("closeBatchImportBtn").addEventListener("click", () => {
    batchImportPanel.hidden = true;
    vibrate(15);
  });
  batchPickFileBtn.addEventListener("click", () => batchFileInput.click());

  batchFileInput.addEventListener("change", async () => {
    const files = Array.from(batchFileInput.files || []);
    if (!files.length) return;
    batchPickFileBtn.disabled = true;
    try {
      const isSinglePdf = files.length === 1 && files[0].type === "application/pdf";
      if (isSinglePdf && !window.PdfImport) {
        throw new Error("PDF 처리 모듈을 불러오지 못했어요");
      }
      const result = isSinglePdf ? await importPdfFile(files[0]) : await importImageFiles(files);

      state.chapters = await VoxAPI.listChapters();
      renderAllChapters();
      batchImportPanel.hidden = true;
      openLibraryPanel(result.bookId);
      const summary = `총 ${result.total}${result.unit} 중 ${result.needsReview}${result.unit}는 확인이 필요합니다.`;
      updateBatchStatus(summary);
      speak(summary);
      vibrate([15, 40, 15]);
    } catch (err) {
      updateBatchStatus("파일을 처리하는 중 오류가 발생했어요: " + err.message);
      speak("파일을 처리하는 중 오류가 발생했습니다. 인터넷 연결과 서버 상태를 확인해주세요.");
      vibrate(200);
    } finally {
      batchPickFileBtn.disabled = false;
      batchFileInput.value = "";
    }
  });

  // ---- 교과서 목차 (Chapter 데이터를 과목·단원으로 묶어 보여주는 화면) ----

  // 여러 페이지 넣기(배치 가져오기)로 들어온, "책의 한 페이지"에 해당하는 단원인지 판단.
  // 시드 단원이나 사진 한 장으로 추가한 단원(단일 촬영)은 false — 목차에서 개별 카드로 그대로 보임.
  function chapterBelongsToBook(chapter) {
    return !!chapter.bookId;
  }

  // 같은 과목·단원번호를 쓰는 "다른 책"이 섞이지 않도록, bookId가 있으면 책 단위로,
  // 없으면(시드 단원, 사진 한 장 추가 등 예전 방식 데이터) 과목 단위로 묶는다.
  function groupKey(chapter) {
    const unitNumber = chapter.unitNumber ?? null;
    const unitPart = unitNumber === null ? "" : unitNumber;
    if (chapter.bookId) return `book:${chapter.bookId}|${unitPart}`;
    return `subj:${chapter.subject || "기타"}|${unitPart}`;
  }

  function sortGroupChapters(chapters) {
    return chapters.slice().sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  }

  function sortGroups(groups) {
    const subjectRank = (s) => {
      const i = SUBJECT_LIST.indexOf(s);
      return i === -1 ? SUBJECT_LIST.length : i;
    };
    return groups.sort((a, b) => {
      if (a.subject !== b.subject) return subjectRank(a.subject) - subjectRank(b.subject) || a.subject.localeCompare(b.subject);
      const at = a.bookTitle || "", bt = b.bookTitle || "";
      if (at !== bt) return at.localeCompare(bt);
      // 책 단위 그룹(buildBookGroups)에는 unitNumber가 아예 없을 수 있으니 0으로 취급한다.
      const au = a.unitNumber ?? 0, bu = b.unitNumber ?? 0;
      if (au === bu) return 0;
      if (a.unitNumber == null) return 1;
      if (b.unitNumber == null) return -1;
      return au - bu;
    });
  }

  function groupChapters(chapters) {
    const groups = new Map();
    chapters.forEach((chapter) => {
      const key = groupKey(chapter);
      if (!groups.has(key)) {
        groups.set(key, {
          subject: chapter.subject || "기타",
          unitNumber: chapter.unitNumber ?? null,
          bookId: chapter.bookId || null,
          bookTitle: chapter.bookTitle || null,
          chapters: [],
        });
      }
      groups.get(key).chapters.push(chapter);
    });
    return sortGroups([...groups.values()]);
  }

  // 메인 목차 카드 그리드용: 단원별로 쪼개지 않고 "책" 단위로만 폴더 카드를 만든다.
  // 단원 목록은 그 폴더를 눌렀을 때 "교과서 목차 열기" 화면에서 본다.
  function buildTocFolders() {
    return buildBookGroups();
  }

  // 책(bookId) 단위로 한 번 더 묶는다 — 목차 열기의 1단계(책 목록)용.
  function buildBookGroups() {
    const groups = new Map();
    state.chapters.filter((c) => c.bookId).forEach((chapter) => {
      if (!groups.has(chapter.bookId)) {
        groups.set(chapter.bookId, {
          bookId: chapter.bookId,
          bookTitle: chapter.bookTitle || "이름 없는 교과서",
          subject: chapter.subject || "기타",
          chapters: [],
        });
      }
      groups.get(chapter.bookId).chapters.push(chapter);
    });
    return [...groups.values()].sort((a, b) => a.bookTitle.localeCompare(b.bookTitle));
  }

  // 교과서 목차는 2단계: 먼저 어떤 책인지 고르고("책 목록"), 고른 책 안에서 단원별로 본다.
  // (한 과목·단원번호를 여러 책이 같이 쓸 수 있어서, 책을 먼저 고르지 않으면 어느 책 목차인지 알 수 없다.)
  function renderLibraryPanel() {
    const listEl = $("libraryUnitList");
    const backBtn = $("libraryBackToBooksBtn");
    listEl.innerHTML = "";

    if (!state.libraryOpenBookId) {
      backBtn.hidden = true;
      const books = buildBookGroups();
      books.forEach((book) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "icon-btn";
        btn.setAttribute("role", "listitem");
        const flaggedInBook = book.chapters.filter((c) => c.needsReview).length;
        btn.textContent = `📁 ${book.bookTitle} — ${book.subject} · ${book.chapters.length}페이지`
          + (flaggedInBook ? ` · 확인 필요 ${flaggedInBook}건` : "");
        btn.addEventListener("click", () => {
          state.libraryOpenBookId = book.bookId;
          renderLibraryPanel();
        });
        listEl.appendChild(btn);
      });

      const flagged = state.chapters.filter((c) => chapterBelongsToBook(c) && c.needsReview);
      $("librarySummary").textContent = books.length
        ? `가져온 교과서 ${books.length}권 · 확인 필요 ${flagged.length}건`
        : "아직 여러 페이지 넣기로 가져온 교과서가 없어요. '교과서 만들기'에서 추가해보세요.";
      $("libraryFlaggedBox").style.display = flagged.length > 0 ? "" : "none";
      $("libraryFlaggedCount").textContent = String(flagged.length);
      return;
    }

    // ---- 2단계: 고른 책의 단원 목록 ----
    backBtn.hidden = false;
    const book = buildBookGroups().find((b) => b.bookId === state.libraryOpenBookId);
    if (!book) { state.libraryOpenBookId = null; renderLibraryPanel(); return; }

    groupChapters(book.chapters).forEach((group) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "icon-btn";
      btn.setAttribute("role", "listitem");
      const unitLabel = group.unitNumber === null ? "미배정" : `${group.unitNumber}단원`;
      btn.textContent = `${unitLabel} — ${group.chapters.length}페이지`;
      btn.addEventListener("click", () => {
        setCurrentChapter(sortGroupChapters(group.chapters)[0].id);
        libraryPanel.hidden = true;
        showToast(`${book.bookTitle} · ${unitLabel}으로 이동`);
      });
      listEl.appendChild(btn);
    });

    const flaggedInBook = book.chapters.filter((c) => c.needsReview);
    $("librarySummary").textContent = `${book.bookTitle} · ${book.chapters.length}페이지 · 확인 필요 ${flaggedInBook.length}건`;
    $("libraryFlaggedBox").style.display = flaggedInBook.length > 0 ? "" : "none";
    $("libraryFlaggedCount").textContent = String(flaggedInBook.length);
  }

  // bookId를 주면 그 책의 단원 목록으로 바로 들어가고, 안 주면 책 목록부터 보여준다.
  function openLibraryPanel(bookId) {
    state.libraryOpenBookId = bookId || null;
    renderLibraryPanel();
    libraryPanel.hidden = false;
  }

  $("openLibraryBtn").addEventListener("click", () => {
    openLibraryPanel();
    const books = buildBookGroups().length;
    speak(`교과서 목차입니다. 가져온 책이 ${books}권 있습니다. 책을 눌러 목차를 확인하세요.`);
    vibrate(20);
  });
  $("closeLibraryBtn").addEventListener("click", () => {
    libraryPanel.hidden = true;
    vibrate(15);
  });
  $("libraryBackToBooksBtn").addEventListener("click", () => {
    state.libraryOpenBookId = null;
    renderLibraryPanel();
    vibrate(15);
  });
  // 확인 필요 목록은 별도 검수 화면을 만들지 않고, 첫 번째 항목으로 바로 이동시킨다.
  // 책 목록 단계에서 누르면 전체에서, 책 상세 단계에서 누르면 그 책 안에서만 찾는다.
  $("libraryFlaggedBtn").addEventListener("click", () => {
    const pool = state.libraryOpenBookId
      ? state.chapters.filter((c) => c.bookId === state.libraryOpenBookId)
      : state.chapters;
    const first = pool.find((c) => c.needsReview);
    if (!first) { showToast("확인이 필요한 항목이 없어요"); speak("확인이 필요한 항목이 없습니다."); return; }
    setCurrentChapter(first.id);
    libraryPanel.hidden = true;
    showToast("확인이 필요한 항목으로 이동");
  });

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
