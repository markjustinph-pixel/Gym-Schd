// GET /api/exercise-video?name=lat%20pull-down  ->  { id: "<11-char YouTube id>" }
// Uses the YouTube Data API v3. The key lives only in the Vercel env var YOUTUBE_API_KEY.

const SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
const TIMEOUT_MS = 8000;
const MAX_NAME_LENGTH = 80;
const NAME_PATTERN = /^[a-z0-9 ()'+.,&-]+$/i;

// Successful answers are cached by Vercel's CDN for 30 days, so each exercise is
// searched once, not on every tap. That keeps usage far below the free daily quota.
const CACHE_OK = "public, s-maxage=2592000, stale-while-revalidate=86400";

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Video lookup is not configured." });
  }

  const name = String((req.query && req.query.name) || "").trim().replace(/\s+/g, " ");
  if (!name || name.length > MAX_NAME_LENGTH || !NAME_PATTERN.test(name)) {
    return res.status(400).json({ error: "Invalid exercise name." });
  }

  const params = new URLSearchParams({
    part: "snippet",
    q: name + " exercise proper form",
    type: "video",
    videoEmbeddable: "true",
    videoSyndicated: "true",
    safeSearch: "strict",
    relevanceLanguage: "en",
    maxResults: "5",
    key: apiKey
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(SEARCH_URL + "?" + params.toString(), {
      signal: controller.signal
    });

    if (!response.ok) {
      // 403 usually means the daily quota is used up. Never cache failures.
      res.setHeader("Cache-Control", "no-store");
      return res.status(503).json({ error: "Video lookup is unavailable right now." });
    }

    const data = await response.json();
    const items = Array.isArray(data && data.items) ? data.items : [];
    const match = items.find(item => item && item.id && /^[\w-]{11}$/.test(item.id.videoId || ""));

    if (!match) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(404).json({ error: "No video found." });
    }

    res.setHeader("Cache-Control", CACHE_OK);
    return res.status(200).json({ id: match.id.videoId });
  } catch (error) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(504).json({ error: "Video lookup timed out." });
  } finally {
    clearTimeout(timer);
  }
};
