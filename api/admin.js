"use strict";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function getConfig() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminUserId = process.env.ADMIN_USER_ID;

  if (!url || !anonKey || !serviceKey || !UUID_PATTERN.test(adminUserId || "")) {
    throw new ApiError(503, "Admin service is not configured in Vercel.");
  }

  return {
    url: url.replace(/\/+$/, ""),
    anonKey,
    serviceKey,
    adminUserId: adminUserId.toLowerCase()
  };
}

async function responseJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return { message: text };
  }
}

async function supabaseRequest(config, path, options = {}) {
  const response = await fetch(`${config.url}${path}`, {
    ...options,
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  const data = await responseJson(response);
  if (!response.ok) {
    console.error("Supabase admin request failed:", response.status, data);
    throw new ApiError(502, `Supabase could not complete the admin request (${response.status}).`);
  }
  return data;
}

async function verifyAdmin(req, config) {
  const authorization = req.headers && req.headers.authorization;
  const match = typeof authorization === "string"
    ? authorization.match(/^Bearer\s+([^\s]+)$/i)
    : null;
  if (!match || match[1].length > 4096) {
    throw new ApiError(401, "Sign in to continue.");
  }

  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${match[1]}`
    }
  });
  const user = await responseJson(response);
  if (!response.ok || !user || typeof user.id !== "string") {
    throw new ApiError(401, "Your session is invalid or expired. Sign in again.");
  }
  if (user.id.toLowerCase() !== config.adminUserId) {
    throw new ApiError(403, "This account does not have administrator access.");
  }
  return user;
}

function getBody(req) {
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
    return req.body;
  }
  if (typeof req.body !== "string" || req.body.length > 200000) {
    throw new ApiError(400, "Invalid request body.");
  }
  try {
    const body = JSON.parse(req.body);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Expected an object.");
    }
    return body;
  } catch (error) {
    throw new ApiError(400, "Request body must be valid JSON.");
  }
}

function validPlan(value) {
  if (value === null) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return WEEKDAYS.every(day => {
    const entry = value[day];
    return entry &&
      typeof entry.on === "boolean" &&
      typeof entry.title === "string" &&
      typeof entry.time === "string" &&
      Array.isArray(entry.exercises) &&
      entry.exercises.every(exercise =>
        exercise &&
        typeof exercise.name === "string" &&
        Number.isFinite(exercise.sets) &&
        typeof exercise.reps === "string" &&
        typeof exercise.rest === "string"
      );
  });
}

function validMacroGoal(value) {
  if (value === null) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const profile = value.profile;
  const targets = value.targets;
  return Boolean(
    profile &&
    typeof profile === "object" &&
    typeof profile.goal === "string" &&
    targets &&
    typeof targets === "object" &&
    ["calories", "protein", "carbs", "fat"].every(key => Number.isFinite(targets[key]))
  );
}

async function getOverview(config) {
  const [userResult, settings, statusRows, profileRows] = await Promise.all([
    supabaseRequest(config, "/auth/v1/admin/users?page=1&per_page=1000"),
    supabaseRequest(config, "/rest/v1/app_settings?id=eq.1&select=*"),
    supabaseRequest(config, "/rest/v1/admin_user_status?select=user_id,suspended"),
    supabaseRequest(config, "/rest/v1/user_settings?select=user_id,display_name")
  ]);
  const users = Array.isArray(userResult && userResult.users) ? userResult.users : [];
  const statusById = new Map((statusRows || []).map(row => [row.user_id, row.suspended]));
  const nameById = new Map((profileRows || []).map(row => [row.user_id, row.display_name]));
  const appSettings = Array.isArray(settings) ? settings[0] : null;
  if (!appSettings) throw new ApiError(503, "App settings are missing. Run the updated Supabase schema.");
  const now = Date.now();

  return {
    users: users.map(user => ({
      id: user.id,
      email: user.email || "",
      display_name: nameById.get(user.id) || "",
      created_at: user.created_at || null,
      last_sign_in_at: user.last_sign_in_at || null,
      suspended: Boolean(
        statusById.get(user.id) ||
        (user.banned_until && Date.parse(user.banned_until) > now)
      )
    })),
    appSettings
  };
}

async function getUserRecords(config, userId) {
  if (!UUID_PATTERN.test(userId || "")) throw new ApiError(400, "Invalid user ID.");
  const [userResult, settings, appData, status] = await Promise.all([
    supabaseRequest(config, `/auth/v1/admin/users/${userId}`),
    supabaseRequest(config, `/rest/v1/user_settings?user_id=eq.${userId}&select=*`),
    supabaseRequest(config, `/rest/v1/user_app_data?user_id=eq.${userId}&select=*`),
    supabaseRequest(config, `/rest/v1/admin_user_status?user_id=eq.${userId}&select=suspended`)
  ]);
  const user = userResult && userResult.user ? userResult.user : userResult;
  return {
    user: user
      ? {
          id: user.id,
          email: user.email || "",
          created_at: user.created_at || null,
          last_sign_in_at: user.last_sign_in_at || null
        }
      : null,
    settings: Array.isArray(settings) ? settings[0] || null : null,
    appData: Array.isArray(appData) ? appData[0] || null : null,
    suspended: Boolean(
      (Array.isArray(status) && status[0] && status[0].suspended) ||
      (user && user.banned_until && Date.parse(user.banned_until) > Date.now())
    )
  };
}

async function updateAppSettings(config, settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new ApiError(400, "App settings are invalid.");
  }
  const { announcement, maintenance_mode, signups_enabled, default_workout_plan, default_macro_goal } = settings;
  if (typeof announcement !== "string" || announcement.length > 500) {
    throw new ApiError(400, "Announcement must be 500 characters or fewer.");
  }
  if (typeof maintenance_mode !== "boolean" || typeof signups_enabled !== "boolean") {
    throw new ApiError(400, "Maintenance and signup settings must be on or off.");
  }
  if (!validPlan(default_workout_plan)) {
    throw new ApiError(400, "Default workout plan must be null or a valid seven-day workout plan.");
  }
  if (!validMacroGoal(default_macro_goal)) {
    throw new ApiError(400, "Default macro goal must be null or contain a valid profile and macro targets.");
  }

  const rows = await supabaseRequest(config, "/rest/v1/app_settings?id=eq.1", {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      announcement: announcement.trim(),
      maintenance_mode,
      signups_enabled,
      default_workout_plan,
      default_macro_goal,
      updated_at: new Date().toISOString()
    })
  });
  if (!Array.isArray(rows) || !rows[0]) {
    throw new ApiError(503, "App settings could not be updated. Run the updated Supabase schema.");
  }
  return rows[0];
}

async function setUserSuspended(config, adminUserId, userId, suspended) {
  if (!UUID_PATTERN.test(userId || "")) throw new ApiError(400, "Invalid user ID.");
  if (userId.toLowerCase() === adminUserId) {
    throw new ApiError(400, "The administrator account cannot be suspended or deleted here.");
  }
  if (typeof suspended !== "boolean") throw new ApiError(400, "Choose whether to suspend the account.");

  const updateAuthStatus = async () => {
    await supabaseRequest(config, `/auth/v1/admin/users/${userId}`, {
      method: "PUT",
      body: JSON.stringify({ ban_duration: suspended ? "876000h" : "none" })
    });
  };
  const updateAppStatus = async () => {
    await supabaseRequest(config, "/rest/v1/admin_user_status?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        user_id: userId,
        suspended,
        updated_at: new Date().toISOString()
      })
    });
  };

  if (suspended) {
    try {
      await updateAppStatus();
    } catch (error) {
      console.error("App access could not be blocked:", error);
      throw new ApiError(502, "App data access could not be blocked.");
    }
    try {
      await updateAuthStatus();
    } catch (error) {
      console.error("Supabase sign-in could not be suspended:", error);
      throw new ApiError(502, "App access was blocked, but Supabase sign-in could not be suspended.");
    }
    return;
  }

  try {
    await updateAuthStatus();
  } catch (error) {
    console.error("Supabase sign-in could not be restored:", error);
    throw new ApiError(502, "Supabase sign-in could not be restored; app data access remains suspended.");
  }
  try {
    await updateAppStatus();
  } catch (error) {
    console.error("App access could not be restored:", error);
    throw new ApiError(502, "Supabase sign-in was restored, but app data access is still suspended.");
  }
}

async function deleteUser(config, adminUserId, userId, confirmation) {
  if (!UUID_PATTERN.test(userId || "")) throw new ApiError(400, "Invalid user ID.");
  if (userId.toLowerCase() === adminUserId) {
    throw new ApiError(400, "The administrator account cannot be deleted here.");
  }
  if (confirmation !== userId) {
    throw new ApiError(400, "Confirm the exact account ID before deleting it.");
  }
  await supabaseRequest(config, `/auth/v1/admin/users/${userId}`, {
    method: "DELETE"
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const config = getConfig();
    const admin = await verifyAdmin(req, config);
    if (req.method === "GET") {
      const action = String((req.query && req.query.action) || "check");
      if (action === "check") return res.status(200).json({ isAdmin: true });
      if (action === "overview") return res.status(200).json(await getOverview(config));
      if (action === "user") {
        return res.status(200).json(await getUserRecords(config, String((req.query && req.query.id) || "")));
      }
      return res.status(400).json({ error: "Unknown admin action." });
    }

    const body = getBody(req);
    if (body.action === "save-settings") {
      const appSettings = await updateAppSettings(config, body.settings);
      return res.status(200).json({ appSettings });
    }
    if (body.action === "set-suspended") {
      await setUserSuspended(config, admin.id.toLowerCase(), body.userId, body.suspended);
      return res.status(200).json({ success: true });
    }
    if (body.action === "delete-user") {
      await deleteUser(config, admin.id.toLowerCase(), body.userId, body.confirmUserId);
      return res.status(200).json({ success: true });
    }
    return res.status(400).json({ error: "Unknown admin action." });
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error("Admin API failed:", error);
    const message = status >= 500 ? "Admin service could not complete the request." : error.message;
    return res.status(status).json({ error: message });
  }
};
