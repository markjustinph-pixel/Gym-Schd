"use strict";

// Vercel Serverless Function: POST /api/scan-plate
// Body: { image: "<base64 jpeg, no data: prefix>", mimeType: "image/jpeg" }
//
// Pipeline:
//   1. Gemini Vision identifies each food and estimates grams (it is NOT trusted for macros).
//   2. Per-100g values come from, in order: PhilFCT (data/philfct.json) -> USDA FoodData Central
//      -> Open Food Facts (packaged only) -> FatSecret (optional) -> Gemini's own estimate.
//   3. The server computes macros = per100 * grams / 100.
//
// Env vars: GEMINI_API_KEY (required), USDA_API_KEY, FATSECRET_CLIENT_ID, FATSECRET_CLIENT_SECRET (optional).

let PHILFCT = [];
try {
  PHILFCT = require("../data/philfct.json");
} catch (error) {
  PHILFCT = [];
}

const PRIMARY_MODEL = process.env.GEMINI_MODEL_PRIMARY || "gemini-3.5-flash-lite";
const FALLBACK_MODEL = process.env.GEMINI_MODEL_FALLBACK || "gemini-3.8-flash";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
const REQUEST_TIMEOUT_MS = 20000;
const LOOKUP_TIMEOUT_MS = 5000;
const MAX_BASE64_CHARS = 3000000;
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];
const FALLBACK_STATUSES = [404, 429, 500, 502, 503, 504];

const SYSTEM_INSTRUCTION = [
  "You are a food identification assistant for a fitness app used in the Philippines.",
  "The user sends one photo of a plate or meal. Identify every distinct food item visible,",
  "including Filipino dishes (adobo, tinola, sinigang, tokwa, longganisa, tapa, pancit, lumpia,",
  "kare-kare, ginisang gulay, sinangag, kanin).",
  "Rules:",
  "- List each food as its own item. Rice is separate from the viand. Count sauces and soups only if a visible portion.",
  "- name: short common name shown to the user (Filipino where natural), max 40 characters.",
  "- searchName: a simple English database search term for the food as eaten, for example 'rice white cooked', 'chicken breast fried', 'egg fried'. Max 40 characters.",
  "- category: 'local_dish' for Filipino dishes, 'generic' for plain ingredients, 'packaged' only if a branded packaged product is clearly visible.",
  "- state: 'cooked', 'raw' or 'packaged'. Food on a plate is almost always 'cooked'.",
  "- brand: the visible brand name for packaged items, otherwise an empty string.",
  "- grams: estimated served weight in grams. Use visible size cues (plate diameter, spoon, fork, hand). Be CONSERVATIVE: when unsure, choose the lower estimate. A typical rice scoop on a small plate is 60-100 g, a full cup of cooked rice is about 160 g.",
  "- confidence: 'high', 'medium' or 'low' for the identification.",
  "- calories, protein, carbs, fat: your own rough estimate for that portion. These are only a last-resort fallback.",
  "- Do not invent items that are not visible. If there is no food, return an empty items array.",
  "- Return only JSON that matches the schema. No commentary."
].join("\n");

const NUMBER = { type: "NUMBER" };
const STRING = { type: "STRING" };

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: STRING,
          searchName: STRING,
          category: STRING,
          state: STRING,
          brand: STRING,
          grams: NUMBER,
          confidence: STRING,
          calories: NUMBER,
          protein: NUMBER,
          carbs: NUMBER,
          fat: NUMBER
        },
        required: ["name", "searchName", "category", "state", "grams", "calories", "protein", "carbs", "fat"]
      }
    }
  },
  required: ["items"]
};

/* ---------- small helpers ---------- */

function round(value, places) {
  const factor = Math.pow(10, places);
  return Math.round(value * factor) / factor;
}

function toNumber(value, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
}

function clean(text, max) {
  return String(text || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

function normalize(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9\u00f1 ]/g, " ").replace(/\s+/g, " ").trim();
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

async function fetchJson(url, options) {
  try {
    const response = await fetch(url, Object.assign({ signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) }, options));
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    return null;
  }
}

// A real food's calories should roughly match 4*protein + 4*carbs + 9*fat. Reject bad matches.
function looksValid(p) {
  if (!p) return false;
  const { calories, protein, carbs, fat } = p;
  if (![calories, protein, carbs, fat].every(Number.isFinite)) return false;
  if (calories < 0 || calories > 900 || protein > 100 || carbs > 100 || fat > 100) return false;
  const calc = 4 * protein + 4 * carbs + 9 * fat;
  return Math.abs(calories - calc) <= Math.max(25, 0.35 * calc);
}

/* ---------- Gemini ---------- */

async function callGemini(model, apiKey, image, mimeType) {
  const response = await fetch(API_BASE + model + ":generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
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
  const stripped = String(text).replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(stripped);
}

function sanitizeDetected(parsed) {
  const raw = parsed && Array.isArray(parsed.items) ? parsed.items : [];
  return raw
    .filter(item => item && typeof item === "object")
    .map(item => {
      const category = ["local_dish", "generic", "packaged"].includes(item.category) ? item.category : "generic";
      const state = ["cooked", "raw", "packaged"].includes(item.state) ? item.state : "cooked";
      const confidence = ["high", "medium", "low"].includes(item.confidence) ? item.confidence : "medium";
      return {
        name: clean(item.name, 60),
        searchName: clean(item.searchName || item.name, 60),
        category,
        state,
        brand: clean(item.brand, 40),
        confidence,
        grams: round(Math.min(Math.max(toNumber(item.grams, 1500), 0), 1500), 0),
        aiMacros: {
          calories: toNumber(item.calories, 3000),
          protein: toNumber(item.protein, 300),
          carbs: toNumber(item.carbs, 500),
          fat: toNumber(item.fat, 300)
        }
      };
    })
    .filter(item => item.name && item.grams > 0)
    .slice(0, 12);
}

/* ---------- Lookup 1: PhilFCT (local json) ---------- */

function lookupPhilfct(item) {
  const names = [normalize(item.name), normalize(item.searchName)].filter(Boolean);
  for (const entry of PHILFCT) {
    const aliases = (entry.names || []).map(normalize);
    for (const alias of aliases) {
      for (const name of names) {
        if (name === alias || (" " + name + " ").includes(" " + alias + " ")) {
          if (looksValid(entry.per100)) {
            return { per100: entry.per100, source: entry.source || "PhilFCT" };
          }
        }
      }
    }
  }
  return null;
}

/* ---------- Lookup 2: USDA FoodData Central ---------- */

const COOK_WORDS = /cooked|boiled|fried|roasted|baked|grilled|steamed|broiled|stewed|braised|simmered|saut|toasted/i;
const RAW_WORDS = /\braw\b|uncooked|\bdry\b|dehydrated/i;

function usdaNutrient(list, numbers, ids) {
  const found = (list || []).find(n =>
    numbers.includes(String(n.nutrientNumber)) || ids.includes(Number(n.nutrientId)));
  return found ? Number(found.value) : NaN;
}

async function lookupUsda(item) {
  const key = process.env.USDA_API_KEY;
  if (!key || item.category === "packaged") return null;

  const url = "https://api.nal.usda.gov/fdc/v1/foods/search?api_key=" + encodeURIComponent(key) +
    "&query=" + encodeURIComponent(item.searchName) +
    "&dataType=" + encodeURIComponent("Foundation,SR Legacy") + "&pageSize=10";
  const data = await fetchJson(url);
  const foods = data && Array.isArray(data.foods) ? data.foods : [];

  for (const food of foods) {
    const description = String(food.description || "");
    if (item.state === "cooked" && (!COOK_WORDS.test(description) || RAW_WORDS.test(description))) continue;

    const per100 = {
      calories: usdaNutrient(food.foodNutrients, ["208", "957", "958"], [1008, 2047, 2048]),
      protein: usdaNutrient(food.foodNutrients, ["203"], [1003]),
      carbs: usdaNutrient(food.foodNutrients, ["205"], [1005]),
      fat: usdaNutrient(food.foodNutrients, ["204"], [1004])
    };
    if (looksValid(per100)) return { per100, source: "USDA" };
  }
  return null;
}

/* ---------- Lookup 3: Open Food Facts (packaged products only) ---------- */

async function lookupOpenFoodFacts(item) {
  if (item.category !== "packaged") return null;
  const terms = (item.brand + " " + item.searchName).trim();
  const url = "https://world.openfoodfacts.org/cgi/search.pl?search_simple=1&action=process&json=1&page_size=5" +
    "&fields=product_name,brands,nutriments&search_terms=" + encodeURIComponent(terms);
  const data = await fetchJson(url, { headers: { "User-Agent": "MJM-Workout-Planner/1.0 (personal project)" } });
  const products = data && Array.isArray(data.products) ? data.products : [];

  for (const product of products) {
    const n = product.nutriments || {};
    const per100 = {
      calories: Number(n["energy-kcal_100g"]),
      protein: Number(n.proteins_100g),
      carbs: Number(n.carbohydrates_100g),
      fat: Number(n.fat_100g)
    };
    if (looksValid(per100)) return { per100, source: "Open Food Facts" };
  }
  return null;
}

/* ---------- Lookup 4: FatSecret (optional, skipped if keys or IP access are missing) ---------- */

let fatSecretToken = { value: "", expires: 0 };

async function getFatSecretToken() {
  const id = process.env.FATSECRET_CLIENT_ID;
  const secret = process.env.FATSECRET_CLIENT_SECRET;
  if (!id || !secret) return "";
  if (fatSecretToken.value && Date.now() < fatSecretToken.expires) return fatSecretToken.value;

  const data = await fetchJson("https://oauth.fatsecret.com/connect/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(id + ":" + secret).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials&scope=basic"
  });
  if (!data || !data.access_token) return "";
  fatSecretToken = { value: data.access_token, expires: Date.now() + (Number(data.expires_in) || 3600) * 900 };
  return fatSecretToken.value;
}

function parseFatSecretDescription(text) {
  const s = String(text || "");
  if (!/^per 100g/i.test(s)) return null;
  const grab = re => {
    const m = s.match(re);
    return m ? Number(m[1]) : NaN;
  };
  return {
    calories: grab(/Calories:\s*([\d.]+)/i),
    fat: grab(/Fat:\s*([\d.]+)/i),
    carbs: grab(/Carbs:\s*([\d.]+)/i),
    protein: grab(/Protein:\s*([\d.]+)/i)
  };
}

async function lookupFatSecret(item) {
  const token = await getFatSecretToken();
  if (!token) return null;

  const url = "https://platform.fatsecret.com/rest/server.api?method=foods.search&format=json&max_results=10" +
    "&search_expression=" + encodeURIComponent(item.searchName);
  const data = await fetchJson(url, { headers: { Authorization: "Bearer " + token } });
  let foods = data && data.foods && data.foods.food;
  if (!foods) return null;
  if (!Array.isArray(foods)) foods = [foods];

  for (const food of foods) {
    if (item.category !== "packaged" && food.food_type === "Brand") continue;
    const per100 = parseFatSecretDescription(food.food_description);
    if (looksValid(per100)) return { per100, source: "FatSecret" };
  }
  return null;
}

/* ---------- Combine ---------- */

async function resolveItem(item) {
  const steps = [lookupPhilfct, lookupUsda, lookupOpenFoodFacts, lookupFatSecret];
  let match = null;

  for (const step of steps) {
    try {
      match = await step(item);
    } catch (error) {
      match = null;
    }
    if (match) break;
  }

  if (!match) {
    // Last resort: Gemini's own portion estimate, converted to per-100g
    const a = item.aiMacros;
    match = {
      per100: {
        calories: (a.calories / item.grams) * 100,
        protein: (a.protein / item.grams) * 100,
        carbs: (a.carbs / item.grams) * 100,
        fat: (a.fat / item.grams) * 100
      },
      source: "AI estimate"
    };
  }

  const per100 = {
    calories: round(match.per100.calories, 1),
    protein: round(match.per100.protein, 2),
    carbs: round(match.per100.carbs, 2),
    fat: round(match.per100.fat, 2)
  };
  const factor = item.grams / 100;

  return {
    name: item.name,
    grams: item.grams,
    calories: round(per100.calories * factor, 0),
    protein: round(per100.protein * factor, 1),
    carbs: round(per100.carbs * factor, 1),
    fat: round(per100.fat * factor, 1),
    per100,
    source: match.source,
    confidence: item.confidence
  };
}

function buildTotals(items) {
  const t = items.reduce(
    (sum, i) => ({
      calories: sum.calories + i.calories,
      protein: sum.protein + i.protein,
      carbs: sum.carbs + i.carbs,
      fat: sum.fat + i.fat
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
  return {
    calories: round(t.calories, 0),
    protein: round(t.protein, 1),
    carbs: round(t.carbs, 1),
    fat: round(t.fat, 1)
  };
}

/* ---------- Handler ---------- */

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

  if (!image) return res.status(400).json({ error: "No image was sent." });
  if (image.length > MAX_BASE64_CHARS) return res.status(413).json({ error: "Image is too large." });

  const models = [PRIMARY_MODEL, FALLBACK_MODEL];
  let result = null;
  let usedModel = null;

  for (let i = 0; i < models.length; i++) {
    try {
      result = await callGemini(models[i], apiKey, image, mimeType);
      usedModel = models[i];
    } catch (error) {
      result = { status: 0, ok: false, data: null };
      usedModel = models[i];
    }
    if (result.ok) break;
    if (!FALLBACK_STATUSES.includes(result.status) && result.status !== 0) break;
  }

  if (!result || !result.ok) {
    if (result && result.status === 429) {
      return res.status(429).json({ error: "The AI is busy right now. Wait a moment and scan again." });
    }
    return res.status(502).json({ error: "The AI service could not read this photo. Try again." });
  }

  if (result.data && result.data.promptFeedback && result.data.promptFeedback.blockReason) {
    return res.status(422).json({ error: "This photo could not be analyzed. Try a different angle." });
  }

  let detected;
  try {
    detected = sanitizeDetected(parseModelJson(extractText(result.data)));
  } catch (error) {
    return res.status(502).json({ error: "The AI returned an unreadable answer. Scan again." });
  }

  const items = await Promise.all(detected.map(resolveItem));

  return res.status(200).json({ items, totals: buildTotals(items), model: usedModel });
};
