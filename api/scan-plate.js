"use strict";

// Vercel Serverless Function: POST /api/scan-plate
// Body: { image: "<base64 jpeg, no data: prefix>", mimeType: "image/jpeg" }
// Needs the GEMINI_API_KEY environment variable (Vercel > Settings > Environment Variables).

// Model IDs live here so they are easy to swap. Verify the exact names in Google AI Studio.
// You can also override them with the GEMINI_MODEL_PRIMARY / GEMINI_MODEL_FALLBACK env vars.
const PRIMARY_MODEL = process.env.GEMINI_MODEL_PRIMARY || "gemini-3.5-flash-lite";
const FALLBACK_MODEL = process.env.GEMINI_MODEL_FALLBACK || "gemini-3.8-flash";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
const REQUEST_TIMEOUT_MS = 20000;
const MAX_BASE64_CHARS = 3000000; // about 2.2 MB of image data; an 800px JPEG is far smaller
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];

// Statuses that should trigger the fallback model
const FALLBACK_STATUSES = [404, 429, 500, 502, 503, 504];

const SYSTEM_INSTRUCTION = [
  "You are a nutrition analyst for a fitness app used in the Philippines.",
  "The user sends one photo of a plate or meal. Identify every distinct food item visible,",
  "including Filipino dishes and ingredients (for example adobo, tinola, sinigang, tokwa,",
  "longganisa, tapa, pancit, lumpia, kare-kare, ginisang gulay, sinangag, kanin).",
  "Rules:",
  "- List each food as its own item. Rice is separate from the viand. Sauces and soups count only if they are a visible portion.",
  "- Use a short, common name (Filipino name where natural), max 40 characters.",
  "- Estimate the cooked or served weight in grams of each item from visual scale (plate, spoon, hand).",
  "- Give calories (kcal), protein, carbs and fat (grams) for that estimated portion, including visible cooking oil and sauce.",
  "- Be realistic, not optimistic. Do not invent items that are not visible.",
  "- If the image has no food, return an empty items array.",
  "- Return only JSON that matches the schema. No commentary."
].join("\n");

const NUMBER = { type: "NUMBER" };

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          grams: NUMBER,
          calories: NUMBER,
          protein: NUMBER,
          carbs: NUMBER,
          fat: NUMBER
        },
        required: ["name", "grams", "calories", "protein", "carbs", "fat"]
      }
    },
    totals: {
      type: "OBJECT",
      properties: {
        calories: NUMBER,
        protein: NUMBER,
        carbs: NUMBER,
        fat: NUMBER
      }
    }
  },
  required: ["items"]
};

function round(value, places) {
  const factor = Math.pow(10, places);
  return Math.round(value * factor) / factor;
}

function toNumber(value, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (error) {
      return null;
    }
  }
  return body && typeof body === "object" ? body : null;
}

async function callGemini(model, apiKey, image, mimeType) {
  const response = await fetch(API_BASE + model + ":generateContent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [
        {
          role: "user",
          parts: [
            { inline_data: { mime_type: mimeType, data: image } },
            { text: "Analyze this plate." }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA
      }
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }
  return { status: response.status, ok: response.ok, data };
}

function extractText(data) {
  const parts = data && data.candidates && data.candidates[0] &&
    data.candidates[0].content && data.candidates[0].content.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map(part => (part && part.text) || "").join("");
}

function parseModelJson(text) {
  const clean = String(text).replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(clean);
}

// Never trust the model's output shape or its totals: rebuild both here.
function sanitize(parsed) {
  const rawItems = parsed && Array.isArray(parsed.items) ? parsed.items : [];

  const items = rawItems
    .filter(item => item && typeof item === "object")
    .map(item => ({
      name: String(item.name || "").trim().slice(0, 60),
      grams: round(toNumber(item.grams, 2000), 0),
      calories: round(toNumber(item.calories, 3000), 0),
      protein: round(toNumber(item.protein, 300), 1),
      carbs: round(toNumber(item.carbs, 500), 1),
      fat: round(toNumber(item.fat, 300), 1)
    }))
    .filter(item => item.name && item.grams > 0)
    .slice(0, 12);

  const totals = items.reduce(
    (sum, item) => ({
      calories: sum.calories + item.calories,
      protein: sum.protein + item.protein,
      carbs: sum.carbs + item.carbs,
      fat: sum.fat + item.fat
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  return {
    items,
    totals: {
      calories: round(totals.calories, 0),
      protein: round(totals.protein, 1),
      carbs: round(totals.carbs, 1),
      fat: round(totals.fat, 1)
    }
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY is not set on the server." });
  }

  const body = parseBody(req);
  const image = body && typeof body.image === "string"
    ? body.image.replace(/^data:[^,]+,/, "").trim()
    : "";
  const mimeType = body && ALLOWED_MIME.includes(body.mimeType) ? body.mimeType : "image/jpeg";

  if (!image) {
    return res.status(400).json({ error: "No image was sent." });
  }
  if (image.length > MAX_BASE64_CHARS) {
    return res.status(413).json({ error: "Image is too large." });
  }

  const models = [PRIMARY_MODEL, FALLBACK_MODEL];
  let result = null;
  let usedModel = null;

  for (let i = 0; i < models.length; i++) {
    try {
      result = await callGemini(models[i], apiKey, image, mimeType);
      usedModel = models[i];
    } catch (error) {
      // Timeout or network error: treat it like a retryable failure
      result = { status: 0, ok: false, data: null };
      usedModel = models[i];
    }

    if (result.ok) break;
    if (!FALLBACK_STATUSES.includes(result.status) && result.status !== 0) break;
  }

  if (!result || !result.ok) {
    const status = result && result.status;
    if (status === 429) {
      return res.status(429).json({ error: "The AI is busy right now. Wait a moment and scan again." });
    }
    return res.status(502).json({ error: "The AI service could not read this photo. Try again." });
  }

  if (result.data && result.data.promptFeedback && result.data.promptFeedback.blockReason) {
    return res.status(422).json({ error: "This photo could not be analyzed. Try a different angle." });
  }

  let parsed;
  try {
    parsed = parseModelJson(extractText(result.data));
  } catch (error) {
    return res.status(502).json({ error: "The AI returned an unreadable answer. Scan again." });
  }

  return res.status(200).json(Object.assign(sanitize(parsed), { model: usedModel }));
};
