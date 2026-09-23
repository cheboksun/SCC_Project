// "-latest" 별칭을 쓰면 Google이 권장 모델을 바꿔도 코드 수정 없이 따라감
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent";

// Gemini가 "high demand"일 때 응답을 아예 안 주고 무한정 멈추는 경우가 있어서
// (수 분 이상 응답 없음 확인됨), 타임아웃 없이 fetch만 걸어두면 사용자 화면이
// 로딩 상태로 영원히 멈춰버린다. 45초를 넘기면 명확한 에러로 실패시킨다.
const GEMINI_TIMEOUT_MS = 45000;

// "high demand"(503)나 순간 할당량 초과(429)는 몇 초 뒤 다시 보내면 대부분 성공한다.
// 여러 페이지를 연달아 인식할 때 이 일시 오류 한 번에 페이지가 통째로 빈 페이지가 되지 않도록 재시도한다.
const RETRY_DELAYS_MS = [2000, 5000];
const RETRYABLE_STATUS = new Set([429, 500, 503]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGeminiParts(systemPrompt, parts) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await callGeminiOnce(systemPrompt, parts);
    } catch (err) {
      if (!err.retryable || attempt >= RETRY_DELAYS_MS.length) throw err;
      console.warn(`[ai] 일시 오류로 재시도 (${attempt + 1}/${RETRY_DELAYS_MS.length}): ${err.message}`);
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

async function callGeminiOnce(systemPrompt, parts) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("서버에 GEMINI_API_KEY가 설정되어 있지 않아요");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts }],
      }),
      signal: controller.signal,
    });
  } catch (networkErr) {
    if (networkErr.name === "AbortError") {
      throw new Error("AI 응답이 너무 오래 걸려서 중단했어요 (지금 요청이 많이 몰린 것 같아요). 잠시 후 다시 시도해 주세요");
    }
    throw new Error("AI 서버 네트워크 요청 실패: " + networkErr.message);
  } finally {
    clearTimeout(timer);
  }

  let data;
  try {
    data = await response.json();
  } catch (parseErr) {
    throw new Error("AI 응답 해석 실패 (status " + response.status + ")");
  }

  if (!response.ok || data.error) {
    const msg = (data.error && data.error.message) || "HTTP " + response.status;
    const err = new Error(msg);
    err.retryable = RETRYABLE_STATUS.has(response.status) || /high demand|overloaded/i.test(msg);
    throw err;
  }

  const candidate = (data.candidates || [])[0];
  if (!candidate) {
    throw new Error("AI가 답을 생성하지 못했어요");
  }
  const responseParts = candidate.content && candidate.content.parts ? candidate.content.parts : [];
  const text = responseParts.map((p) => p.text || "").join(" ").trim();
  if (!text) {
    throw new Error("AI가 빈 응답을 반환했어요 (finishReason: " + (candidate.finishReason || "?") + ")");
  }
  return text;
}

async function callGemini(systemPrompt, userPrompt) {
  return callGeminiParts(systemPrompt, [{ text: userPrompt }]);
}

// 촬영한 교과서 페이지 이미지를 직접 보고 텍스트/과목/그림 설명을 뽑아낼 때 사용
async function callGeminiVision(systemPrompt, userPrompt, imageBase64, mimeType) {
  return callGeminiParts(systemPrompt, [
    { text: userPrompt },
    { inlineData: { mimeType: mimeType || "image/jpeg", data: imageBase64 } },
  ]);
}

module.exports = { callGemini, callGeminiVision };
