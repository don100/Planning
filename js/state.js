/* =========================================================
   state.js — central store for UniPlan
   Everything lives on window.App.state. Persisted pieces
   (settings + reservations) are mirrored to localStorage so
   the tool remembers configuration across visits.
   ========================================================= */
window.App = window.App || {};

App.LS_KEYS = {
  settings: "uniplan_settings_v1",
  reservations: "uniplan_reservations_v1"
};

App.defaultSettings = function () {
  return {
    days: ["LUN", "MAR", "MER", "JEU", "VEN"],
    periodLength: 2, // hours
    periods: [
      { label: "08:00–10:00" },
      { label: "10:00–12:00" },
      { label: "13:00–15:00" },
      { label: "15:00–17:00" }
    ],
    defaultMaxHoursDay: 6,
    spreadSessions: true,
    reservationMode: "fix", // "fix" = pin sessions to reserved slots, "block" = exclude those slots
    rooms: [],
    teacherCaps: {} // teacherName -> max hours/day override
  };
};

App.state = {
  rawRows: [],        // rows straight from the sheet (for the import preview)
  assignments: [],     // normalized teaching assignments (see parser.js)
  teachers: [],        // list of {name, weeklyHours}
  semesters: [],        // list of semester codes present
  groupKeys: [],        // list of {semester, group} pairs (individual groups)
  settings: App.defaultSettings(),
  reservations: {},    // teacherName -> Set("DAY|periodIndex")
  schedule: null,       // { sessions: [...], conflicts: [...] } after generation
  resultView: { subtab: "day", selection: null },
  skippedRows: []       // rows skipped during parse: [{rowIdx, reason, semester, module, teacher, hours, group}]
};

App.saveSettings = function () {
  try {
    localStorage.setItem(App.LS_KEYS.settings, JSON.stringify(App.state.settings));
  } catch (e) { /* storage unavailable — ignore */ }
};

App.loadSettings = function () {
  try {
    const raw = localStorage.getItem(App.LS_KEYS.settings);
    if (raw) {
      const parsed = JSON.parse(raw);
      App.state.settings = Object.assign(App.defaultSettings(), parsed);
    }
  } catch (e) { /* ignore corrupt storage */ }
};

App.saveReservations = function () {
  try {
    const plain = {};
    Object.keys(App.state.reservations).forEach(t => {
      plain[t] = Array.from(App.state.reservations[t]);
    });
    localStorage.setItem(App.LS_KEYS.reservations, JSON.stringify(plain));
  } catch (e) { /* ignore */ }
};

App.loadReservations = function () {
  try {
    const raw = localStorage.getItem(App.LS_KEYS.reservations);
    if (raw) {
      const plain = JSON.parse(raw);
      const out = {};
      Object.keys(plain).forEach(t => { out[t] = new Set(plain[t]); });
      App.state.reservations = out;
    }
  } catch (e) { /* ignore */ }
};

App.isReserved = function (teacher, day, periodIdx) {
  const set = App.state.reservations[teacher];
  return !!set && set.has(day + "|" + periodIdx);
};

// "block" mode: a reserved slot is excluded for that teacher.
// "fix" mode: reserved slots are targets for the teacher's sessions
// (handled by pre-placement in the scheduler), so they are NOT excluded.
App.reservationBlocks = function (teacher, day, periodIdx) {
  if (App.state.settings.reservationMode !== "block") return false;
  return App.isReserved(teacher, day, periodIdx);
};
