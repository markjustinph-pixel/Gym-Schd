(() => {
  "use strict";
  const cards = Array.from(document.querySelectorAll(".workout-card"));

  const weeklyText = document.getElementById("weekly-progress-text");
  const weeklyPercent = document.getElementById("weekly-progress-percent");
  const weeklyBar = document.getElementById("weekly-progress-bar");
  const weeklyFill = document.getElementById("weekly-progress-fill");

  const streakSummary = document.getElementById("streak-summary");
  const achievementList = document.getElementById("achievement-list");
  const historyList = document.getElementById("history-list");

  if (!cards.length) return;

  const STORAGE_PREFIX = "mjm-workout-progress-";
  function getWeekStart(date = new Date()) {
    const monday = new Date(date);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return monday;
  }

  function formatDateId(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function parseDateId(id) {
    const [year, month, day] = id.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function shiftWeek(id, weeks) {
    const date = parseDateId(id);
    date.setDate(date.getDate() + weeks * 7);
    return formatDateId(date);
  }

  const currentWeekId = formatDateId(getWeekStart());
  const storageKey = STORAGE_PREFIX + currentWeekId;

  function parseSaved(raw) {
    try {
      const data = JSON.parse(raw);
      return data && typeof data === "object" ? data : {};
    } catch (error) {
      return {};
    }
  }

  let storageWarningShown = false;

  function showStorageWarning() {
    if (storageWarningShown) return;
    storageWarningShown = true;

    const note = document.createElement("p");
    note.className = "storage-warning";
    note.setAttribute("role", "alert");
    note.textContent =
      "Your browser is blocking saved progress. Checks will be lost when you leave this page.";

    const anchor = document.querySelector(".weekly-progress");
    if (anchor) anchor.after(note);
  }

  function readProgress() {
    try {
      return parseSaved(localStorage.getItem(storageKey));
    } catch (error) {
      console.warn("Workout progress could not be read:", error);
      showStorageWarning();
      return {};
    }
  }

  let progress = readProgress();

  function saveProgress() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(progress));
    } catch (error) {
      console.warn("Workout progress could not be saved:", error);
      showStorageWarning();
    }
  }

  function readAllWeeks() {
    const weeks = {};

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(STORAGE_PREFIX)) {
          const id = key.slice(STORAGE_PREFIX.length);
          if (/^\d{4}-\d{2}-\d{2}$/.test(id)) {
            weeks[id] = parseSaved(localStorage.getItem(key));
          }
        }
      }
    } catch (error) {
      console.warn("Workout history could not be read:", error);
    }

    weeks[currentWeekId] = progress;
    return weeks;
  }

  const cardKeys = new Map();

  function getDayName(card) {
    return card.querySelector(".day-badge")?.textContent.trim() || "Day";
  }

  function makeExerciseKey(card, exerciseContent, index) {
    const day = getDayName(card) || "day";
    const name = exerciseContent.textContent.trim();

    return `${day}-${index}-${name}`.toLowerCase().replace(/\s+/g, " ");
  }

  function updateCard(card) {
    const checkboxes = Array.from(card.querySelectorAll(".exercise-check"));
    const completed = checkboxes.filter(box => box.checked).length;
    const total = checkboxes.length;
    const percent = total ? Math.round((completed / total) * 100) : 0;

    const count = card.querySelector(".card-progress-count");
    const fill = card.querySelector(".card-progress-fill");
    const track = card.querySelector(".card-progress-track");

    card.dataset.done = String(completed);
    card.dataset.total = String(total);

    if (count) count.textContent = `${completed}/${total} completed`;
    if (fill) fill.style.transform = `scaleX(${percent / 100})`;
    if (track) track.setAttribute("aria-valuenow", String(percent));

    checkboxes.forEach(box => {
      box.closest("li")?.classList.toggle("is-complete", box.checked);
    });

    return total > 0 && completed === total;
  }

  function updateWeeklyProgress() {
    const completedDays = cards.filter(updateCard).length;
    const totalDays = cards.length;

    updateDayTabs();
    const percent = totalDays
      ? Math.round((completedDays / totalDays) * 100)
      : 0;

    if (weeklyText) {
      weeklyText.textContent =
        `${completedDays} of ${totalDays} workout days completed`;
    }
    if (weeklyPercent) weeklyPercent.textContent = `${percent}%`;
    if (weeklyFill) weeklyFill.style.transform = `scaleX(${percent / 100})`;
    if (weeklyBar) weeklyBar.setAttribute("aria-valuenow", String(percent));
  }

  function computeWeekStats(data) {
    const days = cards.map(card => {
      const keys = cardKeys.get(card) || [];
      const done = keys.filter(key => data[key] === true).length;

      return {
        name: getDayName(card),
        done,
        total: keys.length,
        complete: keys.length > 0 && done === keys.length
      };
    });

    const completedDays = days.filter(day => day.complete).length;
    const completedExercises = days.reduce((sum, d) => sum + d.done, 0);
    const totalExercises = days.reduce((sum, d) => sum + d.total, 0);

    return {
      days,
      completedDays,
      totalDays: days.length,
      completedExercises,
      totalExercises,
      percent: days.length
        ? Math.round((completedDays / days.length) * 100)
        : 0,
      successful: days.length > 0 && completedDays === days.length
    };
  }

  function computeStreaks(statsById) {
    const successIds = Object.keys(statsById)
      .filter(id => statsById[id].successful)
      .sort();

    let best = 0;
    let run = 0;
    let previousId = null;

    successIds.forEach(id => {
      run = previousId && shiftWeek(previousId, 1) === id ? run + 1 : 1;
      best = Math.max(best, run);
      previousId = id;
    });

    let cursor = statsById[currentWeekId]?.successful
      ? currentWeekId
      : shiftWeek(currentWeekId, -1);

    let current = 0;
    while (statsById[cursor]?.successful) {
      current++;
      cursor = shiftWeek(cursor, -1);
    }

    return { best, current, totalSuccessfulWeeks: successIds.length };
  }

  const ACHIEVEMENTS = [
    {
      id: "first-full-week",
      title: "First Full Week",
      description: "Complete every workout day in one week.",
      type: "total",
      goal: 1
    },
    {
      id: "four-week-streak",
      title: "Four-Week Streak",
      description: "Complete four successful weeks in a row.",
      type: "streak",
      goal: 4
    },
    {
      id: "twelve-week-streak",
      title: "Twelve-Week Streak",
      description: "Complete twelve successful weeks in a row.",
      type: "streak",
      goal: 12
    }
  ];

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function pluralWeeks(n) {
    return `${n} ${n === 1 ? "week" : "weeks"}`;
  }

  function renderAchievements(streaks, currentStats) {
    if (streakSummary) {
      streakSummary.textContent =
        `Current streak: ${pluralWeeks(streaks.current)}. ` +
        `Best streak: ${pluralWeeks(streaks.best)}.`;
    }

    if (!achievementList) return;
    achievementList.replaceChildren();

    ACHIEVEMENTS.forEach(item => {
      const best = item.type === "total"
        ? streaks.totalSuccessfulWeeks
        : streaks.best;
      const unlocked = best >= item.goal;

      let status;
      if (unlocked) {
        status = "Unlocked";
      } else if (item.type === "total") {
        status =
          `${currentStats.completedDays}/${currentStats.totalDays} days this week`;
      } else {
        status = `${streaks.current}/${item.goal} weeks`;
      }

      const card = el(
        "li",
        `achievement-card ${unlocked ? "is-unlocked" : "is-locked"}`
      );
      card.appendChild(el("h4", "", item.title));
      card.appendChild(el("p", "", item.description));
      card.appendChild(el("span", "achievement-status", status));
      achievementList.appendChild(card);
    });
  }

  function formatWeekRange(id) {
    const start = parseDateId(id);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);

    const short = { month: "short", day: "numeric" };
    const startText = start.toLocaleDateString("en-US", short);
    const endText = end.toLocaleDateString("en-US", {
      ...short,
      year: "numeric"
    });

    return `${startText} - ${endText}`;
  }

  function renderHistory(statsById) {
    if (!historyList) return;
    historyList.replaceChildren();

    const ids = Object.keys(statsById).sort().reverse();

    ids.forEach(id => {
      const stats = statsById[id];
      const isCurrent = id === currentWeekId;

      const item = el("li", `history-item${isCurrent ? " is-current" : ""}`);

      const top = el("div", "history-top");
      const title = el("span", "history-title", `Week of ${formatWeekRange(id)}`);
      if (isCurrent) title.appendChild(el("span", "history-tag", "Current week"));
      top.appendChild(title);
      top.appendChild(el("strong", "history-percent", `${stats.percent}%`));
      item.appendChild(top);

      item.appendChild(
        el(
          "p",
          "history-meta",
          `${stats.completedDays} of ${stats.totalDays} days completed, ` +
          `${stats.completedExercises} of ${stats.totalExercises} exercises checked`
        )
      );

      const chips = el("ul", "day-chips");
      stats.days.forEach(day => {
        const chip = el(
          "li",
          `day-chip${day.complete ? " is-done" : ""}`,
          `${day.name.slice(0, 3)} ${day.done}/${day.total}`
        );
        chips.appendChild(chip);
      });
      item.appendChild(chips);

      historyList.appendChild(item);
    });
  }

  function refreshSummary() {
    const weeks = readAllWeeks();
    const statsById = {};

    Object.keys(weeks).forEach(id => {
      statsById[id] = computeWeekStats(weeks[id]);
    });

    renderAchievements(computeStreaks(statsById), statsById[currentWeekId]);
    renderHistory(statsById);
  }

  cards.forEach(card => {
    const list = card.querySelector(".exercise-list");
    if (!list) return;

    const day = getDayName(card);
    const keys = [];
    cardKeys.set(card, keys);

    const progressPanel = document.createElement("div");
    progressPanel.className = "card-progress";
    progressPanel.innerHTML = `
      <div class="card-progress-header">
        <span>Daily Progress</span>
        <strong class="card-progress-count">0/0 completed</strong>
      </div>
      <div class="progress-track card-progress-track"
           role="progressbar"
           aria-label="${day} exercise completion"
           aria-valuemin="0"
           aria-valuemax="100"
           aria-valuenow="0">
        <span class="card-progress-fill"></span>
      </div>
    `;
    card.insertBefore(progressPanel, list);

    Array.from(list.querySelectorAll("li")).forEach((item, index) => {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "exercise-check";

      const content = document.createElement("div");
      content.className = "exercise-content";

      while (item.firstChild) {
        content.appendChild(item.firstChild);
      }

      const label = (
        content.firstChild?.nodeType === Node.TEXT_NODE
          ? content.firstChild.textContent
          : content.textContent
      ).trim().replace(/\s+/g, " ");

      checkbox.setAttribute("aria-label", `Mark ${label} complete`);

      const key = makeExerciseKey(card, content, index);
      keys.push(key);

      checkbox.checked = Boolean(progress[key]);

      item.appendChild(checkbox);
      item.appendChild(content);

      checkbox.addEventListener("change", () => {
        progress[key] = checkbox.checked;
        saveProgress();
        updateWeeklyProgress();
        refreshSummary();
      });
    });
  });

  const DAY_NAMES = [
    "Sunday", "Monday", "Tuesday", "Wednesday",
    "Thursday", "Friday", "Saturday"
  ];

  const dayTabs = [];
  const todayCardIndex = cards.findIndex(
    card =>
      getDayName(card).toLowerCase() ===
      DAY_NAMES[new Date().getDay()].toLowerCase()
  );

  function pickDefaultIndex() {
    const today = new Date().getDay();

    for (let offset = 0; offset < 7; offset++) {
      const name = DAY_NAMES[(today + offset) % 7].toLowerCase();
      const found = cards.findIndex(
        card => getDayName(card).toLowerCase() === name
      );
      if (found !== -1) return found;
    }

    return 0;
  }

  function selectDay(index, moveFocus = false) {
    cards.forEach((card, i) => {
      card.hidden = i !== index;
    });

    dayTabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      tab.classList.toggle("is-selected", selected);
    });

    if (moveFocus) dayTabs[index].focus();
  }

  function updateDayTabs() {
    cards.forEach((card, i) => {
      const tab = dayTabs[i];
      if (!tab) return;

      const done = Number(card.dataset.done || 0);
      const total = Number(card.dataset.total || 0);
      const complete = total > 0 && done === total;

      tab.classList.toggle("is-complete", complete);
      tab.classList.toggle("is-started", done > 0 && !complete);

      tab.querySelector(".day-tab-status").textContent =
        complete ? "Done" : `${done}/${total}`;

      tab.setAttribute(
        "aria-label",
        `${getDayName(card)}, ${done} of ${total} exercises completed` +
        (i === todayCardIndex ? ", today" : "")
      );
    });
  }

  function buildDaySelector() {
    const container = document.getElementById("day-selector");
    if (!container) return;

    cards[0].parentElement.classList.add("has-selector");

    cards.forEach((card, i) => {
      const day = getDayName(card);

      card.id = card.id || `day-panel-${i}`;
      card.setAttribute("role", "tabpanel");
      card.setAttribute("aria-labelledby", `day-tab-${i}`);

      const tab = el("button", "day-tab");
      tab.type = "button";
      tab.id = `day-tab-${i}`;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", card.id);

      tab.appendChild(el("span", "day-tab-name", day.slice(0, 3)));
      tab.appendChild(el("span", "day-tab-status", "0/0"));

      if (i === todayCardIndex) {
        tab.appendChild(el("span", "day-tab-today", "Today"));
      }

      tab.addEventListener("click", () => selectDay(i));

      tab.addEventListener("keydown", event => {
        let next = null;

        if (event.key === "ArrowRight") next = (i + 1) % cards.length;
        if (event.key === "ArrowLeft") {
          next = (i - 1 + cards.length) % cards.length;
        }
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = cards.length - 1;

        if (next !== null) {
          event.preventDefault();
          selectDay(next, true);
        }
      });

      container.appendChild(tab);
      dayTabs.push(tab);
    });

    selectDay(pickDefaultIndex());
  }

  buildDaySelector();

  function checkForNewWeek() {
    if (formatDateId(getWeekStart()) !== currentWeekId) {
      window.location.reload();
    }
  }

  setInterval(checkForNewWeek, 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkForNewWeek();
  });

  updateWeeklyProgress();
  refreshSummary();
})();

(() => {
  "use strict";

  const CONTACT_EMAIL = "markjustin.ph@gmail.com";

  const form = document.getElementById("contact-form");
  const status = document.getElementById("form-status");

  if (!form) return;

  function showStatus(message, isError = false) {
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("is-error", isError);
  }

  function buildMailto(data) {
    const subject = `${data.topic} - message from ${data.name}`;

    const body =
      `Name: ${data.name}\n` +
      `Email: ${data.email}\n` +
      `Inquiry: ${data.topic}\n\n` +
      data.message;

    return (
      `mailto:${CONTACT_EMAIL}` +
      `?subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(body)}`
    );
  }

  form.addEventListener("submit", event => {
    event.preventDefault();

    if (CONTACT_EMAIL === "your-email@example.com") {
      showStatus(
        "The site owner has not set an email address yet. Open contact.js and replace CONTACT_EMAIL.",
        true
      );
      return;
    }

    const topicSelect = form.elements["topic"];

    const data = {
      name: form.elements["full-name"].value.trim(),
      email: form.elements["email"].value.trim(),
      topic: topicSelect.selectedOptions[0]?.textContent.trim() || "",
      message: form.elements["message"].value.trim()
    };

    window.location.href = buildMailto(data);

    showStatus(
      `Your email app should open with the message ready. If nothing happens, email ${CONTACT_EMAIL} directly.`
    );
  });
})();

(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let leaving = false;

  document.addEventListener("click", event => {
    const link = event.target.closest("a[href]");
    if (!link) return;

    if (
      event.defaultPrevented || event.button !== 0 ||
      event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
      link.hasAttribute("download") ||
      (link.target && link.target !== "_self")
    ) return;

    const url = new URL(link.href, window.location.href);
    const samePlace =
      url.protocol === window.location.protocol &&
      url.host === window.location.host;

    if (!samePlace || url.pathname === window.location.pathname) return;

    event.preventDefault();
    if (leaving) return;
    leaving = true;

    document.body.classList.add("is-leaving");

    window.setTimeout(
      () => { window.location.href = link.href; },
      reduceMotion.matches ? 0 : 250
    );
  });

  window.addEventListener("pageshow", event => {
    if (event.persisted) {
      leaving = false;
      document.body.classList.remove("is-leaving");
    }
  });
})();


(() => {
  "use strict";

  const GUIDES = {
    "incline barbell bench press": ["Upper chest, shoulders, triceps", "Set the bench to a 30-45 degree incline and lie back with your eyes under the bar.|Grip slightly wider than your shoulders, unrack, and lower the bar to your upper chest.|Press up and slightly back until your arms are straight.", "Keep your shoulder blades pinched and feet flat. Use a spotter for heavy sets."],
    "flat barbell bench press": ["Chest, triceps, front shoulders", "Lie flat with your eyes under the bar, feet planted and shoulder blades squeezed together.|Unrack and lower the bar to mid-chest, elbows about 45-75 degrees from your body.|Press back up to straight arms without bouncing the bar.", "Keep your wrists stacked over your elbows. Use a spotter or safety bars."],
    "close-grip dumbbell press": ["Triceps, chest", "Lie on a flat bench holding the dumbbells together over your chest, palms facing each other.|Lower slowly, keeping your elbows tucked close to your ribs.|Press up while squeezing the dumbbells together.", "Keep the dumbbells touching the whole time for more triceps work."],
    "rope push-down": ["Triceps", "Attach a rope to a high pulley and stand with your elbows pinned to your sides.|Push the rope down until your arms are straight, spreading the ends apart at the bottom.|Return slowly until your forearms are just past parallel.", "Only your forearms move. Do not lean over the weight."],
    "close-grip reverse push-down rope push-down": ["Triceps", "Hold the rope with an underhand (palms up) close grip at a high pulley, elbows at your sides.|Press down until your arms are straight.|Return slowly while your elbows stay fixed.", "Use a lighter weight than a normal push-down. The grip is harder on the wrists."],
    "lat pull-down": ["Lats, biceps", "Sit with your thighs under the pads and grip the bar wider than your shoulders.|Lean back slightly and pull the bar to your upper chest, driving your elbows down.|Return slowly until your arms are fully stretched.", "Do not swing your body or pull the bar behind your neck."],
    "chin-up": ["Lats, biceps", "Hang from the bar with an underhand, shoulder-width grip.|Pull until your chin clears the bar, leading with your chest.|Lower under control to a full hang.", "Avoid kicking or swinging. If it is too hard, use an assisted machine or a band."],
    "barbell-rows": ["Back, biceps, rear shoulders", "Hinge at your hips with a flat back and hold the bar with an overhand grip.|Pull the bar to your lower ribs, squeezing your shoulder blades together.|Lower under control without rounding your back.", "Keep your torso steady. Do not jerk the weight up."],
    "zottman curl": ["Biceps, forearms", "Stand holding dumbbells with your palms facing forward and curl them up.|At the top, rotate your palms to face down.|Lower slowly with the overhand grip, then rotate back to palms up at the bottom.", "Go light. The lowering part works your forearms hard."],
    "seated hammer curl": ["Biceps, forearms", "Sit upright with dumbbells at your sides, palms facing each other.|Curl up without twisting your wrists, elbows pinned to your sides.|Lower slowly to full extension.", "Do not swing your torso to lift the weight."],
    "seated dumbbell curl": ["Biceps", "Sit upright with dumbbells at your sides, palms facing forward.|Curl both up while keeping your elbows still.|Squeeze at the top and lower for about 2-3 seconds.", "Use full range of motion and no momentum."],
    "single arm lateral raises": ["Side shoulders", "Stand holding a dumbbell at your side. The other hand can hold a support.|Raise your arm out to the side to shoulder height with a slight bend in the elbow.|Lower slowly.", "Lead with your elbow, keep the weight light, and do not shrug."],
    "face pull": ["Rear shoulders, upper back", "Set a rope at face height, hold it with palms facing in, and step back.|Pull toward your face, splitting the rope and driving your elbows high.|Squeeze your shoulder blades together and return slowly.", "Use light weight and keep your ribs down."],
    "dumbbell overhead press": ["Shoulders, triceps", "Sit or stand with dumbbells at shoulder height, palms facing forward.|Press straight up until your arms are almost locked out.|Lower under control to ear level.", "Brace your core and do not arch your lower back."],
    "reverse barbell curl": ["Forearms, biceps", "Hold a barbell with an overhand, shoulder-width grip.|Curl up while keeping your elbows at your sides and wrists straight.|Lower slowly.", "Use a lighter bar than you would for regular curls."],
    "cross body hammer curl": ["Biceps, forearms", "Stand with dumbbells at your sides, palms facing in.|Curl one dumbbell across your body toward the opposite shoulder.|Lower slowly and alternate arms.", "Keep your upper arm still."],
    "stiff-legged deadlift": ["Hamstrings, glutes, lower back", "Stand holding a barbell at your thighs with a slight bend in your knees.|Push your hips back and slide the bar down your legs with a flat back.|Stop at a hamstring stretch, then drive your hips forward to stand.", "Keep the bar close to your legs and do not round your back."],
    "barbell squat": ["Quads, glutes", "Set the bar on your upper back with your feet shoulder-width apart, toes slightly out.|Brace your core and sit down and back until your thighs are about parallel.|Drive through your whole foot to stand.", "Keep your knees in line with your toes and your chest up. Use safety bars."],
    "crunch": ["Abs", "Lie on your back with your knees bent and hands by your temples.|Lift your shoulder blades off the floor by curling your ribs toward your hips.|Lower slowly without pulling on your neck.", "Short, controlled reps work best."],
    "leg raises": ["Lower abs, hip flexors", "Lie on your back with your legs straight and hands under your hips.|Raise your legs to vertical while keeping your lower back pressed down.|Lower slowly and stop before your back arches.", "Bend your knees slightly if your lower back lifts."],
    "pendley rows": ["Back, biceps", "Bend over with a flat back, torso nearly parallel to the floor, bar on the floor.|Pull the bar quickly to your lower chest.|Return it to the floor and reset for each rep.", "Keep your back flat and your torso still."],
    "pull-up": ["Lats, biceps", "Hang from the bar with an overhand grip slightly wider than your shoulders.|Pull until your chin clears the bar, driving your elbows down.|Lower to a full hang.", "No swinging. Use an assisted machine or band if needed."],
    "deadlift": ["Hamstrings, glutes, back", "Stand with the bar over mid-foot, hinge down and grip just outside your legs.|Brace, keep your back flat, and push the floor away to stand tall.|Lower the bar by pushing your hips back first, then bending your knees.", "Keep the bar against your legs the whole way."],
    "up-right rows": ["Shoulders, upper traps", "Hold a bar or dumbbells in front of your thighs, hands about shoulder-width apart.|Pull up along your body to chest height with your elbows leading.|Lower slowly.", "Keep your elbows at or below shoulder height if your shoulders feel pinched."],
    "decline push up": ["Upper chest, shoulders, triceps", "Place your feet on a bench and your hands on the floor under your shoulders.|Lower your chest toward the floor with your body in a straight line.|Push back up.", "Do not let your hips sag."],
    "incline push up": ["Lower chest, triceps", "Place your hands on a bench or box with your body in a straight line.|Lower your chest toward the edge.|Push back up.", "Use a lower surface to make it harder."]
  };

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const VIDEOS = {
    "incline barbell bench press": "",
    "flat barbell bench press": "",
    "close-grip dumbbell press": "",
    "rope push-down": "",
    "close-grip reverse push-down rope push-down": "",
    "lat pull-down": "",
    "chin-up": "",
    "barbell-rows": "",
    "zottman curl": "",
    "seated hammer curl": "",
    "seated dumbbell curl": "",
    "single arm lateral raises": "",
    "face pull": "",
    "dumbbell overhead press": "",
    "reverse barbell curl": "",
    "cross body hammer curl": "",
    "stiff-legged deadlift": "",
    "barbell squat": "",
    "crunch": "",
    "leg raises": "",
    "pendley rows": "",
    "pull-up": "",
    "deadlift": "",
    "up-right rows": "",
    "decline push up": "",
    "incline push up": ""
  };

  function getYouTubeId(value) {
    if (!value) return null;
    if (/^[\w-]{11}$/.test(value)) return value;
    const m = value.match(
      /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/
    );
    return m ? m[1] : null;
  }

  let videoModal = null;
  let videoFrame = null;
  let videoTitle = null;
  let lastTrigger = null;

  function closeVideo() {
    if (!videoModal || videoModal.hidden) return;
    videoModal.hidden = true;
    videoFrame.replaceChildren(); 
    document.body.classList.remove("video-open");
    if (lastTrigger) lastTrigger.focus();
  }

  function ensureVideoModal() {
    if (videoModal) return;

    videoModal = make("div", "video-modal");
    videoModal.hidden = true;

    const box = make("div", "video-modal__box");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "Exercise demo video");

    videoTitle = make("p", "video-modal__title");
    const close = make("button", "video-modal__close", "\u00d7");
    close.type = "button";
    close.setAttribute("aria-label", "Close video");
    close.addEventListener("click", closeVideo);

    videoFrame = make("div", "video-modal__frame");

    box.append(close, videoTitle, videoFrame);
    videoModal.appendChild(box);
    document.body.appendChild(videoModal);

    videoModal.addEventListener("click", event => {
      if (event.target === videoModal) closeVideo();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") closeVideo();
    });
  }

  function openVideo(name, id, trigger) {
    ensureVideoModal();
    lastTrigger = trigger;
    videoTitle.textContent = name;
    videoFrame.replaceChildren();

    if (id) {
      const frame = make("iframe");
      frame.src =
        `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
      frame.title = `${name} demo video`;
      frame.allow = "autoplay; encrypted-media; picture-in-picture";
      frame.allowFullscreen = true;
      videoFrame.appendChild(frame);
    } else {

      const note = make("div", "video-modal__note");
      note.appendChild(make("p", "", "No video has been added for this exercise yet."));
      const link = make("a", "", "Search YouTube for it");
      link.href =
        "https://www.youtube.com/results?search_query=" +
        encodeURIComponent(`${name} proper form`);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      note.appendChild(link);
      videoFrame.appendChild(note);
    }

    videoModal.hidden = false;
    document.body.classList.add("video-open");
    videoModal.querySelector(".video-modal__close").focus();
  }

  const GROUP_MUSCLES = {
    Abs: "Abs, core",
    Arms: "Biceps, triceps, forearms",
    Back: "Lats, upper back, biceps",
    Chest: "Chest, shoulders, triceps",
    Legs: "Quads, hamstrings, glutes, calves",
    Shoulders: "Shoulders, upper back"
  };

  const GROUP_STEPS = {
    Abs: [
      "Set up on the floor, a bench or a bar with your core braced.|Move slowly through the full range, breathing out as you tighten your abs.|Lower under control without pulling on your neck or arching your back.",
      "General form: slow, controlled reps beat fast ones. Stop if your lower back hurts."
    ],
    Arms: [
      "Choose a weight you can control and keep your elbows close to your sides.|Curl or press through the full range of motion without swinging.|Lower slowly until your arms are fully extended.",
      "General form: keep your upper arms still and avoid using momentum."
    ],
    Back: [
      "Set up with your chest up and your back flat, gripping the handle or bar firmly.|Pull by driving your elbows back and squeezing your shoulder blades together.|Return slowly to a full stretch without rounding your back.",
      "General form: lead with your elbows and keep your torso steady."
    ],
    Chest: [
      "Set your shoulders back and down and plant your feet or hands firmly.|Lower the weight under control to your chest with your elbows slightly tucked.|Press back up to straight arms without bouncing.",
      "General form: use a spotter or safety bars for heavy presses."
    ],
    Legs: [
      "Stand or sit with your feet planted and your core braced.|Lower or move under control through a comfortable full range, keeping your knees in line with your toes.|Drive through your whole foot to return to the start.",
      "General form: keep your chest up and your back flat, and start lighter while you learn the movement."
    ],
    Shoulders: [
      "Stand or sit tall with your core braced and the weight in a controlled start position.|Raise or press the weight with a slight bend in your elbows, without shrugging.|Lower slowly back to the start.",
      "General form: keep the weight light enough to move without swinging."
    ]
  };

  function fallbackGuide(name) {
    const group = (window.MJM_GROUPS || {})[name];
    if (group && GROUP_STEPS[group]) {
      return [GROUP_MUSCLES[group], GROUP_STEPS[group][0], GROUP_STEPS[group][1]];
    }
    return [
      "Your custom exercise",
      "Set up with a weight you can control.|Move through a full range of motion with good form.|Lower slowly and rest as planned.",
      "Use the video button to search YouTube for form tips on this exercise."
    ];
  }

  const BODY_PARTS = [
    { view: 0, groups: ["Shoulders"], shape: "circle", a: [22, 42, 9] },
    { view: 0, groups: ["Shoulders"], shape: "circle", a: [78, 42, 9] },
    { view: 0, groups: ["Chest"], shape: "ellipse", a: [39, 54, 12, 9] },
    { view: 0, groups: ["Chest"], shape: "ellipse", a: [61, 54, 12, 9] },
    { view: 0, groups: ["Abs"], shape: "rect", a: [41, 68, 18, 32, 5] },
    { view: 0, groups: ["Arms"], shape: "rect", a: [12, 50, 13, 28, 6] },
    { view: 0, groups: ["Arms"], shape: "rect", a: [75, 50, 13, 28, 6] },
    { view: 0, groups: ["Arms"], shape: "rect", a: [10, 80, 12, 40, 6] },
    { view: 0, groups: ["Arms"], shape: "rect", a: [78, 80, 12, 40, 6] },
    { view: 0, groups: ["Legs"], shape: "rect", a: [30, 104, 19, 46, 8] },
    { view: 0, groups: ["Legs"], shape: "rect", a: [51, 104, 19, 46, 8] },
    { view: 0, groups: ["Legs"], shape: "rect", a: [31, 152, 16, 36, 7] },
    { view: 0, groups: ["Legs"], shape: "rect", a: [53, 152, 16, 36, 7] },
    { view: 1, groups: ["Shoulders"], shape: "circle", a: [22, 42, 9] },
    { view: 1, groups: ["Shoulders"], shape: "circle", a: [78, 42, 9] },
    { view: 1, groups: ["Back"], shape: "path", a: "M32 40 Q50 35 68 40 L65 90 Q50 96 35 90 Z" },
    { view: 1, groups: ["Arms"], shape: "rect", a: [12, 50, 13, 28, 6] },
    { view: 1, groups: ["Arms"], shape: "rect", a: [75, 50, 13, 28, 6] },
    { view: 1, groups: ["Arms"], shape: "rect", a: [10, 80, 12, 40, 6] },
    { view: 1, groups: ["Arms"], shape: "rect", a: [78, 80, 12, 40, 6] },
    { view: 1, groups: ["Legs"], shape: "rect", a: [30, 104, 19, 46, 8] },
    { view: 1, groups: ["Legs"], shape: "rect", a: [51, 104, 19, 46, 8] },
    { view: 1, groups: ["Legs"], shape: "rect", a: [31, 152, 16, 36, 7] },
    { view: 1, groups: ["Legs"], shape: "rect", a: [53, 152, 16, 36, 7] }
  ];

  const BODY_OUTLINE = [
    { shape: "circle", a: [50, 14, 11] },
    { shape: "rect", a: [45, 24, 10, 10, 3] },
    { shape: "path", a: "M26 36 Q50 30 74 36 L68 100 Q50 106 32 100 Z" },
    { shape: "rect", a: [12, 36, 13, 42, 6] },
    { shape: "rect", a: [75, 36, 13, 42, 6] },
    { shape: "rect", a: [10, 80, 12, 40, 6] },
    { shape: "rect", a: [78, 80, 12, 40, 6] },
    { shape: "rect", a: [30, 104, 19, 46, 8] },
    { shape: "rect", a: [51, 104, 19, 46, 8] },
    { shape: "rect", a: [31, 152, 16, 36, 7] },
    { shape: "rect", a: [53, 152, 16, 36, 7] }
  ];

  function shapeMarkup(part, className) {
    const a = part.a;
    if (part.shape === "circle") return `<circle class="${className}" cx="${a[0]}" cy="${a[1]}" r="${a[2]}"/>`;
    if (part.shape === "ellipse") return `<ellipse class="${className}" cx="${a[0]}" cy="${a[1]}" rx="${a[2]}" ry="${a[3]}"/>`;
    if (part.shape === "rect") return `<rect class="${className}" x="${a[0]}" y="${a[1]}" width="${a[2]}" height="${a[3]}" rx="${a[4]}"/>`;
    return `<path class="${className}" d="${a}"/>`;
  }

  function buildMuscleMap(group) {
    const wrapper = make("div", "howto-musclemap");
    let markup = "";

    [0, 1].forEach(view => {
      markup += `<g transform="translate(${view ? 125 : 5} 4)">`;
      BODY_OUTLINE.forEach(part => { markup += shapeMarkup(part, "mm-base"); });
      BODY_PARTS.filter(part => part.view === view && part.groups.includes(group))
        .forEach(part => { markup += shapeMarkup(part, "mm-on"); });
      markup += `<text class="mm-label" x="50" y="202" text-anchor="middle">${view ? "Back" : "Front"}</text></g>`;
    });

    wrapper.innerHTML =
      `<svg viewBox="0 0 230 210" role="img" aria-label="Body map highlighting the ${group.toLowerCase()} muscles">${markup}</svg>`;
    return wrapper;
  }

  const IMAGE_TYPES = ["avif", "gif", "webp", "jpg", "png"];

  function buildImage(name) {
    const slug = name.replace(/[^a-z0-9]+/g, "-");
    const figure = make("figure", "howto-figure");
    const img = make("img", "howto-image");
    img.alt = `${name} demonstration`;
    img.loading = "lazy";

    let attempt = 0;
    img.addEventListener("error", () => {
      attempt++;
      if (attempt < IMAGE_TYPES.length) {
        img.src = `images/${slug}.${IMAGE_TYPES[attempt]}`;
      } else {
        img.remove();
        figure.classList.add("is-missing");
        const group = (window.MJM_GROUPS || {})[name];
        if (group) figure.appendChild(buildMuscleMap(group));
        figure.appendChild(
          make("span", "", `Add your own picture as images/${slug}.avif (or .gif, .webp, .jpg, .png)`)
        );
      }
    });
    img.src = `images/${slug}.${IMAGE_TYPES[0]}`;

    figure.appendChild(img);
    return figure;
  }

  function buildPanel(name, guide, id) {
    const panel = make("div", "howto-panel");
    panel.id = id;
    panel.hidden = true;

    panel.appendChild(make("p", "howto-muscles", `Works: ${guide[0]}`));
    panel.appendChild(buildImage(name));

    const steps = make("ol", "howto-steps");
    guide[1].split("|").forEach(text => steps.appendChild(make("li", "", text)));
    panel.appendChild(steps);

    panel.appendChild(make("p", "howto-tip", `Tip: ${guide[2]}`));

    const video = make("button", "howto-video", "\u25b6 Play video demo");
    video.type = "button";
    video.addEventListener("click", () =>
      openVideo(name, getYouTubeId(VIDEOS[name]), video)
    );
    panel.appendChild(video);

    return panel;
  }

  document.querySelectorAll(".exercise-list li").forEach((item, number) => {
    const content = item.querySelector(".exercise-content");
    if (!content) return;

    const label = content.textContent.trim().replace(/\s+/g, " ").split(" - ")[0];
    const name = label.toLowerCase().replace("dumbell", "dumbbell");
    const guide = GUIDES[name] || fallbackGuide(name);

    const panelId = `howto-${number}`;
    const button = make("button", "howto-btn", "How to");
    button.type = "button";
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", panelId);
    button.setAttribute("aria-label", `How to do ${label}`);

    const panel = buildPanel(name, guide, panelId);

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    function finishClose() {
      panel.hidden = true;
      panel.classList.remove("is-closing");
    }

    panel.addEventListener("animationend", event => {
      if (event.target === panel && panel.classList.contains("is-closing")) {
        finishClose();
      }
    });

    button.addEventListener("click", () => {

      const open = panel.hidden || panel.classList.contains("is-closing");

      button.setAttribute("aria-expanded", String(open));
      button.classList.toggle("is-open", open);

      if (open) {
        panel.classList.remove("is-closing");
        panel.hidden = false; 
      } else if (reduceMotion.matches) {
        finishClose();
      } else {
        panel.classList.add("is-closing"); 
      }
    });

    item.appendChild(button);
    item.appendChild(panel);
  });
})();

(() => {
  "use strict";

  const SELECTOR =
    ".nav-links a, .btn-submit, .day-tab, .howto-btn, .howto-video, .site-footer a, .todo-filter, .todo-delete, .todo-link";
  const SOLID = ".btn-submit, .howto-video";

  function ensureFill(button) {
    let fill = button.querySelector(":scope > .fx-fill");
    if (!fill) {
      fill = document.createElement("span");
      fill.className = "fx-fill";
      fill.setAttribute("aria-hidden", "true");
      button.classList.add("fx-btn");
      if (button.matches(SOLID)) button.classList.add("fx-solid");
      button.prepend(fill);
    }
    return fill;
  }

  function place(button, x, y) {
    const fill = ensureFill(button);
    const box = button.getBoundingClientRect();
    const px = Math.min(Math.max(x - box.left, 0), box.width);
    const py = Math.min(Math.max(y - box.top, 0), box.height);
    const radius = Math.hypot(
      Math.max(px, box.width - px),
      Math.max(py, box.height - py)
    );

    fill.style.width = fill.style.height = `${radius * 2}px`;
    fill.style.left = `${px}px`;
    fill.style.top = `${py}px`;
  }

  function center(button) {
    const box = button.getBoundingClientRect();
    place(button, box.left + box.width / 2, box.top + box.height / 2);
  }

  document.addEventListener("pointerover", event => {
    const button = event.target.closest(SELECTOR);
    if (!button || button.contains(event.relatedTarget)) return;
    place(button, event.clientX, event.clientY);
    button.classList.add("fx-on");
  });

  document.addEventListener("pointerout", event => {
    const button = event.target.closest(SELECTOR);
    if (!button || button.contains(event.relatedTarget)) return;
    place(button, event.clientX, event.clientY);
    button.classList.remove("fx-on");
  });

  document.addEventListener("pointercancel", event => {
    const button = event.target.closest?.(SELECTOR);
    if (button) button.classList.remove("fx-on");
  });

  document.addEventListener("focusin", event => {
    const button = event.target.closest?.(SELECTOR);
    if (!button || !button.matches(":focus-visible")) return;
    center(button);
    button.classList.add("fx-on");
  });
  document.addEventListener("focusout", event => {
    const button = event.target.closest?.(SELECTOR);
    if (!button) return;
    center(button);
    button.classList.remove("fx-on");
  });
})();

(() => {
  "use strict";

  if (!document.getElementById("todo-list")) return;

  const STORAGE_KEY = "mjm-daily-tasks";

  const form = document.getElementById("todo-form");
  const input = document.getElementById("todo-input");
  const message = document.getElementById("todo-message");
  const filtersBox = document.getElementById("todo-filters");
  const countEl = document.getElementById("todo-count");
  const listEl = document.getElementById("todo-list");
  const emptyEl = document.getElementById("todo-empty");

  const quoteBox = document.getElementById("todo-quote");
  const quoteText = document.getElementById("todo-quote-text");
  const quoteAuthor = document.getElementById("todo-quote-author");
  const newQuoteBtn = document.getElementById("todo-new-quote");

  let tasks = loadTasks();
  let filter = "all";
  let justAddedId = null;

  function loadTasks() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!Array.isArray(saved)) return [];

      return saved
        .filter(item => item && typeof item.text === "string" && item.text.trim())
        .map(item => ({
          id: String(item.id ?? makeId()),
          text: item.text.trim(),
          done: Boolean(item.done)
        }));
    } catch (error) {
      return [];
    }
  }

  function saveTasks() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (error) {
      showMessage("Your browser is blocking saving. Tasks will be lost when you close this page.");
    }
  }

  function makeId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function normalize(text) {
    return text.trim().replace(/\s+/g, " ").toLowerCase();
  }

  function validate(text) {
    if (!text.trim()) return "Enter a task before adding it.";

    const duplicate = tasks.some(task => normalize(task.text) === normalize(text));
    if (duplicate) return "That task is already on your list.";

    return "";
  }

  function showMessage(text) {
    message.textContent = text;
    input.classList.toggle("is-invalid", Boolean(text));
    if (text) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }

  function getVisibleTasks() {
    if (filter === "active") return tasks.filter(task => !task.done);
    if (filter === "completed") return tasks.filter(task => task.done);
    return tasks;
  }

  function createRow(task) {
    const row = document.createElement("li");
    row.className = "todo-item" + (task.done ? " is-done" : "");
    if (task.id === justAddedId) row.classList.add("is-new");
    row.dataset.id = task.id;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.done;
    checkbox.dataset.action = "toggle";
    checkbox.setAttribute("aria-label", `Mark "${task.text}" as completed`);

    const text = document.createElement("span");
    text.className = "todo-text";
    text.textContent = task.text;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "todo-delete";
    remove.dataset.action = "delete";
    remove.textContent = "Delete";
    remove.setAttribute("aria-label", `Delete "${task.text}"`);

    row.append(checkbox, text, remove);
    return row;
  }

  function renderEmptyState(visibleCount) {
    const messages = {
      all: "No tasks yet. Add your first one above.",
      active: "Nothing left to do. Nice work.",
      completed: "No completed tasks yet."
    };

    emptyEl.textContent = messages[filter];
    emptyEl.hidden = visibleCount > 0;
  }

  function renderCount() {
    const remaining = tasks.filter(task => !task.done).length;

    if (tasks.length === 0) countEl.textContent = "0 tasks";
    else if (remaining === 0) countEl.textContent = "All tasks done";
    else countEl.textContent = `${remaining} ${remaining === 1 ? "task" : "tasks"} left`;
  }

  function renderFilters() {
    filtersBox.querySelectorAll("[data-filter]").forEach(button => {
      const active = button.dataset.filter === filter;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function render() {
    const visible = getVisibleTasks();

    listEl.replaceChildren(...visible.map(createRow));
    justAddedId = null;

    renderEmptyState(visible.length);
    renderCount();
    renderFilters();
  }

  function addTask(text) {
    const task = { id: makeId(), text: text.trim().replace(/\s+/g, " "), done: false };
    tasks = [...tasks, task];
    justAddedId = task.id;

    if (filter === "completed") filter = "all";

    saveTasks();
    render();
  }

  function toggleTask(id) {
    tasks = tasks.map(task =>
      task.id === id ? { ...task, done: !task.done } : task
    );
    saveTasks();
    render();
  }

  function deleteTask(id, row) {
    const finish = () => {
      tasks = tasks.filter(task => task.id !== id);
      saveTasks();
      render();
    };

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!row || reduceMotion) return finish();

    row.classList.add("is-leaving");
    row.addEventListener("animationend", finish, { once: true });
  }

  form.addEventListener("submit", event => {
    event.preventDefault();

    const error = validate(input.value);
    if (error) {
      showMessage(error);
      input.focus();
      return;
    }

    showMessage("");
    addTask(input.value);
    input.value = "";
    input.focus();
  });

  input.addEventListener("input", () => showMessage(""));

  listEl.addEventListener("change", event => {
    const checkbox = event.target.closest('[data-action="toggle"]');
    if (!checkbox) return;
    toggleTask(checkbox.closest(".todo-item").dataset.id);
  });

  listEl.addEventListener("click", event => {
    const button = event.target.closest('[data-action="delete"]');
    if (!button) return;
    const row = button.closest(".todo-item");
    deleteTask(row.dataset.id, row);
  });

  filtersBox.addEventListener("click", event => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    filter = button.dataset.filter;
    render();
  });

  const QUOTE_URL = "https://dummyjson.com/quotes/random";

  const FALLBACK_QUOTES = [
    { quote: "The secret of getting ahead is getting started.", author: "Mark Twain" },
    { quote: "Well done is better than well said.", author: "Benjamin Franklin" },
    { quote: "It always seems impossible until it is done.", author: "Nelson Mandela" }
  ];

  function showQuote(quote, author, loading = false) {
    quoteBox.classList.toggle("is-loading", loading);
    quoteText.textContent = quote;
    quoteAuthor.textContent = author ? `- ${author}` : "";
  }

  async function loadQuote() {
    newQuoteBtn.disabled = true;
    showQuote("Loading today's quote...", "", true);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    try {
      const response = await fetch(QUOTE_URL, { signal: controller.signal });
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);

      const data = await response.json();
      if (!data.quote) throw new Error("Unexpected data");

      showQuote(data.quote, data.author);
    } catch (error) {
      console.warn("Could not load the quote:", error);
      const pick = FALLBACK_QUOTES[Math.floor(Math.random() * FALLBACK_QUOTES.length)];
      showQuote(pick.quote, pick.author);
    } finally {
      clearTimeout(timer);
      newQuoteBtn.disabled = false;
    }
  }

  newQuoteBtn.addEventListener("click", loadQuote);

  render();
  loadQuote();

})();

(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const header = document.querySelector(".site-header");
  const bar = document.createElement("div");
  bar.className = "scroll-progress";
  bar.setAttribute("aria-hidden", "true");
  document.body.appendChild(bar);

  let ticking = false;

  function updateScroll() {
    ticking = false;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = max > 0 ? Math.min(window.scrollY / max, 1) : 0;
    bar.style.transform = `scaleX(${ratio})`;
    if (header) header.classList.toggle("is-scrolled", window.scrollY > 12);
  }

  function requestScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(updateScroll);
  }

  window.addEventListener("scroll", requestScroll, { passive: true });
  window.addEventListener("resize", requestScroll);
  updateScroll();

  const SPOT = ".workout-card, .feature-list li, .achievement-card, .history-item, .weekly-progress, .todo-quote";
  let frame = 0;
  let pending = null;

  document.addEventListener("pointermove", event => {
    if (event.pointerType === "touch") return;
    const hit = event.target.closest(SPOT);
    if (!hit) return;

    pending = { hit, x: event.clientX, y: event.clientY };
    if (frame) return;

    frame = window.requestAnimationFrame(() => {
      frame = 0;
      const box = pending.hit.getBoundingClientRect();
      pending.hit.style.setProperty("--mx", `${pending.x - box.left}px`);
      pending.hit.style.setProperty("--my", `${pending.y - box.top}px`);
    });
  }, { passive: true });

  function replay(node, name) {
    node.classList.remove(name);
    void node.offsetWidth;
    node.classList.add(name);
  }

  function watch(id, name, skipEmpty) {
    const node = document.getElementById(id);
    if (!node) return;

    let last = node.textContent;

    new MutationObserver(() => {
      const text = node.textContent;
      if (text === last) return;
      last = text;
      if (skipEmpty && !text.trim()) return;
      replay(node, name);
    }).observe(node, { childList: true, characterData: true, subtree: true });
  }

  if (reduceMotion.matches) return;

  watch("weekly-progress-percent", "is-bump");
  watch("todo-count", "is-bump");
  watch("todo-quote-text", "is-swap", true);
  watch("todo-quote-author", "is-swap", true);
  watch("form-status", "is-swap", true);
  watch("todo-message", "is-swap", true);

  if (!("IntersectionObserver" in window)) return;

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0 });

  document.querySelectorAll(".features-section, .achievements, .history").forEach(node => {
    if (node.getBoundingClientRect().top < window.innerHeight * 0.9) return;
    node.classList.add("reveal");
    observer.observe(node);
  });
})();

(() => {
  "use strict";

  function addHead(tag, attrs) {
    const node = document.createElement(tag);
    Object.keys(attrs).forEach(key => node.setAttribute(key, attrs[key]));
    document.head.appendChild(node);
  }

  if (!document.querySelector('link[rel="manifest"]')) {
    addHead("link", { rel: "manifest", href: "manifest.webmanifest" });
    addHead("link", { rel: "apple-touch-icon", href: "apple-touch-icon.png" });
    addHead("meta", { name: "theme-color", content: "#09090b" });
    addHead("meta", { name: "mobile-web-app-capable", content: "yes" });
    addHead("meta", { name: "apple-mobile-web-app-capable", content: "yes" });
    addHead("meta", { name: "apple-mobile-web-app-title", content: "MJM Workout" });
    addHead("meta", { name: "apple-mobile-web-app-status-bar-style", content: "black" });
  }

  const secure = window.location.protocol === "https:" || window.location.hostname === "localhost";

  if ("serviceWorker" in navigator && secure) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(error => {
        console.warn("Offline mode unavailable:", error);
      });
    });
  }
})();
