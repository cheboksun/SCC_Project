// "-latest" 별칭을 쓰면 Google이 권장 모델을 바꿔도 코드 수정 없이 따라감
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent";

async function callGemini(systemPrompt, userPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("서버에 GEMINI_API_KEY가 설정되어 있지 않아요");
  }

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
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      }),
    });
  } catch (networkErr) {
    throw new Error("AI 서버 네트워크 요청 실패: " + networkErr.message);
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
  const parts = candidate.content && candidate.content.parts ? candidate.content.parts : [];
  const text = parts.map((p) => p.text || "").join(" ").trim();
  if (!text) {
    throw new Error("AI가 빈 응답을 반환했어요 (finishReason: " + (candidate.finishReason || "?") + ")");
  }
  return text;
}

module.exports = { callGemini };
