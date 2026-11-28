(() => {
  "use strict";

  const config = window.MJM_SUPABASE_CONFIG || {};
  const configReady = typeof config.url === "string" &&
    /^https:\/\/[^/]+\.supabase\.co$/.test(config.url) &&
    typeof config.anonKey === "string" &&
    config.anonKey.length > 20 &&
    !config.url.includes("YOUR_PROJECT_ID") &&
    !config.anonKey.includes("YOUR_SUPABASE");
  const state = {
    configured: configReady,
    client: null,
    user: null,
    settings: null,
    appData: null,
    appSettings: null,
    isAdmin: false,
    suspended: false,
    appSettingsError: null,
    error: null
  };

  const authForm = document.getElementById("auth-form");
  const authStatus = document.getElementById("auth-status");
  const authHeading = document.getElementById("auth-heading");
  const authSubmit = document.getElementById("auth-submit");
  const authToggle = document.getElementById("auth-toggle");
  const displayNameField = document.getElementById("display-name-field");
  const emailField = document.getElementById("auth-email-field");
  const passwordField = document.getElementById("auth-password-field");
  const verificationField = document.getElementById("email-verification-field");
  const verificationCode = document.getElementById("email-verification-code");
  const verificationEmail = document.getElementById("verification-email");
  const resendVerificationCode = document.getElementById("resend-verification-code");
  const authPanel = document.getElementById("auth-panel");
  const dashboard = document.getElementById("dashboard-view");
  const dashboardStatus = document.getElementById("dashboard-status");
  const globalStatus = document.getElementById("global-auth-status");
  const APP_DATA_COLUMNS = "user_id, workout_progress, daily_tasks, macro_log, updated_at";
  const APP_SETTINGS_COLUMNS = "id, announcement, maintenance_mode, signups_enabled, default_workout_plan, default_macro_goal, updated_at";
  let authMode = "sign-in";
  let pendingEmail = "";
  let appDataChannel = null;
  let accountStatusChannel = null;
  const inertedElements = new Map();

  function setStatus(element, message, isError) {
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("is-error", Boolean(isError));
  }

  function showError(element, label, error) {
    console.error(label, error);
    setStatus(element, error && error.message ? error.message : "Something went wrong. Please try again.", true);
  }

  async function loadAppSettings() {
    const { data, error } = await state.client
      .from("app_settings")
      .select(APP_SETTINGS_COLUMNS)
      .eq("id", 1)
      .single();
    if (error) throw error;
    state.appSettings = data;
    state.appSettingsError = null;
  }

  function subscribeToAppSettings() {
    state.client
      .channel("mjm-public-app-settings")
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "app_settings",
        filter: "id=eq.1"
      }, payload => {
        if (!payload.new) return;
        const maintenanceEnded = Boolean(
          state.appSettings &&
          state.appSettings.maintenance_mode &&
          !payload.new.maintenance_mode
        );
        state.appSettings = payload.new;
        applyAuthView();
        if (maintenanceEnded && state.user && (!state.settings || !state.appData || state.error)) {
          state.client.auth.getSession().then(({ data, error }) => {
            if (error) throw error;
            return refreshSession(data.session);
          }).catch(error => {
            showError(dashboardStatus || globalStatus, "Unable to reload account data", error);
          });
        }
      })
      .subscribe(status => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("Live app settings updates are unavailable:", status);
        }
      });
  }

  async function refreshAppSettings() {
    try {
      await loadAppSettings();
      applyAuthView();
    } catch (error) {
      state.appSettingsError = error;
      applyAuthView();
      throw error;
    }
  }

  async function checkAdminAccess(session) {
    state.isAdmin = false;
    if (!session || !session.access_token || window.location.protocol === "file:") return;
    try {
      const response = await fetch("/api/admin?action=check", {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
      if (response.status === 403) return;
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Admin access could not be checked.");
      state.isAdmin = data.isAdmin === true;
    } catch (error) {
      console.warn("Admin access could not be checked:", error);
    }
  }

  async function loadUserStatus(user) {
    const { data, error } = await state.client
      .from("admin_user_status")
      .select("suspended")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    state.suspended = Boolean(data && data.suspended);
  }

  function renderGlobalSettings() {
    const announcementText = state.appSettings && state.appSettings.announcement
      ? String(state.appSettings.announcement).trim()
      : "";
    let announcement = document.getElementById("app-announcement");
    if (announcementText) {
      if (!announcement) {
        announcement = document.createElement("p");
        announcement.id = "app-announcement";
        announcement.className = "app-announcement";
        announcement.setAttribute("role", "status");
        document.body.prepend(announcement);
      }
      announcement.textContent = announcementText;
    } else if (announcement) {
      announcement.remove();
    }

    document.querySelectorAll("[data-admin-only]").forEach(element => {
      element.hidden = !state.isAdmin;
    });

    const registrationsOpen = !state.appSettings || state.appSettings.signups_enabled !== false;
    if (authToggle) {
      authToggle.hidden = !registrationsOpen && authMode === "sign-in";
      authToggle.disabled = !registrationsOpen && authMode === "sign-in";
    }

    const blocked = Boolean(
      state.user &&
      (
        state.suspended ||
        state.appSettingsError ||
        !state.appSettings ||
        (state.appSettings.maintenance_mode && !state.isAdmin)
      )
    );
    let screen = document.getElementById("app-access-block");
    if (!blocked) {
      if (screen) screen.remove();
      inertedElements.forEach((wasInert, element) => {
        element.inert = wasInert;
      });
      inertedElements.clear();
      return;
    }

    if (!screen) {
      screen = document.createElement("section");
      screen.id = "app-access-block";
      screen.className = "app-access-block";
      screen.setAttribute("role", "alertdialog");
      screen.setAttribute("aria-modal", "true");
      screen.tabIndex = -1;
      const title = document.createElement("h1");
      const message = document.createElement("p");
      const signOut = document.createElement("button");
      title.dataset.blockTitle = "";
      message.dataset.blockMessage = "";
      signOut.type = "button";
      signOut.className = "btn-submit";
      signOut.textContent = "Sign out";
      signOut.addEventListener("click", async () => {
        signOut.disabled = true;
        try {
          const { error } = await state.client.auth.signOut();
          if (error) throw error;
        } catch (error) {
          showError(globalStatus || authStatus, "Sign out failed", error);
        } finally {
          signOut.disabled = false;
        }
      });
      screen.append(title, message, signOut);
      document.body.appendChild(screen);
      screen.focus();
    }

    screen.querySelector("[data-block-title]").textContent = state.suspended
      ? "Account access suspended"
      : state.appSettingsError || !state.appSettings
        ? "App availability could not be verified"
        : "Temporarily unavailable";
    screen.querySelector("[data-block-message]").textContent = state.suspended
      ? "This account is currently suspended. Contact the app administrator for help."
      : state.appSettingsError || !state.appSettings
        ? "Refresh the page or try again later. Your account data will stay protected until app availability can be verified."
        : "The app is under maintenance. Please try again later.";
    Array.from(document.body.children).forEach(element => {
      if (element === screen || element.id === "app-announcement" || element.tagName === "SCRIPT") return;
      if (!inertedElements.has(element)) inertedElements.set(element, element.inert);
      element.inert = true;
    });
  }

  function applyAuthView() {
    document.body.classList.remove("auth-initializing");
    document.body.classList.toggle("has-mobile-nav", Boolean(state.user));
    document.querySelectorAll("[data-authenticated-only]").forEach(element => {
      element.hidden = !state.user;
    });
    document.querySelectorAll("[data-auth-nav]").forEach(element => {
      element.hidden = Boolean(state.user);
    });
    document.querySelectorAll("[data-sign-out]").forEach(element => {
      element.hidden = !state.user;
    });

    renderGlobalSettings();
    document.documentElement.classList.remove(
      "mjm-resume-authenticated",
      "mjm-resume-admin"
    );

    if (authPanel && dashboard) {
      authPanel.hidden = Boolean(state.user);
      dashboard.hidden = !state.user;
    }

    if (state.user && state.settings) {
      const name = state.settings.display_name ||
        (state.user.email ? state.user.email.split("@")[0] : "there");
      const greeting = document.getElementById("dashboard-greeting");
      const profileName = document.getElementById("profile-display-name");
      if (greeting) greeting.textContent = `Welcome back, ${name}.`;
      if (profileName && document.activeElement !== profileName) {
        profileName.value = state.settings.display_name || "";
      }
    }

    if (dashboardStatus && state.error) {
      setStatus(dashboardStatus, `Account data could not be loaded: ${state.error.message}`, true);
    } else if (dashboardStatus && !state.error) {
      setStatus(dashboardStatus, "", false);
    }
    if (globalStatus && state.appSettingsError) {
      setStatus(globalStatus, `App settings could not be loaded: ${state.appSettingsError.message}`, true);
    } else if (globalStatus) {
      setStatus(
        globalStatus,
        state.error ? `Account data could not be loaded: ${state.error.message}` : "",
        Boolean(state.error)
      );
    }

    window.dispatchEvent(new CustomEvent("mjm:auth-state", { detail: state }));
  }

  async function loadSettings(user) {
    const columns = "user_id, display_name, workout_plan, macro_goal, updated_at";
    let { data, error } = await state.client
      .from("user_settings")
      .select(columns)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      const displayName = user.user_metadata && typeof user.user_metadata.display_name === "string"
        ? user.user_metadata.display_name
        : "";
      ({ data, error } = await state.client
        .from("user_settings")
        .insert({
          user_id: user.id,
          display_name: displayName,
          workout_plan: state.appSettings?.default_workout_plan ?? null,
          macro_goal: state.appSettings?.default_macro_goal ?? null
        })
        .select(columns)
        .single());
      if (error) throw error;
    }

    state.settings = data;
  }

  function normalizeAppData(data) {
    return {
      user_id: data.user_id,
      workout_progress: data.workout_progress &&
        typeof data.workout_progress === "object" &&
        !Array.isArray(data.workout_progress)
        ? data.workout_progress
        : {},
      daily_tasks: Array.isArray(data.daily_tasks) ? data.daily_tasks : [],
      macro_log: data.macro_log &&
        typeof data.macro_log === "object" &&
        !Array.isArray(data.macro_log)
        ? data.macro_log
        : {},
      updated_at: data.updated_at
    };
  }

  function parseStoredJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value ?? fallback;
    } catch (error) {
      console.warn(`Legacy account data could not be read from ${key}:`, error);
      return fallback;
    }
  }

  function readLegacyAppData(user) {
    const workoutProgress = {};
    const dailyTasks = parseStoredJson("mjm-daily-tasks", []);
    let macroLog = parseStoredJson(`mjm-macro-log-v1-${user.id}`, null);

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith("mjm-workout-progress-")) continue;
        const weekId = key.slice("mjm-workout-progress-".length);
        if (/^\d{4}-\d{2}-\d{2}$/.test(weekId)) {
          workoutProgress[weekId] = parseStoredJson(key, {});
        }
      }
    } catch (error) {
      console.warn("Legacy workout history could not be read:", error);
    }

    if (!macroLog) macroLog = parseStoredJson("mjm-macro-log-v1", {});
    return {
      workout_progress: workoutProgress,
      daily_tasks: Array.isArray(dailyTasks) ? dailyTasks : [],
      macro_log: macroLog && typeof macroLog === "object" && !Array.isArray(macroLog)
        ? macroLog
        : {}
    };
  }

  function hasAppData(data) {
    return Object.keys(data.workout_progress).length > 0 ||
      data.daily_tasks.length > 0 ||
      Object.keys(data.macro_log).length > 0;
  }

  function hasImportedLegacyData(user) {
    try {
      return localStorage.getItem(`mjm-account-data-imported-${user.id}`) === "true";
    } catch (error) {
      console.warn("Account-data import status could not be read:", error);
      return false;
    }
  }

  function markLegacyDataImported(user) {
    try {
      localStorage.setItem(`mjm-account-data-imported-${user.id}`, "true");
    } catch (error) {
      console.warn("Account-data import status could not be saved:", error);
    }
  }

  function mergeAppData(remoteData, legacyData) {
    const workoutProgress = { ...remoteData.workout_progress };
    Object.entries(legacyData.workout_progress).forEach(([weekId, progress]) => {
      workoutProgress[weekId] = {
        ...(workoutProgress[weekId] || {}),
        ...progress
      };
    });

    const tasksById = new Map();
    [...remoteData.daily_tasks, ...legacyData.daily_tasks].forEach(task => {
      if (task && task.id != null) tasksById.set(String(task.id), task);
    });

    const macroLog = { ...remoteData.macro_log };
    Object.entries(legacyData.macro_log).forEach(([date, entries]) => {
      if (!Array.isArray(entries)) return;
      const mergedEntries = new Map();
      [
        ...(Array.isArray(macroLog[date]) ? macroLog[date] : []),
        ...entries
      ].forEach((entry, index) => {
        const key = entry && entry.id != null ? String(entry.id) : `legacy-${index}`;
        mergedEntries.set(key, entry);
      });
      macroLog[date] = Array.from(mergedEntries.values());
    });

    return {
      workout_progress: workoutProgress,
      daily_tasks: Array.from(tasksById.values()),
      macro_log: macroLog
    };
  }

  function stopAppDataSubscription() {
    if (appDataChannel && state.client) {
      state.client.removeChannel(appDataChannel);
      appDataChannel = null;
    }
    if (accountStatusChannel && state.client) {
      state.client.removeChannel(accountStatusChannel);
      accountStatusChannel = null;
    }
  }

  function subscribeToAccountStatus(user) {
    if (accountStatusChannel && state.client) state.client.removeChannel(accountStatusChannel);
    accountStatusChannel = state.client
      .channel(`mjm-account-status-${user.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "admin_user_status",
        filter: `user_id=eq.${user.id}`
      }, payload => {
        state.suspended = Boolean(payload.new && payload.new.suspended);
        applyAuthView();
      })
      .subscribe(status => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("Live account status updates are unavailable:", status);
        }
      });
  }

  function dispatchAppData() {
    window.dispatchEvent(new CustomEvent("mjm:account-data", {
      detail: state.appData
    }));
  }

  function subscribeToAppData(user) {
    stopAppDataSubscription();
    appDataChannel = state.client
      .channel(`mjm-account-data-${user.id}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "user_app_data",
        filter: `user_id=eq.${user.id}`
      }, payload => {
        if (!state.user || state.user.id !== user.id || !payload.new) return;
        state.appData = normalizeAppData(payload.new);
        dispatchAppData();
      })
      .subscribe(status => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("Live account-data updates are unavailable:", status);
          setStatus(
            globalStatus || dashboardStatus,
            "Live sync is unavailable right now. Reload to check for updates.",
            true
          );
        }
      });
  }

  async function loadAppData(user) {
    let { data, error } = await state.client
      .from("user_app_data")
      .select(APP_DATA_COLUMNS)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw error;

    let inserted = false;
    if (!data) {
      const legacy = readLegacyAppData(user);
      const importLegacy = hasAppData(legacy) && window.confirm(
        "This account has no synced workout progress, tasks, or food logs yet. " +
        "Upload the existing data from this browser to this account? Only choose OK " +
        "if these records belong to you. Choose Cancel to keep them only in this browser."
      );
      const initialData = {
        user_id: user.id,
        ...(
          importLegacy
            ? legacy
            : { workout_progress: {}, daily_tasks: [], macro_log: {} }
        )
      };
      ({ data, error } = await state.client
        .from("user_app_data")
        .insert(initialData)
        .select(APP_DATA_COLUMNS)
        .single());

      inserted = !error;
      if (error && error.code === "23505") {
        ({ data, error } = await state.client
          .from("user_app_data")
          .select(APP_DATA_COLUMNS)
          .eq("user_id", user.id)
          .single());
      }
      if (error) throw error;
      if (inserted) markLegacyDataImported(user);
    } else if (!hasImportedLegacyData(user)) {
      const legacy = readLegacyAppData(user);
      if (hasAppData(legacy)) {
        const importLegacy = window.confirm(
          "This browser has workout progress, tasks, or food logs that are not in your account yet. " +
          "Merge them into this account? Only choose OK if these records belong to you. " +
          "Choose Cancel to leave them only in this browser."
        );
        if (importLegacy) {
          const merged = mergeAppData(normalizeAppData(data), legacy);
          ({ data, error } = await state.client
            .from("user_app_data")
            .update({ ...merged, updated_at: new Date().toISOString() })
            .eq("user_id", user.id)
            .select(APP_DATA_COLUMNS)
            .single());
          if (error) throw error;
        }
      }
      markLegacyDataImported(user);
    }

    state.appData = normalizeAppData(data);
    subscribeToAppData(user);
  }

  async function saveAppData(updates) {
    if (!state.user || !state.client) {
      throw new Error("Sign in before saving account data.");
    }
    if (!state.appData || state.error) {
      throw new Error("Account data is unavailable. Reload the page before trying again.");
    }

    const allowedColumns = {
      workout_progress: value => value && typeof value === "object" && !Array.isArray(value),
      daily_tasks: Array.isArray,
      macro_log: value => value && typeof value === "object" && !Array.isArray(value)
    };
    const payload = {};
    Object.entries(updates).forEach(([key, value]) => {
      if (!Object.prototype.hasOwnProperty.call(allowedColumns, key) || !allowedColumns[key](value)) {
        throw new Error(`Invalid account data for ${key}.`);
      }
      payload[key] = value;
    });
    if (!Object.keys(payload).length) return state.appData;

    const { data, error } = await state.client
      .from("user_app_data")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("user_id", state.user.id)
      .select(APP_DATA_COLUMNS)
      .single();
    if (error) throw error;

    state.appData = normalizeAppData(data);
    dispatchAppData();
    return state.appData;
  }

  async function refreshAppData() {
    if (!state.user || !state.client) return;
    const { data, error } = await state.client
      .from("user_app_data")
      .select(APP_DATA_COLUMNS)
      .eq("user_id", state.user.id)
      .single();
    if (error) throw error;
    state.appData = normalizeAppData(data);
    dispatchAppData();
  }

  async function saveSettings(updates) {
    if (!state.user || !state.client) {
      throw new Error("Sign in before saving account settings.");
    }
    if (!state.settings || state.error) {
      throw new Error("Account settings are unavailable. Reload the page before trying again.");
    }

    const record = {
      ...state.settings,
      ...updates,
      user_id: state.user.id,
      updated_at: new Date().toISOString()
    };
    const { data, error } = await state.client
      .from("user_settings")
      .upsert(record, { onConflict: "user_id" })
      .select("user_id, display_name, workout_plan, macro_goal, updated_at")
      .single();
    if (error) throw error;

    state.settings = data;
    state.error = null;
    applyAuthView();
    return data;
  }

  async function refreshSession(session) {
    if (session && state.user && session.user.id === state.user.id && state.settings && state.appData) {
      applyAuthView();
      return;
    }

    stopAppDataSubscription();
    state.user = session ? session.user : null;
    state.settings = null;
    state.appData = null;
    state.appSettings = null;
    state.isAdmin = false;
    state.suspended = false;
    state.appSettingsError = null;
    state.error = null;
    try {
      await loadAppSettings();
    } catch (error) {
      state.appSettingsError = error;
      console.error("Unable to load app settings:", error);
    }

    if (state.user) {
      const currentSession = session || (await state.client.auth.getSession()).data.session;
      await checkAdminAccess(currentSession);
      try {
        await loadUserStatus(state.user);
        await loadSettings(state.user);
        await loadAppData(state.user);
        subscribeToAccountStatus(state.user);
      } catch (error) {
        state.error = error;
        showError(dashboardStatus || globalStatus, "Unable to load account data", error);
      }
    }
    applyAuthView();

    if (document.body.dataset.requiresAuth === "true" && !state.user) {
      window.location.replace("index.html#auth-panel");
    }
  }

  function setAuthMode(mode) {
    authMode = mode;
    const signingUp = mode === "sign-up";
    const verifyingEmail = mode === "verify-email";
    if (authHeading) {
      authHeading.textContent = signingUp ? "Create your account" : verifyingEmail ? "Verify your email" : "Sign in";
    }
    if (authSubmit) {
      authSubmit.textContent = signingUp ? "Create account" : verifyingEmail ? "Verify code" : "Sign in";
    }
    if (authToggle) {
      authToggle.textContent = signingUp
        ? "Already have an account? Sign in"
        : verifyingEmail
          ? "Back to sign in"
          : "Need an account? Sign up";
      authToggle.hidden = !signingUp &&
        state.appSettings &&
        state.appSettings.signups_enabled === false;
      authToggle.disabled = authToggle.hidden;
    }
    if (displayNameField) displayNameField.hidden = !signingUp;
    if (emailField) emailField.hidden = verifyingEmail;
    if (passwordField) passwordField.hidden = verifyingEmail;
    if (verificationField) verificationField.hidden = !verifyingEmail;
    if (resendVerificationCode) resendVerificationCode.hidden = !verifyingEmail;
    const nameInput = document.getElementById("auth-display-name");
    const emailInput = document.getElementById("auth-email");
    const passwordInput = document.getElementById("auth-password");
    if (nameInput) nameInput.required = signingUp;
    if (emailInput) emailInput.required = !verifyingEmail;
    if (passwordInput) passwordInput.autocomplete = signingUp ? "new-password" : "current-password";
    if (passwordInput) passwordInput.required = !verifyingEmail;
    if (verificationCode) {
      verificationCode.required = verifyingEmail;
      verificationCode.value = "";
    }
    if (verificationEmail) verificationEmail.textContent = verifyingEmail ? `Code sent to ${pendingEmail}` : "";
    setStatus(authStatus, "", false);
  }

  if (authToggle) {
    authToggle.addEventListener("click", () => {
      setAuthMode(authMode === "sign-in" ? "sign-up" : "sign-in");
    });
  }

  if (resendVerificationCode) {
    resendVerificationCode.addEventListener("click", async () => {
      if (!state.client || !pendingEmail) {
        setStatus(authStatus, "Start account creation again to request a verification code.", true);
        return;
      }

      resendVerificationCode.disabled = true;
      setStatus(authStatus, "Sending a new verification code...", false);
      try {
        const { error } = await state.client.auth.resend({
          type: "signup",
          email: pendingEmail
        });
        if (error) throw error;
        setStatus(authStatus, `A new verification code was sent to ${pendingEmail}.`, false);
      } catch (error) {
        showError(authStatus, "Unable to resend verification code", error);
      } finally {
        resendVerificationCode.disabled = false;
      }
    });
  }

  if (authForm) {
    authForm.addEventListener("submit", async event => {
      event.preventDefault();
      if (!state.client) {
        setStatus(authStatus, "Configure the Supabase project URL and public key to enable accounts.", true);
        return;
      }

      authSubmit.disabled = true;
      setStatus(
        authStatus,
        authMode === "sign-up"
          ? "Creating your account..."
          : authMode === "verify-email"
            ? "Verifying your email..."
            : "Signing in...",
        false
      );

      try {
        if (authMode === "verify-email") {
          if (!pendingEmail) throw new Error("The verification email is missing. Start account creation again.");
          const token = verificationCode.value.trim();
          const { data, error } = await state.client.auth.verifyOtp({
            email: pendingEmail,
            token,
            type: "signup"
          });
          if (error) throw error;
          if (!data.session) {
            setAuthMode("sign-in");
            setStatus(authStatus, "Email verified. Sign in with your email and password.", false);
            return;
          }
          setStatus(authStatus, "Email verified. Opening your dashboard...", false);
        } else if (authMode === "sign-up") {
          if (!state.appSettings || state.appSettingsError) {
            throw new Error("App registration settings could not be verified. Reload the page and try again.");
          }
          if (state.appSettings.signups_enabled === false) {
            throw new Error("New account registration is currently disabled.");
          }
          const email = document.getElementById("auth-email").value.trim();
          const password = document.getElementById("auth-password").value;
          const nameInput = document.getElementById("auth-display-name");
          const displayName = nameInput ? nameInput.value.trim() : "";
          const { data, error } = await state.client.auth.signUp({
            email,
            password,
            options: { data: { display_name: displayName } }
          });
          if (error) throw error;
          if (!data.user) throw new Error("Supabase did not return an account. Try again.");
          if (data.session) {
            const { error: signOutError } = await state.client.auth.signOut();
            if (signOutError) throw signOutError;
            setStatus(
              authStatus,
              "Email verification is not enabled. Turn on email confirmation in Supabase before creating accounts.",
              true
            );
            return;
          }
          pendingEmail = email;
          setAuthMode("verify-email");
          setStatus(authStatus, `We sent a verification code to ${pendingEmail}. Enter it to finish creating your account.`, false);
        } else {
          const email = document.getElementById("auth-email").value.trim();
          const password = document.getElementById("auth-password").value;
          const { error } = await state.client.auth.signInWithPassword({ email, password });
          if (error) throw error;
          setStatus(authStatus, "Signed in successfully.", false);
        }
      } catch (error) {
        showError(authStatus, "Authentication failed", error);
      } finally {
        authSubmit.disabled = false;
      }
    });
  }

  document.querySelectorAll("[data-sign-out]").forEach(button => {
    button.addEventListener("click", async () => {
      if (!state.client) return;
      button.disabled = true;
      try {
        const { error } = await state.client.auth.signOut();
        if (error) throw error;
        setStatus(authStatus, "You have signed out.", false);
      } catch (error) {
        showError(dashboardStatus || globalStatus, "Sign out failed", error);
      } finally {
        button.disabled = false;
      }
    });
  });

  const profileForm = document.getElementById("profile-form");
  if (profileForm) {
    profileForm.addEventListener("submit", async event => {
      event.preventDefault();
      const name = document.getElementById("profile-display-name").value.trim();
      if (!name || name.length > 60) {
        setStatus(dashboardStatus, "Enter a display name between 1 and 60 characters.", true);
        return;
      }

      const saveButton = profileForm.querySelector("button[type=submit]");
      saveButton.disabled = true;
      setStatus(dashboardStatus, "Saving profile...", false);
      try {
        await saveSettings({ display_name: name });
        setStatus(dashboardStatus, "Profile saved.", false);
      } catch (error) {
        showError(dashboardStatus || globalStatus, "Unable to save profile", error);
      } finally {
        saveButton.disabled = false;
      }
    });
  }

  async function initialize() {
    if (!state.configured) {
      if (authForm) {
        authForm.querySelectorAll("input, button[type=submit]").forEach(element => {
          element.disabled = true;
        });
        setStatus(authStatus, "Set your Supabase project URL and public key in supabase-config.js to enable account sign-in.", true);
      }
      applyAuthView();
      if (document.body.dataset.requiresAuth === "true") {
        window.location.replace("index.html#auth-panel");
      }
      return state;
    }

    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      state.error = new Error("The Supabase client could not be loaded. Check your internet connection and reload.");
      showError(authStatus || dashboardStatus, "Supabase SDK unavailable", state.error);
      if (document.body.dataset.requiresAuth === "true") {
        window.location.replace("index.html#auth-panel");
      }
      return state;
    }

    try {
      state.client = window.supabase.createClient(config.url, config.anonKey);
      subscribeToAppSettings();
      state.client.auth.onAuthStateChange((event, session) => {
        if (event === "INITIAL_SESSION") return;
        if (event === "SIGNED_IN" && authMode === "sign-up") return;
        window.setTimeout(() => {
          refreshSession(session).catch(error => {
            state.error = error;
            showError(dashboardStatus || authStatus || globalStatus, "Unable to update account session", error);
          });
        }, 0);
      });
    } catch (error) {
      state.error = error;
      showError(authStatus || dashboardStatus || globalStatus, "Unable to initialize Supabase", error);
      if (document.body.dataset.requiresAuth === "true") {
        window.location.replace("index.html#auth-panel");
      }
      return state;
    }

    try {
      const { data, error } = await state.client.auth.getSession();
      if (error) throw error;
      await refreshSession(data.session);
    } catch (error) {
      state.error = error;
      showError(authStatus || dashboardStatus || globalStatus, "Unable to check sign-in status", error);
      applyAuthView();
      if (document.body.dataset.requiresAuth === "true") {
        window.location.replace("index.html#auth-panel");
      }
    }
    return state;
  }

  window.MJM_AUTH = {
    state,
    saveSettings,
    saveAppData,
    refreshAppData,
    refreshAppSettings
  };
  window.MJM_AUTH_READY = initialize();

  window.addEventListener("focus", async () => {
    if (!state.client) return;
    try {
      if (state.user) {
        if (!state.settings || !state.appData || state.error) {
          const { data, error } = await state.client.auth.getSession();
          if (error) throw error;
          await refreshSession(data.session);
        } else {
          await loadUserStatus(state.user);
          await refreshAppSettings();
          await refreshAppData();
        }
      } else {
        await refreshAppSettings();
      }
    } catch (error) {
      showError(dashboardStatus || globalStatus, "Unable to refresh account data", error);
    }
  });
})();
