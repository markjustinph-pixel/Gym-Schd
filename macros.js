(() => {
  "use strict";

  const API_URL = "/api/scan-plate";

  const MAX_WIDTH = 800;
  const JPEG_QUALITY = 0.8;
  const SCAN_TIMEOUT_MS = 30000;

  const MULTIPLIERS = [0.5, 1, 1.5];

  const LOG_KEY = "mjm-macro-log-v1";
  const GOAL_KEY = "mjm-macro-goal-v1";

  const GOALS = {
    lose: { label: "Lose weight", adjust: -0.20, protein: 2.0 },
    maintain: { label: "Maintain weight", adjust: 0, protein: 1.6 },
    gain: { label: "Gain weight", adjust: 0.15, protein: 1.8 },
    muscle: { label: "Build muscle", adjust: 0.10, protein: 2.0 }
  };

  const ACTIVITY = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    very: 1.725
  };

  const FAT_SHARE = 0.25; 
  const MIN_CALORIES = { male: 1500, female: 1200 };

  const MOCK_PLATES = [
    [
      { name: "Gisadong chicken breast", grams: 120, calories: 198, protein: 37.2, carbs: 0, fat: 4.3 },
      { name: "Tokwa", grams: 80, calories: 150, protein: 14, carbs: 3, fat: 9 },
      { name: "Boiled egg", grams: 50, calories: 78, protein: 6.5, carbs: 0.6, fat: 5.3 },
      { name: "White rice", grams: 160, calories: 208, protein: 4.3, carbs: 44.8, fat: 0.5 }
    ],
    [
      { name: "Chicken adobo", grams: 150, calories: 260, protein: 24, carbs: 3, fat: 17 },
      { name: "Garlic rice", grams: 180, calories: 270, protein: 5, carbs: 45, fat: 7 },
      { name: "Fried egg", grams: 46, calories: 90, protein: 6.3, carbs: 0.4, fat: 7 }
    ]
  ];

  const video = document.getElementById("macro-video");
  if (!video) return;

  const viewport = document.getElementById("macro-viewport");
  const cameraBtn = document.getElementById("macro-camera-btn");
  const scanBtn = document.getElementById("macro-scan-btn");
  const simBtn = document.getElementById("macro-sim-btn");
  const statusEl = document.getElementById("macro-status");
  const resultCard = document.getElementById("macro-result");
  const noteEl = document.getElementById("macro-confidence");
  const itemsList = document.getElementById("macro-items");
  const logBtn = document.getElementById("macro-log-btn");
  const cancelBtn = document.getElementById("macro-cancel-btn");
  const logList = document.getElementById("macro-log");
  const todayCount = document.getElementById("macro-today-count");

  const resultFields = {
    calories: document.getElementById("macro-result-calories"),
    protein: document.getElementById("macro-result-protein"),
    carbs: document.getElementById("macro-result-carbs"),
    fat: document.getElementById("macro-result-fat")
  };

  const totalFields = {
    calories: document.getElementById("macro-total-calories"),
    protein: document.getElementById("macro-total-protein"),
    carbs: document.getElementById("macro-total-carbs"),
    fat: document.getElementById("macro-total-fat")
  };

  let stream = null;
  let busy = false;
  let items = [];

  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.classList.toggle("is-error", Boolean(isError));
  }

  function round(value, places) {
    const factor = Math.pow(10, places);
    return Math.round(value * factor) / factor;
  }

  function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function todayKey() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${now.getFullYear()}-${month}-${day}`;
  }

  function readLog() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LOG_KEY));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function writeLog(log) {
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(log));
      return true;
    } catch (error) {
      return false;
    }
  }


  function setCameraState(on) {
    viewport.classList.toggle("is-live", on);
    cameraBtn.textContent = on ? "Stop camera" : "Start camera";
    scanBtn.disabled = !on || busy;
  }

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("This browser cannot open the camera. Use Chrome over HTTPS.", true);
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });
      video.srcObject = stream;
      await video.play();
      setCameraState(true);
      setStatus("Frame your whole plate, then tap Snap & Scan.");
    } catch (error) {
      stopCamera();
      if (error && error.name === "NotAllowedError") {
        setStatus("Camera permission was denied. Allow it in your browser settings and try again.", true);
      } else if (error && error.name === "NotFoundError") {
        setStatus("No camera was found on this device.", true);
      } else {
        setStatus("Could not start the camera.", true);
      }
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }
    video.srcObject = null;
    setCameraState(false);
  }

  function captureFrame() {
    const sourceW = video.videoWidth;
    const sourceH = video.videoHeight;
    if (!sourceW || !sourceH) {
      throw new Error("The camera is not ready yet. Wait a moment and try again.");
    }

    const scale = Math.min(1, MAX_WIDTH / sourceW);
    const canvas = document.createElement("canvas"); 
    canvas.width = Math.round(sourceW * scale);
    canvas.height = Math.round(sourceH * scale);

    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL("image/jpeg", JPEG_QUALITY).split(",")[1];
  }


  async function requestScan(image) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
    let response;

    try {
      response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, mimeType: "image/jpeg" }),
        signal: controller.signal
      });
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new Error("The scan took too long. Try again.");
      }
      throw new Error("Could not reach the scan service. Check your connection, or use Simulate scan.");
    } finally {
      clearTimeout(timer);
    }

    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error("Scan service not found. /api only runs on Vercel (or vercel dev). Use Simulate scan to test locally.");
      }
      throw new Error((data && data.error) || "Scan failed (" + response.status + "). Try again.");
    }

    return data;
  }

  function normalizeItems(list) {
    if (!Array.isArray(list)) return [];

    return list
      .map((raw, index) => {
        const source = raw && typeof raw === "object" ? raw : {};
        return {
          id: index,
          name: String(source.name || "").trim(),
          baseGrams: toNumber(source.grams),
          base: {
            calories: toNumber(source.calories),
            protein: toNumber(source.protein),
            carbs: toNumber(source.carbs),
            fat: toNumber(source.fat)
          },
          multiplier: 1
        };
      })
      .filter(item => item.name && item.baseGrams > 0);
  }

  function scaled(item) {
    const m = item.multiplier;
    return {
      grams: round(item.baseGrams * m, 1),
      calories: round(item.base.calories * m, 0),
      protein: round(item.base.protein * m, 1),
      carbs: round(item.base.carbs * m, 1),
      fat: round(item.base.fat * m, 1)
    };
  }

  function renderResult(focusId, focusMultiplier) {
    const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    itemsList.textContent = "";

    items.forEach(item => {
      const values = scaled(item);
      Object.keys(totals).forEach(key => {
        totals[key] += values[key];
      });

      const li = document.createElement("li");
      li.className = "macro-item";

      const head = document.createElement("div");
      head.className = "macro-item-head";

      const text = document.createElement("div");
      const name = document.createElement("span");
      const detail = document.createElement("span");
      name.className = "macro-log-name";
      name.textContent = item.name + " (" + values.grams + " g)";
      detail.className = "macro-log-detail";
      detail.textContent = values.calories + " cal, " + values.protein + " g protein, " +
        values.carbs + " g carbs, " + values.fat + " g fat";
      text.append(name, detail);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "todo-link";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", "Remove " + item.name);
      remove.addEventListener("click", () => removeItem(item.id));

      head.append(text, remove);

      const controls = document.createElement("div");
      controls.className = "todo-filters macro-item-controls";
      controls.setAttribute("role", "group");
      controls.setAttribute("aria-label", "Portion for " + item.name);

      MULTIPLIERS.forEach(multiplier => {
        const active = item.multiplier === multiplier;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "todo-filter" + (active ? " is-active" : "");
        button.setAttribute("aria-pressed", active ? "true" : "false");
        button.textContent = multiplier + "x";
        button.addEventListener("click", () => {
          item.multiplier = multiplier;
          renderResult(item.id, multiplier);
        });
        if (item.id === focusId && multiplier === focusMultiplier) {
          requestAnimationFrame(() => button.focus());
        }
        controls.appendChild(button);
      });

      li.append(head, controls);
      itemsList.appendChild(li);
    });

    resultFields.calories.textContent = round(totals.calories, 0);
    resultFields.protein.textContent = round(totals.protein, 1);
    resultFields.carbs.textContent = round(totals.carbs, 1);
    resultFields.fat.textContent = round(totals.fat, 1);
  }

  function showResult(list, note) {
    items = list;
    noteEl.textContent = note;
    resultCard.hidden = false;
    renderResult();
    resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function hideResult() {
    items = [];
    itemsList.textContent = "";
    resultCard.hidden = true;
  }

  function removeItem(id) {
    items = items.filter(item => item.id !== id);
    if (items.length === 0) {
      hideResult();
      setStatus("All items removed. Scan again when ready.");
      return;
    }
    renderResult();
  }

  async function scanPlate() {
    if (busy) return;

    if (!stream) {
      setStatus("Start the camera first.", true);
      return;
    }

    busy = true;
    scanBtn.disabled = true;
    scanBtn.textContent = "Scanning...";
    setStatus("Reading your plate...");

    try {
      const image = captureFrame();
      const data = await requestScan(image);
      const detected = normalizeItems(data && data.items);

      if (detected.length === 0) {
        setStatus("No food detected. Move closer, add light, and scan again.", true);
        return;
      }

      setStatus("");
      showResult(detected, "AI estimate. Adjust portions or remove items before adding.");
    } catch (error) {
      setStatus(error && error.message ? error.message : "Scan failed. Try again.", true);
    } finally {
      busy = false;
      scanBtn.textContent = "Snap & Scan";
      scanBtn.disabled = !stream;
    }
  }

  function simulateScan() {
    const plate = MOCK_PLATES[Math.floor(Math.random() * MOCK_PLATES.length)];
    setStatus("Simulated scan. No camera or API was used.");
    showResult(normalizeItems(plate), "Simulated plate for testing.");
  }


  function renderToday() {
    const entries = readLog()[todayKey()] || [];
    const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };

    entries.forEach(entry => {
      Object.keys(totals).forEach(key => {
        totals[key] += Number(entry[key]) || 0;
      });
    });

    totalFields.calories.textContent = round(totals.calories, 0);
    totalFields.protein.textContent = round(totals.protein, 1);
    totalFields.carbs.textContent = round(totals.carbs, 1);
    totalFields.fat.textContent = round(totals.fat, 1);
    renderGoalProgress(totals);

    todayCount.textContent = entries.length === 0
      ? "Nothing logged yet"
      : entries.length + (entries.length === 1 ? " item logged" : " items logged");

    logList.textContent = "";
    entries.forEach(entry => {
      const item = document.createElement("li");
      const text = document.createElement("div");
      const name = document.createElement("span");
      const detail = document.createElement("span");
      const remove = document.createElement("button");

      name.className = "macro-log-name";
      name.textContent = entry.name + " (" + entry.grams + " g)";
      detail.className = "macro-log-detail";
      detail.textContent = entry.calories + " cal, " + entry.protein + " g protein, " +
        entry.carbs + " g carbs, " + entry.fat + " g fat";
      text.append(name, detail);

      remove.type = "button";
      remove.className = "todo-link";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", "Remove " + entry.name);
      remove.addEventListener("click", () => removeEntry(entry.id));

      item.append(text, remove);
      logList.appendChild(item);
    });
  }

  function logMeal() {
    if (items.length === 0) return;

    const log = readLog();
    const key = todayKey();
    const entries = Array.isArray(log[key]) ? log[key] : [];
    const stamp = Date.now();

    items.forEach((item, index) => {
      const values = scaled(item);
      entries.push({
        id: stamp + index,
        name: item.name,
        grams: values.grams,
        calories: values.calories,
        protein: values.protein,
        carbs: values.carbs,
        fat: values.fat
      });
    });
    log[key] = entries;

    if (!writeLog(log)) {
      setStatus("Could not save. Browser storage may be full or blocked.", true);
      return;
    }

    const count = items.length;
    hideResult();
    renderToday();
    setStatus(count + (count === 1 ? " item" : " items") + " added to today's total.");
  }

  function removeEntry(id) {
    const log = readLog();
    const key = todayKey();
    if (!Array.isArray(log[key])) return;
    log[key] = log[key].filter(entry => entry.id !== id);
    writeLog(log);
    renderToday();
  }


  const goalForm = document.getElementById("macro-goal-form");
  const goalStatus = document.getElementById("macro-goal-status");
  const goalSummary = document.getElementById("macro-goal-summary");
  const goalTargetsBox = document.getElementById("macro-goal-targets");
  const goalNote = document.getElementById("macro-goal-note");
  const goalClearBtn = document.getElementById("macro-goal-clear");
  const goalProgress = document.getElementById("macro-goal-progress");
  const goalRemaining = document.getElementById("macro-goal-remaining");
  const goalHint = document.getElementById("macro-goal-hint");
  const bar = document.getElementById("macro-bar");
  const barFill = document.getElementById("macro-bar-fill");

  const goalInputs = {
    goal: document.getElementById("goal-type"),
    weight: document.getElementById("goal-weight"),
    height: document.getElementById("goal-height"),
    age: document.getElementById("goal-age"),
    sex: document.getElementById("goal-sex"),
    activity: document.getElementById("goal-activity")
  };

  const goalTargetFields = {
    calories: document.getElementById("macro-goal-calories"),
    protein: document.getElementById("macro-goal-protein"),
    carbs: document.getElementById("macro-goal-carbs"),
    fat: document.getElementById("macro-goal-fat")
  };

  const goalOfFields = {
    calories: document.getElementById("macro-of-calories"),
    protein: document.getElementById("macro-of-protein"),
    carbs: document.getElementById("macro-of-carbs"),
    fat: document.getElementById("macro-of-fat")
  };

  let goal = readGoal();

  function readGoal() {
    try {
      const parsed = JSON.parse(localStorage.getItem(GOAL_KEY));
      return parsed && parsed.profile && parsed.targets ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function writeGoal(value) {
    try {
      if (value) {
        localStorage.setItem(GOAL_KEY, JSON.stringify(value));
      } else {
        localStorage.removeItem(GOAL_KEY);
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  function setGoalStatus(text, isError) {
    goalStatus.textContent = text;
    goalStatus.classList.toggle("is-error", Boolean(isError));
  }

  function validateProfile(p) {
    if (!GOALS[p.goal]) return "Pick a goal.";
    if (!ACTIVITY[p.activity]) return "Pick an activity level.";
    if (p.sex !== "male" && p.sex !== "female") return "Pick male or female (needed for the calorie formula).";
    if (!(p.weightKg >= 35 && p.weightKg <= 250)) return "Enter your weight in kg (35 to 250).";
    if (!(p.heightCm >= 120 && p.heightCm <= 230)) return "Enter your height in cm (120 to 230).";
    if (!(p.age >= 18 && p.age <= 80)) return "This calculator is for adults aged 18 to 80.";
    return "";
  }

  function calcTargets(p) {
    const bmr = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === "male" ? 5 : -161);
    const maintenance = bmr * ACTIVITY[p.activity];
    const plan = GOALS[p.goal];

    let calories = maintenance * (1 + plan.adjust);
    let raisedToMinimum = false;
    if (plan.adjust < 0 && calories < MIN_CALORIES[p.sex]) {
      calories = MIN_CALORIES[p.sex];
      raisedToMinimum = true;
    }
    calories = Math.round(calories / 10) * 10;

    const proteinCap = Math.round(calories * 0.35 / 4);
    const protein = Math.min(Math.round(p.weightKg * plan.protein), proteinCap);
    const fat = Math.round(calories * FAT_SHARE / 9);
    const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));

    return {
      calories,
      protein,
      carbs,
      fat,
      maintenance: Math.round(maintenance / 10) * 10,
      raisedToMinimum
    };
  }

  function goalNoteText(profile, targets) {
    const plan = GOALS[profile.goal];
    const weekly = round(Math.abs(targets.calories - targets.maintenance) * 7 / 7700, 1);
    let text = "Your maintenance is about " + targets.maintenance + " cal a day. ";

    if (profile.goal === "lose") {
      text += "This plan is about " + weekly + " kg of fat loss per week.";
    } else if (profile.goal === "gain" || profile.goal === "muscle") {
      text += "This plan is about " + weekly + " kg of gain per week. Train hard and eat enough protein.";
    } else {
      text += "Eat close to this to hold your weight.";
    }

    if (targets.raisedToMinimum) {
      text += " Your target was raised to a safe minimum of " + MIN_CALORIES[profile.sex] + " cal.";
    }
    return plan ? text : "";
  }

  function fillGoalForm(profile) {
    goalInputs.goal.value = profile.goal;
    goalInputs.weight.value = profile.weightKg;
    goalInputs.height.value = profile.heightCm;
    goalInputs.age.value = profile.age;
    goalInputs.sex.value = profile.sex;
    goalInputs.activity.value = profile.activity;
  }

  function renderGoal() {
    if (!goal) {
      goalSummary.textContent = "Pick a goal and enter your details to get daily targets";
      goalTargetsBox.hidden = true;
      return;
    }

    goalSummary.textContent = GOALS[goal.profile.goal].label + " plan";
    Object.keys(goalTargetFields).forEach(key => {
      goalTargetFields[key].textContent = goal.targets[key];
    });
    goalNote.textContent = goalNoteText(goal.profile, goal.targets);
    goalTargetsBox.hidden = false;
  }

  function renderGoalProgress(totals) {
    Object.keys(goalOfFields).forEach(key => {
      goalOfFields[key].textContent = goal ? "of " + goal.targets[key] : "";
    });

    if (!goal) {
      goalProgress.hidden = true;
      goalHint.hidden = false;
      return;
    }

    goalHint.hidden = true;
    goalProgress.hidden = false;

    const target = goal.targets.calories;
    const diff = Math.round(target - totals.calories);
    const percent = Math.min(100, Math.round((totals.calories / target) * 100));

    goalRemaining.textContent = diff >= 0
      ? diff + " cal left today"
      : Math.abs(diff) + " cal over today's target";
    barFill.style.width = percent + "%";
    bar.setAttribute("aria-valuenow", String(percent));
    bar.classList.toggle("is-over", diff < 0);
  }

  goalForm.addEventListener("submit", event => {
    event.preventDefault();

    const profile = {
      goal: goalInputs.goal.value,
      sex: goalInputs.sex.value,
      activity: goalInputs.activity.value,
      weightKg: parseFloat(goalInputs.weight.value),
      heightCm: parseFloat(goalInputs.height.value),
      age: parseInt(goalInputs.age.value, 10)
    };

    const problem = validateProfile(profile);
    if (problem) {
      setGoalStatus(problem, true);
      return;
    }

    goal = { profile, targets: calcTargets(profile) };
    const saved = writeGoal(goal);
    setGoalStatus(saved ? "Targets saved." : "Targets calculated, but they could not be saved in this browser.", !saved);
    renderGoal();
    renderToday();
  });

  goalClearBtn.addEventListener("click", () => {
    goal = null;
    writeGoal(null);
    goalForm.reset();
    setGoalStatus("Goal cleared.");
    renderGoal();
    renderToday();
  });

  if (goal) fillGoalForm(goal.profile);
  renderGoal();


  cameraBtn.addEventListener("click", () => {
    if (stream) {
      stopCamera();
      setStatus("Camera stopped.");
    } else {
      startCamera();
    }
  });

  scanBtn.addEventListener("click", scanPlate);
  simBtn.addEventListener("click", simulateScan);
  logBtn.addEventListener("click", logMeal);

  cancelBtn.addEventListener("click", () => {
    hideResult();
    setStatus("Scan discarded.");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (stream) {
        stopCamera();
        setStatus("Camera stopped. Tap Start camera to continue.");
      }
    } else {
      renderToday();
    }
  });

  window.addEventListener("pagehide", stopCamera);

  renderToday();
})();
