(() => {
  "use strict";

  const section = document.getElementById("schedule");
  const grid = document.querySelector(".schedule-grid");
  if (!section || !grid) return;

  const STORAGE_KEY = "mjm-workout-plan-v1";
  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const REST_OPTIONS = ["30 seconds", "45 seconds", "1 minute", "90 seconds", "2 minutes", "3 minutes", "4 minutes", "5 minutes"];

  const LIBRARY = {
    Abs: [
      "Crunch", "Leg Raises", "Hanging Leg Raise", "Hanging Knee Raise", "Cable Crunch", "Plank",
      "Side Plank", "Russian Twist", "Bicycle Crunch", "Ab Wheel Rollout", "Sit-Up", "Decline Sit-Up",
      "Reverse Crunch", "V-Up", "Flutter Kicks", "Mountain Climber", "Dead Bug", "Woodchopper", "Weighted Crunch"
    ],
    Arms: [
      "Barbell Curl", "EZ-Bar Curl", "Dumbbell Curl", "Seated Dumbbell Curl", "Incline Dumbbell Curl",
      "Hammer Curl", "Seated Hammer Curl", "Cross Body Hammer Curl", "Zottman Curl", "Reverse Barbell Curl",
      "Preacher Curl", "Concentration Curl", "Spider Curl", "Cable Curl", "Rope Push-Down",
      "Close-Grip Reverse Push-Down Rope Push-Down", "Triceps Push-Down (V-Bar)", "Overhead Triceps Extension",
      "Cable Overhead Triceps Extension", "Skull Crusher", "Lying Dumbbell Triceps Extension",
      "Close-Grip Dumbbell Press", "Close-Grip Bench Press", "Bench Dip", "Triceps Kickback",
      "Diamond Push-Up", "Wrist Curl", "Reverse Wrist Curl"
    ],
    Back: [
      "Lat Pull-Down", "Close-Grip Lat Pull-Down", "Wide-Grip Lat Pull-Down", "Straight-Arm Pull-Down",
      "Chin-Up", "Pull-Up", "Barbell-Rows", "Reverse-Grip Barbell Row", "Pendley Rows", "T-Bar Row",
      "Seated Cable Row", "Single-Arm Cable Row", "Dumbbell Row", "Chest-Supported Row", "Inverted Row",
      "Deadlift", "Rack Pull", "Good Morning", "Hyperextension", "Shrug"
    ],
    Chest: [
      "Flat Barbell Bench Press", "Incline Barbell Bench Press", "Decline Barbell Bench Press",
      "Dumbbell Bench Press", "Incline Dumbbell Press", "Decline Dumbbell Press", "Dumbbell Fly",
      "Incline Dumbbell Fly", "Cable Crossover", "Low Cable Fly", "Pec Deck Fly", "Machine Chest Press",
      "Smith Machine Bench Press", "Push Up", "Incline Push Up", "Decline Push Up", "Chest Dip",
      "Dumbbell Pullover", "Svend Press"
    ],
    Legs: [
      "Barbell Squat", "Front Squat", "Hack Squat", "Goblet Squat", "Bulgarian Split Squat", "Leg Press",
      "Leg Extension", "Lying Leg Curl", "Seated Leg Curl", "Stiff-Legged Deadlift", "Romanian Deadlift",
      "Sumo Deadlift", "Deadlift", "Walking Lunge", "Reverse Lunge", "Step-Up", "Hip Thrust",
      "Glute Bridge", "Standing Calf Raise", "Seated Calf Raise", "Adductor Machine", "Abductor Machine"
    ],
    Shoulders: [
      "Single Arm Lateral Raises", "Lateral Raise", "Cable Lateral Raise", "Bent-Over Lateral Raise",
      "Front Raise", "Face Pull", "Rear Delt Fly", "Reverse Pec Deck", "Dumbbell Overhead Press",
      "Seated Dumbbell Press", "Barbell Overhead Press", "Machine Shoulder Press", "Arnold Press",
      "Push Press", "Landmine Press", "Up-Right Rows", "Shrug"
    ]
  };

  window.MJM_GROUPS = {};
  Object.keys(LIBRARY).forEach(group => {
    LIBRARY[group].forEach(name => {
      const key = name.toLowerCase();
      if (!window.MJM_GROUPS[key]) window.MJM_GROUPS[key] = group;
    });
  });

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function emptyDay() {
    return { on: false, title: "", time: "", exercises: [] };
  }

  function readCards() {
    const plan = {};
    DAYS.forEach(day => { plan[day] = emptyDay(); });

    grid.querySelectorAll(".workout-card").forEach(card => {
      const badge = card.querySelector(".day-badge");
      const day = badge ? badge.textContent.trim() : "";
      if (!plan[day]) return;

      const exercises = [];
      card.querySelectorAll(".exercise-list li").forEach(item => {
        const label = Array.from(item.childNodes)
          .filter(node => node.nodeType === 3)
          .map(node => node.textContent)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        const cut = label.lastIndexOf(" - ");
        const name = cut === -1 ? label : label.slice(0, cut).trim();
        const detail = cut === -1 ? "3x8-12" : label.slice(cut + 3).trim();
        const match = detail.match(/^(\d+)\s*x\s*(.+)$/i);
        const rest = item.querySelector(".rest-note");

        exercises.push({
          name,
          sets: match ? Number(match[1]) : 3,
          reps: match ? match[2].trim() : detail,
          rest: rest ? rest.textContent.replace(/\s+rest\s*$/i, "").trim() : "2 minutes"
        });
      });

      const title = card.querySelector("h3");
      const time = card.querySelector(".time");
      plan[day] = {
        on: true,
        title: title ? title.textContent.trim() : day,
        time: time ? time.textContent.trim() : "",
        exercises
      };
    });

    return plan;
  }

  function isPlan(value) {
    return Boolean(value) && typeof value === "object" &&
      DAYS.every(day => value[day] && Array.isArray(value[day].exercises));
  }

  function loadPlan() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return isPlan(parsed) ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function renderGrid(plan) {
    grid.textContent = "";

    DAYS.forEach(day => {
      const entry = plan[day];
      if (!entry.on || !entry.exercises.length) return;

      const card = make("article", "workout-card");
      card.appendChild(make("span", "day-badge", day));
      card.appendChild(make("h3", "", entry.title));
      card.appendChild(make("p", "time", entry.time));

      const list = make("ul", "exercise-list");
      entry.exercises.forEach(exercise => {
        const item = document.createElement("li");
        item.appendChild(document.createTextNode(`${exercise.name} - ${exercise.sets}x${exercise.reps}`));
        item.appendChild(document.createTextNode(" "));
        item.appendChild(make("span", "rest-note", `${exercise.rest} rest`));
        list.appendChild(item);
      });

      card.appendChild(list);
      grid.appendChild(card);
    });
  }

  const original = readCards();
  const saved = loadPlan();
  if (saved) renderGrid(saved);

  let draft = null;
  const openDays = new Set();
  let lastFocus = null;

  const overlay = make("div", "plan-overlay");
  overlay.hidden = true;

  const dialog = make("div", "plan-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "plan-title");

  const head = make("div", "plan-head");
  const heading = make("h2", "", "Edit workout plan");
  heading.id = "plan-title";
  const closeButton = make("button", "plan-close", "\u00d7");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close editor");
  head.append(heading, closeButton);

  const help = make(
    "p",
    "plan-help",
    "Switch days on or off, then tap a day to change its exercises, sets, reps and rest."
  );
  const daysBox = make("div", "plan-days");
  const errorBox = make("p", "plan-error");
  errorBox.setAttribute("role", "alert");

  const actions = make("div", "plan-actions");
  const saveButton = make("button", "plan-btn", "Save plan");
  const cancelButton = make("button", "plan-btn plan-btn--ghost", "Cancel");
  const resetButton = make("button", "plan-btn plan-btn--ghost plan-btn--danger", "Reset to original");
  [saveButton, cancelButton, resetButton].forEach(button => { button.type = "button"; });
  actions.append(saveButton, cancelButton, resetButton);

  dialog.append(head, help, daysBox, errorBox, actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  function field(labelText, control) {
    const label = make("label", "plan-field");
    label.appendChild(make("span", "", labelText));
    label.appendChild(control);
    return label;
  }

  function input(type, value, attrs) {
    const node = document.createElement("input");
    node.type = type;
    node.value = value;
    Object.keys(attrs).forEach(key => node.setAttribute(key, attrs[key]));
    return node;
  }

  function restSelect(current, attrs) {
    const select = document.createElement("select");
    const options = REST_OPTIONS.includes(current) ? REST_OPTIONS : REST_OPTIONS.concat(current);
    options.forEach(value => {
      const option = make("option", "", value);
      option.value = value;
      option.selected = value === current;
      select.appendChild(option);
    });
    Object.keys(attrs).forEach(key => select.setAttribute(key, attrs[key]));
    return select;
  }

  function fillExerciseSelect(select, group) {
    select.textContent = "";
    const first = make("option", "", group ? "Choose exercise" : "Choose a muscle group first");
    first.value = "";
    select.appendChild(first);

    if (group && LIBRARY[group]) {
      LIBRARY[group].slice().sort((a, b) => a.localeCompare(b)).forEach(name => {
        const option = make("option", "", name);
        option.value = name;
        select.appendChild(option);
      });
      const custom = make("option", "", "Custom exercise...");
      custom.value = "__custom";
      select.appendChild(custom);
    }

    select.disabled = !group;
  }

  function buildPicker(day) {
    const box = make("div", "plan-add");
    box.dataset.day = day;
    box.appendChild(make("p", "plan-add-title", "Add an exercise"));

    const group = document.createElement("select");
    group.dataset.picker = "group";
    group.setAttribute("aria-label", `Muscle group for ${day}`);
    const groupFirst = make("option", "", "Choose muscle group");
    groupFirst.value = "";
    group.appendChild(groupFirst);
    Object.keys(LIBRARY).forEach(name => {
      const option = make("option", "", name);
      option.value = name;
      group.appendChild(option);
    });

    const pick = document.createElement("select");
    pick.dataset.picker = "pick";
    pick.setAttribute("aria-label", `Exercise for ${day}`);
    fillExerciseSelect(pick, "");

    const custom = input("text", "", {
      maxlength: "60",
      placeholder: "Exercise name",
      "aria-label": "Custom exercise name"
    });
    custom.dataset.picker = "custom";
    custom.hidden = true;

    const add = make("button", "plan-btn plan-btn--small", "Add exercise");
    add.type = "button";
    add.dataset.action = "add";
    add.dataset.day = day;

    box.append(group, pick, custom, add);
    return box;
  }

  function iconButton(label, symbol, action, day, index, disabled) {
    const button = make("button", "plan-icon", symbol);
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.dataset.action = action;
    button.dataset.day = day;
    button.dataset.index = String(index);
    button.disabled = Boolean(disabled);
    return button;
  }

  function buildExerciseRow(day, exercise, index, total) {
    const row = make("div", "plan-ex");
    row.appendChild(make("strong", "plan-ex-name", exercise.name));

    const fields = make("div", "plan-ex-fields");
    const base = { "data-day": day, "data-index": String(index) };
    fields.appendChild(field("Sets", input("number", String(exercise.sets), Object.assign({ min: "1", max: "10", inputmode: "numeric", "data-field": "sets" }, base))));
    fields.appendChild(field("Reps", input("text", exercise.reps, Object.assign({ maxlength: "12", "data-field": "reps" }, base))));
    fields.appendChild(field("Rest", restSelect(exercise.rest, Object.assign({ "data-field": "rest" }, base))));
    row.appendChild(fields);

    const buttons = make("div", "plan-ex-btns");
    buttons.appendChild(iconButton(`Move ${exercise.name} up`, "\u2191", "up", day, index, index === 0));
    buttons.appendChild(iconButton(`Move ${exercise.name} down`, "\u2193", "down", day, index, index === total - 1));
    buttons.appendChild(iconButton(`Remove ${exercise.name}`, "\u2715", "remove", day, index, false));
    row.appendChild(buttons);
    return row;
  }

  function renderDays() {
    daysBox.textContent = "";

    DAYS.forEach(day => {
      const entry = draft[day];
      const details = make("details", "plan-day");
      details.dataset.day = day;
      details.open = openDays.has(day);
      details.classList.toggle("is-on", entry.on);

      const summary = document.createElement("summary");
      summary.appendChild(make("span", "plan-day-name", day));
      const count = entry.exercises.length;
      summary.appendChild(
        make(
          "span",
          "plan-day-meta",
          entry.on ? `${entry.title || "Workout"} \u00b7 ${count} ${count === 1 ? "exercise" : "exercises"}` : "Rest day"
        )
      );
      details.appendChild(summary);

      const body = make("div", "plan-day-body");

      const toggle = make("label", "plan-toggle");
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = entry.on;
      check.dataset.field = "on";
      check.dataset.day = day;
      toggle.appendChild(check);
      toggle.appendChild(make("span", "", `${day} is a workout day`));
      body.appendChild(toggle);

      if (entry.on) {
        const meta = make("div", "plan-meta-fields");
        meta.appendChild(field("Workout title", input("text", entry.title, { maxlength: "40", "data-field": "title", "data-day": day })));
        meta.appendChild(field("Time", input("text", entry.time, { maxlength: "30", placeholder: "e.g. 4:00 - 5:00 PM", "data-field": "time", "data-day": day })));
        body.appendChild(meta);

        const list = make("div", "plan-ex-list");
        entry.exercises.forEach((exercise, index) => {
          list.appendChild(buildExerciseRow(day, exercise, index, count));
        });
        if (!count) list.appendChild(make("p", "plan-empty", "No exercises yet. Add one below."));
        body.appendChild(list);
        body.appendChild(buildPicker(day));
      }

      details.appendChild(body);
      daysBox.appendChild(details);
    });
  }

  function openEditor() {
    draft = JSON.parse(JSON.stringify(loadPlan() || original));
    openDays.clear();
    const firstOn = DAYS.find(day => draft[day].on);
    if (firstOn) openDays.add(firstOn);
    errorBox.textContent = "";
    renderDays();
    lastFocus = document.activeElement;
    overlay.hidden = false;
    document.body.classList.add("plan-open");
    closeButton.focus();
  }

  function closeEditor() {
    overlay.hidden = true;
    document.body.classList.remove("plan-open");
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
  }

  function showError(message, day) {
    errorBox.textContent = message;
    if (day) {
      openDays.add(day);
      renderDays();
      const target = daysBox.querySelector(`details[data-day="${day}"]`);
      if (target) target.scrollIntoView({ block: "nearest" });
    }
  }

  function validate() {
    const active = DAYS.filter(day => draft[day].on);
    if (!active.length) return { message: "Turn on at least one workout day.", day: null };

    for (const day of active) {
      const entry = draft[day];
      if (!entry.title.trim()) return { message: `Give ${day} a workout title.`, day };
      if (!entry.exercises.length) return { message: `Add at least one exercise to ${day}.`, day };

      for (const exercise of entry.exercises) {
        const sets = Number(exercise.sets);
        if (!Number.isInteger(sets) || sets < 1 || sets > 10) {
          return { message: `Sets for ${exercise.name} on ${day} must be a number from 1 to 10.`, day };
        }
        if (!String(exercise.reps).trim()) {
          return { message: `Enter the reps for ${exercise.name} on ${day}.`, day };
        }
      }
    }

    return null;
  }

  function savePlan() {
    const problem = validate();
    if (problem) {
      showError(problem.message, problem.day);
      return;
    }

    DAYS.forEach(day => {
      const entry = draft[day];
      entry.title = entry.title.trim();
      entry.time = entry.time.trim();
      entry.exercises.forEach(exercise => {
        exercise.sets = Number(exercise.sets);
        exercise.reps = String(exercise.reps).trim();
      });
    });

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch (error) {
      showError("Your browser could not save the plan. Check that storage is allowed for this site.", null);
      return;
    }

    window.location.reload();
  }

  function resetPlan() {
    if (!window.confirm("Go back to your original plan? Your edits will be removed. Your workout history stays.")) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      showError("Your browser could not reset the plan.", null);
      return;
    }
    window.location.reload();
  }

  daysBox.addEventListener("toggle", event => {
    const details = event.target;
    if (!details.dataset || !details.dataset.day) return;
    if (details.open) openDays.add(details.dataset.day);
    else openDays.delete(details.dataset.day);
  }, true);

  daysBox.addEventListener("input", event => {
    const target = event.target;
    const key = target.dataset.field;
    const day = target.dataset.day;
    if (!key || !day || key === "on" || key === "rest") return;

    if (key === "title" || key === "time") {
      draft[day][key] = target.value;
      return;
    }

    const exercise = draft[day].exercises[Number(target.dataset.index)];
    if (exercise) exercise[key] = target.value;
  });

  daysBox.addEventListener("change", event => {
    const target = event.target;

    if (target.dataset.picker === "group") {
      const pick = target.parentElement.querySelector('[data-picker="pick"]');
      const custom = target.parentElement.querySelector('[data-picker="custom"]');
      fillExerciseSelect(pick, target.value);
      custom.hidden = true;
      return;
    }

    if (target.dataset.picker === "pick") {
      const custom = target.parentElement.querySelector('[data-picker="custom"]');
      custom.hidden = target.value !== "__custom";
      if (!custom.hidden) custom.focus();
      return;
    }

    const key = target.dataset.field;
    const day = target.dataset.day;
    if (!key || !day) return;

    if (key === "on") {
      draft[day].on = target.checked;
      if (target.checked && !draft[day].title) draft[day].title = "Workout";
      openDays.add(day);
      renderDays();
      return;
    }

    if (key === "rest") {
      const exercise = draft[day].exercises[Number(target.dataset.index)];
      if (exercise) exercise.rest = target.value;
    }
  });

  daysBox.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const day = button.dataset.day;
    const index = Number(button.dataset.index);
    const list = draft[day].exercises;
    const action = button.dataset.action;
    errorBox.textContent = "";

    if (action === "remove") {
      list.splice(index, 1);
    } else if (action === "up" && index > 0) {
      [list[index - 1], list[index]] = [list[index], list[index - 1]];
    } else if (action === "down" && index < list.length - 1) {
      [list[index + 1], list[index]] = [list[index], list[index + 1]];
    } else if (action === "add") {
      const box = button.parentElement;
      const pick = box.querySelector('[data-picker="pick"]');
      const custom = box.querySelector('[data-picker="custom"]');
      const raw = pick.value === "__custom" ? custom.value : pick.value;
      const name = raw.replace(/\s+-\s+/g, "-").replace(/\s+/g, " ").trim();

      if (!name) {
        errorBox.textContent = "Choose a muscle group and an exercise first.";
        return;
      }

      list.push({ name, sets: 3, reps: "8-12", rest: "2 minutes" });
    } else {
      return;
    }

    openDays.add(day);
    renderDays();
  });

  closeButton.addEventListener("click", closeEditor);
  cancelButton.addEventListener("click", closeEditor);
  saveButton.addEventListener("click", savePlan);
  resetButton.addEventListener("click", resetPlan);

  overlay.addEventListener("click", event => {
    if (event.target === overlay) closeEditor();
  });

  document.addEventListener("keydown", event => {
    if (overlay.hidden) return;

    if (event.key === "Escape") {
      closeEditor();
      return;
    }

    if (event.key !== "Tab") return;

    const focusable = Array.from(
      dialog.querySelectorAll("button:not([disabled]), input:not([hidden]), select:not([disabled]), summary")
    ).filter(node => node.offsetParent !== null);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  const subtitle = section.querySelector(".section-subtitle");
  const bar = make("div", "plan-toolbar");
  const editButton = make("button", "plan-btn", "Edit plan");
  editButton.type = "button";
  editButton.setAttribute("aria-haspopup", "dialog");
  editButton.addEventListener("click", openEditor);
  bar.appendChild(editButton);
  if (saved) bar.appendChild(make("span", "plan-note", "Showing your custom plan"));

  if (subtitle) subtitle.insertAdjacentElement("afterend", bar);
  else section.insertBefore(bar, section.children[1] || null);
})();
