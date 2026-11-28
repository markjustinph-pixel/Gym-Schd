(() => {
  "use strict";

  const planSummary = document.getElementById("dashboard-plan-summary");
  if (!planSummary) return;

  const progressSummary = document.getElementById("dashboard-progress-summary");
  const tasksSummary = document.getElementById("dashboard-tasks-summary");
  const macroSummary = document.getElementById("dashboard-macro-summary");
  const dateLabel = document.getElementById("dashboard-date");
  const weekList = document.getElementById("dashboard-week");
  const todayTitle = document.getElementById("dashboard-today-title");
  const todayDetail = document.getElementById("dashboard-today-detail");

  let latestState = null;

  function currentWeekId() {
    const monday = new Date();
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return [
      monday.getFullYear(),
      String(monday.getMonth() + 1).padStart(2, "0"),
      String(monday.getDate()).padStart(2, "0")
    ].join("-");
  }

  function getDayPlan(workoutPlan, weekday) {
    return workoutPlan && typeof workoutPlan === "object" ? workoutPlan[weekday] : null;
  }

  function hasWorkout(dayPlan) {
    return Boolean(dayPlan && dayPlan.on && Array.isArray(dayPlan.exercises) && dayPlan.exercises.length);
  }

  function renderCalendar(workoutPlan, activeDays) {
    const today = new Date();
    const dateOptions = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
    dateLabel.textContent = today.toLocaleDateString(undefined, dateOptions);

    const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    weekList.replaceChildren();

    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + offset);
      const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
      const scheduled = hasWorkout(getDayPlan(workoutPlan, weekday));
      const isToday = date.toDateString() === today.toDateString();
      const dayItem = document.createElement("div");
      dayItem.className = `dashboard-week__day${scheduled ? " has-workout" : ""}${isToday ? " is-today" : ""}`;
      dayItem.setAttribute("role", "listitem");
      dayItem.setAttribute(
        "aria-label",
        `${weekday}, ${date.toLocaleDateString(undefined, { month: "long", day: "numeric" })}: ${scheduled ? "Workout scheduled" : "Rest day"}`
      );
      if (isToday) dayItem.setAttribute("aria-current", "date");

      const weekdayLabel = document.createElement("span");
      weekdayLabel.className = "dashboard-week__weekday";
      weekdayLabel.textContent = date.toLocaleDateString(undefined, { weekday: "short" });

      const dateNumber = document.createElement("span");
      dateNumber.className = "dashboard-week__date";
      dateNumber.textContent = String(date.getDate());

      const workoutLabel = document.createElement("span");
      workoutLabel.className = "dashboard-week__status";
      workoutLabel.textContent = scheduled ? "Workout" : "Rest";

      dayItem.append(weekdayLabel, dateNumber, workoutLabel);
      weekList.append(dayItem);
    }

    const todayWeekday = today.toLocaleDateString("en-US", { weekday: "long" });
    const todayPlan = getDayPlan(workoutPlan, todayWeekday);
    if (hasWorkout(todayPlan)) {
      todayTitle.textContent = todayPlan.title
        ? `${todayPlan.title} is scheduled today`
        : "Your workout is scheduled today";
      const time = todayPlan.time ? ` · ${todayPlan.time}` : "";
      todayDetail.textContent = `${todayPlan.exercises.length} exercise${todayPlan.exercises.length === 1 ? "" : "s"}${time}.`;
    } else if (activeDays) {
      todayTitle.textContent = "Rest day";
      todayDetail.textContent = "No workout is scheduled for today. Enjoy your recovery.";
    } else {
      todayTitle.textContent = "No workout plan yet";
      todayDetail.textContent = "Add workouts to your schedule to see them here.";
    }
  }

  function renderDashboard(state) {
    latestState = state;
    const workoutPlan = state.settings && state.settings.workout_plan;
    const activeDays = workoutPlan && typeof workoutPlan === "object"
      ? Object.values(workoutPlan).filter(day => day && day.on && Array.isArray(day.exercises) && day.exercises.length).length
      : 0;
    renderCalendar(workoutPlan, activeDays);
    planSummary.textContent = activeDays
      ? `${activeDays} active workout ${activeDays === 1 ? "day" : "days"} in your saved plan.`
      : "No workout plan yet. Create one when you're ready.";

    const progress = state.appData?.workout_progress?.[currentWeekId()] || {};
    const completed = progress && typeof progress === "object"
      ? Object.values(progress).filter(Boolean).length
      : 0;
    progressSummary.textContent = `${completed} exercise${completed === 1 ? "" : "s"} checked this week`;

    const tasks = state.appData?.daily_tasks || [];
    const openTasks = Array.isArray(tasks) ? tasks.filter(task => task && !task.done).length : 0;
    tasksSummary.textContent = `${openTasks} task${openTasks === 1 ? "" : "s"} left on your account`;

    const macroGoal = state.settings && state.settings.macro_goal;
    if (macroGoal && macroGoal.targets && Number.isFinite(macroGoal.targets.calories)) {
      macroSummary.textContent = `${macroGoal.targets.calories} calorie daily target`;
    } else {
      macroSummary.textContent = "Set personal daily nutrition targets.";
    }
  }

  if (window.MJM_AUTH_READY) {
    window.MJM_AUTH_READY.then(state => {
      if (state.user && state.settings) renderDashboard(state);
    });
  }

  window.addEventListener("mjm:auth-state", event => {
    const state = event.detail;
    if (state.user && state.settings) renderDashboard(state);
  });

  window.addEventListener("mjm:account-data", () => {
    if (latestState) renderDashboard(latestState);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && latestState) renderDashboard(latestState);
  });
})();
