// "-latest" 별칭을 쓰면 Google이 권장 모델을 바꿔도 코드 수정 없이 따라감
const PRIMARY_MODEL = "gemini-flash-latest";
// flash 모델이 과부하로 503을 내거나 응답 없이 멈출 때 lite 모델은 정상 응답하는 경우가
// 많아서(실제 확인됨), 일시 오류가 나면 lite로 넘겨서 다시 시도한다.
const FALLBACK_MODEL = "gemini-flash-lite-latest";

function geminiUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

// Gemini가 "high demand"일 때 응답을 아예 안 주고 무한정 멈추는 경우가 있어서
// (수 분 이상 응답 없음 확인됨), 타임아웃 없이 fetch만 걸어두면 사용자 화면이
// 로딩 상태로 영원히 멈춰버린다. 기본 모델은 25초만 기다리고 lite로 넘기며,
// lite도 45초를 넘기면 명확한 에러로 실패시킨다.
const PRIMARY_TIMEOUT_MS = 25000;
const FALLBACK_TIMEOUT_MS = 45000;

const TIMEOUT_MESSAGE =
  "AI 응답이 너무 오래 걸려서 중단했어요 (지금 요청이 많이 몰린 것 같아요). 잠시 후 다시 시도해 주세요";

// "high demand"/"overloaded"처럼 잠깐 붐벼서 나는 에러는 몇 초 뒤 재시도하면 되는 경우가
// 많다. 반대로 할당량 초과(quota exceeded)는 지금 당장 재시도해도 똑같이 실패하므로
// 재시도 대상에서 뺀다 — 안 그래도 부족한 하루 요청 수만 더 깎아먹는다.
function isTransientError(message) {
  if (message === TIMEOUT_MESSAGE) return true;
  const m = (message || "").toLowerCase();
  return (m.includes("high demand") || m.includes("overloaded") || m.includes("unavailable"))
    && !m.includes("quota");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGeminiPartsOnce(systemPrompt, parts, model, timeoutMs) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("서버에 GEMINI_API_KEY가 설정되어 있지 않아요");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(geminiUrl(model), {
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
      throw new Error(TIMEOUT_MESSAGE);
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
    throw new Error(msg);
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

// 기본 모델 1번 → 일시 오류면 lite 모델로 최대 2번. 뒤로 갈수록 대기 시간을 늘린다.
const ATTEMPTS = [
  { model: PRIMARY_MODEL, timeoutMs: PRIMARY_TIMEOUT_MS, delayBeforeMs: 0 },
  { model: FALLBACK_MODEL, timeoutMs: FALLBACK_TIMEOUT_MS, delayBeforeMs: 0 },
  { model: FALLBACK_MODEL, timeoutMs: FALLBACK_TIMEOUT_MS, delayBeforeMs: 3000 },
];

async function callGeminiParts(systemPrompt, parts) {
  let lastErr;
  for (const { model, timeoutMs, delayBeforeMs } of ATTEMPTS) {
    if (delayBeforeMs) await sleep(delayBeforeMs);
    try {
      return await callGeminiPartsOnce(systemPrompt, parts, model, timeoutMs);
    } catch (err) {
      if (!isTransientError(err.message)) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
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
