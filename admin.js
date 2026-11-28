(() => {
  "use strict";

  const status = document.getElementById("admin-status");
  const adminApp = document.getElementById("admin-app");
  const userList = document.getElementById("admin-users");
  const settingsForm = document.getElementById("admin-settings-form");
  const recordOutput = document.getElementById("admin-user-records");
  const recordLabel = document.getElementById("admin-records-label");

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle("is-error", isError);
  }

  async function request(action, options = {}) {
    const auth = window.MJM_AUTH;
    if (!auth || !auth.state.client) throw new Error("The account session is unavailable. Sign in again.");
    const { data, error } = await auth.state.client.auth.getSession();
    if (error) throw error;
    const token = data.session && data.session.access_token;
    if (!token) throw new Error("Your session has expired. Sign in again.");

    const isPost = options.method === "POST";
    const response = await fetch(
      isPost ? "/api/admin" : `/api/admin?${new URLSearchParams({ action, ...(options.query || {}) })}`,
      {
        method: isPost ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(isPost ? { "Content-Type": "application/json" } : {})
        },
        ...(isPost ? { body: JSON.stringify({ action, ...options.body }) } : {})
      }
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "The admin request failed.");
    return result;
  }

  function formatDate(value) {
    if (!value) return "Never";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
  }

  function createButton(label, className, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  async function loadRecords(user) {
    setStatus(`Loading private records for ${user.email || user.id}...`);
    const result = await request("user", { query: { id: user.id } });
    recordLabel.textContent = `Private records for ${user.email || user.id}`;
    recordOutput.textContent = JSON.stringify(result, null, 2);
    recordOutput.hidden = false;
    setStatus(`Loaded records for ${user.email || user.id}.`);
  }

  async function changeSuspension(user, suspended) {
    if (!window.confirm(`${suspended ? "Suspend" : "Restore"} ${user.email || user.id}?`)) return;
    setStatus(`${suspended ? "Suspending" : "Restoring"} account...`);
    await request("set-suspended", {
      method: "POST",
      body: { userId: user.id, suspended }
    });
    await loadOverview();
    setStatus(`Account ${suspended ? "suspended" : "restored"}.`);
  }

  async function removeUser(user) {
    const confirmation = window.prompt(
      `This permanently deletes ${user.email || user.id} and all saved records.\nEnter the exact account ID to confirm:`
    );
    if (confirmation === null) return;
    setStatus("Deleting account and saved data...");
    await request("delete-user", {
      method: "POST",
      body: { userId: user.id, confirmUserId: confirmation.trim() }
    });
    recordOutput.hidden = true;
    recordOutput.textContent = "";
    recordLabel.textContent = "Select “View records” for an account above.";
    await loadOverview();
    setStatus("Account and saved data deleted.");
  }

  function renderUsers(users) {
    userList.replaceChildren();
    if (!users.length) {
      const empty = document.createElement("p");
      empty.className = "admin-help";
      empty.textContent = "No accounts found.";
      userList.appendChild(empty);
      return;
    }

    users.forEach(user => {
      const card = document.createElement("article");
      card.className = "admin-user";
      const details = document.createElement("div");
      details.className = "admin-user__details";
      const name = document.createElement("h4");
      name.textContent = user.display_name || user.email || "Unnamed account";
      const email = document.createElement("p");
      email.textContent = user.email || "No email address";
      const meta = document.createElement("p");
      meta.className = "admin-help";
      meta.textContent = `Created ${formatDate(user.created_at)} · Last sign-in ${formatDate(user.last_sign_in_at)}`;
      const accountStatus = document.createElement("p");
      accountStatus.className = user.suspended ? "admin-user__status is-suspended" : "admin-user__status";
      accountStatus.textContent = user.suspended ? "Suspended" : "Active";
      details.append(name, email, meta, accountStatus);

      const actions = document.createElement("div");
      actions.className = "admin-user__actions";
      actions.appendChild(createButton("View records", "admin-secondary-button", async () => {
        try {
          await loadRecords(user);
        } catch (error) {
          setStatus(error.message, true);
        }
      }));
      actions.appendChild(createButton(
        user.suspended ? "Restore" : "Suspend",
        "admin-secondary-button",
        async () => {
          try {
            await changeSuspension(user, !user.suspended);
          } catch (error) {
            setStatus(error.message, true);
          }
        }
      ));
      actions.appendChild(createButton("Delete", "admin-danger-button", async () => {
        try {
          await removeUser(user);
        } catch (error) {
          setStatus(error.message, true);
        }
      }));
      card.append(details, actions);
      userList.appendChild(card);
    });
  }

  function fillSettings(settings) {
    document.getElementById("admin-announcement").value = settings.announcement || "";
    document.getElementById("admin-maintenance").checked = Boolean(settings.maintenance_mode);
    document.getElementById("admin-signups").checked = Boolean(settings.signups_enabled);
    document.getElementById("admin-default-workout").value = settings.default_workout_plan
      ? JSON.stringify(settings.default_workout_plan, null, 2)
      : "";
    document.getElementById("admin-default-macros").value = settings.default_macro_goal
      ? JSON.stringify(settings.default_macro_goal, null, 2)
      : "";
  }

  async function loadOverview() {
    const result = await request("overview");
    renderUsers(result.users);
    fillSettings(result.appSettings);
  }

  function readJsonField(id, label) {
    const value = document.getElementById(id).value.trim();
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new Error(`${label} must be valid JSON, or left blank.`);
    }
  }

  settingsForm.addEventListener("submit", async event => {
    event.preventDefault();
    const saveButton = document.getElementById("save-admin-settings");
    saveButton.disabled = true;
    setStatus("Saving shared app settings...");
    try {
      const settings = {
        announcement: document.getElementById("admin-announcement").value.trim(),
        maintenance_mode: document.getElementById("admin-maintenance").checked,
        signups_enabled: document.getElementById("admin-signups").checked,
        default_workout_plan: readJsonField("admin-default-workout", "Default workout plan"),
        default_macro_goal: readJsonField("admin-default-macros", "Default macro goal")
      };
      await request("save-settings", { method: "POST", body: { settings } });
      await window.MJM_AUTH.refreshAppSettings();
      setStatus("Global settings saved. Workout and macro defaults apply only to new accounts.");
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      saveButton.disabled = false;
    }
  });

  document.getElementById("refresh-users").addEventListener("click", async () => {
    try {
      setStatus("Refreshing accounts...");
      await loadOverview();
      setStatus("Account list refreshed.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  document.getElementById("use-current-workout").addEventListener("click", () => {
    const plan = window.MJM_AUTH.state.settings && window.MJM_AUTH.state.settings.workout_plan;
    if (!plan) {
      setStatus("Your account does not have a saved workout plan to use as a default.", true);
      return;
    }
    document.getElementById("admin-default-workout").value = JSON.stringify(plan, null, 2);
    setStatus("Your saved workout plan is ready to save as the default.");
  });

  document.getElementById("use-current-macros").addEventListener("click", () => {
    const goal = window.MJM_AUTH.state.settings && window.MJM_AUTH.state.settings.macro_goal;
    if (!goal) {
      setStatus("Your account does not have a saved macro goal to use as a default.", true);
      return;
    }
    document.getElementById("admin-default-macros").value = JSON.stringify(goal, null, 2);
    setStatus("Your saved macro goal is ready to save as the default.");
  });

  async function initialize() {
    if (!window.MJM_AUTH_READY) {
      setStatus("Account sign-in could not be initialized. Reload the page.", true);
      return;
    }
    await window.MJM_AUTH_READY;
    if (!window.MJM_AUTH.state.user) return;
    if (!window.MJM_AUTH.state.isAdmin) {
      setStatus("This account does not have administrator access. Returning to the dashboard.", true);
      window.setTimeout(() => window.location.replace("index.html"), 1800);
      return;
    }

    adminApp.hidden = false;
    try {
      await loadOverview();
      setStatus("Administrator access verified.");
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  initialize().catch(error => {
    console.error("Admin panel could not be initialized:", error);
    setStatus(error.message || "Admin panel could not be initialized.", true);
  });
})();
