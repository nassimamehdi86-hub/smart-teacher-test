// ============================================================
// Cloudflare Worker — بوابة آمنة بين تطبيق الاختبارات و Google Gemini API
// المفتاح السري (GEMINI_API_KEY) كيبقى مخبأ هنا، ماكيبانش فالمتصفح.
// التطبيق (exam-platform.html) كيبعث الطلب بصيغة Claude، وهاد الـ Worker
// كيترجمها لصيغة Gemini، وكيرجع الجواب بصيغة Claude باش التطبيق مايتبدلش.
// ============================================================

const ALLOWED_ORIGIN = "*"; // بدليها بعنوان GitHub Pages ديالك للأمان الأفضل
const GEMINI_MODEL = "gemini-flash-latest"; // اسم ثابت، Google كيبدلو أوتوماتيكيا لآخر نسخة فلاش خدامة

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: "Invalid JSON body" }, 400);
    }

    try {
      const geminiBody = claudeToGemini(body);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
      const data = await callGeminiWithRetry(url, geminiBody);
      return json(geminiToClaude(data), 200);
    } catch (e) {
      return json({ error: e.message || "Worker error" }, 500);
    }
  },
};

// إعادة محاولة أوتوماتيكية عند ازدحام Gemini المؤقت (503) أو تجاوز الحصة (429)
async function callGeminiWithRetry(url, geminiBody, maxAttempts = 4) {
  let lastErrText = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody),
    });
    const data = await resp.json();
    if (resp.ok) return data;

    const status = resp.status;
    lastErrText = data.error?.message || `Gemini API error (status ${status})`;
    const retryable = status === 503 || status === 429 || status === 500;
    if (!retryable || attempt === maxAttempts) {
      throw new Error(lastErrText);
    }
    // انتظار متزايد: 1.5s, 3s, 6s
    await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt - 1)));
  }
  throw new Error(lastErrText || "Gemini API error");
}

// ---- تحويل صيغة Claude (system + messages) إلى صيغة Gemini (contents) ----
function claudeToGemini(body) {
  const contents = (body.messages || []).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: contentToParts(m.content),
  }));
  const out = {
    contents,
    generationConfig: { maxOutputTokens: body.max_tokens || 1000 },
  };
  if (body.system) {
    out.system_instruction = { parts: [{ text: body.system }] };
  }
  return out;
}

function contentToParts(content) {
  if (typeof content === "string") return [{ text: content }];
  if (!Array.isArray(content)) return [{ text: String(content ?? "") }];
  return content.map((block) => {
    if (block.type === "text") return { text: block.text };
    if (block.type === "image") {
      return {
        inlineData: {
          mimeType: block.source?.media_type || "image/jpeg",
          data: block.source?.data || "",
        },
      };
    }
    return { text: "" };
  });
}

// ---- تحويل جواب Gemini إلى شكل جواب Claude لي كيتوقعو التطبيق ----
function geminiToClaude(data) {
  const cand = (data.candidates || [])[0];
  const parts = cand?.content?.parts || [];
  const text = parts.map((p) => p.text || "").join("");
  const finish = cand?.finishReason || "STOP";
  const stop_reason = finish === "MAX_TOKENS" ? "max_tokens" : "end_turn";
  return {
    content: [{ type: "text", text }],
    stop_reason,
  };
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}
