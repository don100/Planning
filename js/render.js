/* =========================================================
   render.js — DOM rendering helpers for every panel except
   the reservation grid (see reservations.js).
   ========================================================= */

/* ---------- Import preview ---------- */
App.renderImportSummary = function () {
  const box = document.getElementById("importSummary");
  const table = document.getElementById("importTable");
  const a = App.state.assignments;
  const skipped = App.state.skippedRows || [];
  if (!a.length && !skipped.length) { box.hidden = true; return; }

  document.getElementById("statCourses").textContent = App.state.rawRows.length;
  document.getElementById("statTeachers").textContent = App.state.teachers.length;

  const rowsHtml = a.slice(0, 30).map(r => `
    <tr>
      <td>${escapeHtml(r.semester)}</td>
      <td>${escapeHtml(r.module)}</td>
      <td>${escapeHtml(r.teacher)}</td>
      <td>${escapeHtml(r.weeklyHours)} h</td>
      <td>${escapeHtml(r.groupLabel)}</td>
      <td class="muted">${escapeHtml(r.coordinator) || "—"}</td>
    </tr>`).join("");

  // Skipped rows highlighted in red
  const skippedHtml = skipped.slice(0, 30).map(r => `
    <tr class="row-error">
      <td>${escapeHtml(r.semester)}</td>
      <td>${escapeHtml(r.module)}</td>
      <td>${escapeHtml(r.teacher)}</td>
      <td>${escapeHtml(r.hours)}</td>
      <td>${escapeHtml(r.group)}</td>
      <td class="error-reason">Ligne ${escapeHtml(r.rowIdx)}: ${escapeHtml(r.reason)}</td>
    </tr>`).join("");

  const semesters = App.state.semesters.map(escapeHtml).join(", ");
  const groups = App.state.groupKeys.map(g => escapeHtml(g.semester + "/" + g.group)).join(", ");
  let summary = `<p class="muted"><strong>${a.length}</strong> affectations · ` +
    `<strong>${App.state.teachers.length}</strong> enseignants · ` +
    `Semestres: ${semesters || "—"} · ` +
    `Groupes: ${groups || "—"}</p>`;
  if (skipped.length) {
    summary += `<p style="color:var(--red);font-weight:600;font-size:13px;">` +
      `${skipped.length} ligne(s) ignorée(s) — colonnes manquantes ou format non reconnu (voir en bas du tableau en rouge).</p>`;
  }

  table.innerHTML = `
    <thead><tr><th>Semestre</th><th>Module</th><th>Enseignant</th><th>H/sem.</th><th>Groupes</th><th>Coordonnateur</th></tr></thead>
    <tbody>${rowsHtml}${skippedHtml}</tbody>`;
  box.innerHTML = `<h3>Aperçu de l'import</h3>${summary}`;
  box.appendChild(table);
  box.hidden = false;

  const total = a.length + skipped.length;
  if (total > 30) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = `… et ${total - 30} lignes supplémentaires (${a.length} valides, ${skipped.length} ignorées au total).`;
    box.appendChild(note);
  }
};

/* ---------- Settings: days toggle ---------- */
const ALL_DAYS = ["LUN", "MAR", "MER", "JEU", "VEN", "SAM"];

App.renderDaysToggle = function () {
  const wrap = document.getElementById("daysToggle");
  wrap.innerHTML = "";
  ALL_DAYS.forEach(d => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip-toggle" + (App.state.settings.days.includes(d) ? " on" : "");
    chip.textContent = d;
    chip.addEventListener("click", () => {
      const days = App.state.settings.days;
      const i = days.indexOf(d);
      if (i >= 0) { if (days.length > 1) days.splice(i, 1); }
      else days.push(d);
      days.sort((x, y) => ALL_DAYS.indexOf(x) - ALL_DAYS.indexOf(y));
      App.renderDaysToggle();
    });
    wrap.appendChild(chip);
  });
};

/* ---------- Settings: periods list ---------- */
App.renderPeriodsList = function () {
  const wrap = document.getElementById("periodsList");
  wrap.innerHTML = "";
  App.state.settings.periods.forEach((p, idx) => {
    const row = document.createElement("div");
    row.className = "period-row";
    row.innerHTML = `<input type="text" value="${escapeHtml(p.label)}" data-idx="${idx}"><button type="button" class="rm" title="Supprimer">✕</button>`;
    row.querySelector("input").addEventListener("input", e => { p.label = e.target.value; });
    row.querySelector(".rm").addEventListener("click", () => {
      App.state.settings.periods.splice(idx, 1);
      App.renderPeriodsList();
    });
    wrap.appendChild(row);
  });
};

/* ---------- Settings: teacher caps table ---------- */
App.renderTeacherCapsTable = function () {
  const tbody = document.querySelector("#teacherCapsTable tbody");
  tbody.innerHTML = "";
  App.state.teachers.forEach(t => {
    const tr = document.createElement("tr");
    const current = App.state.settings.teacherCaps[t.name] || "";
    tr.innerHTML = `
      <td>${escapeHtml(t.name)}</td>
      <td class="muted">${escapeHtml(t.weeklyHours)} h</td>
      <td>
        <select class="input-sm">
          <option value="">Défaut (${App.state.settings.defaultMaxHoursDay} h)</option>
          <option value="4" ${current == 4 ? "selected" : ""}>4 heures</option>
          <option value="6" ${current == 6 ? "selected" : ""}>6 heures</option>
          <option value="8" ${current == 8 ? "selected" : ""}>8 heures</option>
        </select>
      </td>`;
    tr.querySelector("select").addEventListener("change", e => {
      const v = e.target.value;
      if (v) App.state.settings.teacherCaps[t.name] = parseFloat(v);
      else delete App.state.settings.teacherCaps[t.name];
    });
    tbody.appendChild(tr);
  });
};

/* ---------- Results: selector population ---------- */
const RESULT_ALL_TEACHERS = "__all_teachers__";
const RESULT_ALL_GROUPS = "__all_groups__";

App.populateResultSelector = function () {
  const sel = document.getElementById("resultSelector");
  const sub = App.state.resultView.subtab;
  const prev = App.state.resultView.selection;
  sel.innerHTML = "";

  const add = (value, label) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    sel.appendChild(opt);
  };

  if (sub === "day") {
    App.state.settings.days.forEach(d => add(d, d));
  } else if (sub === "group") {
    add(RESULT_ALL_GROUPS, "Tous les groupes (une page)");
    App.state.groupKeys.forEach(g => add(g.semester + "|" + g.group, g.semester + " — Groupe " + g.group));
  } else if (sub === "teacher") {
    add(RESULT_ALL_TEACHERS, "Tous les enseignants (une page)");
    App.state.teachers.forEach(t => add(t.name, t.name));
  }

  const values = Array.from(sel.options).map(o => o.value);
  // keep the previous selection when it still makes sense for this subtab
  sel.value = values.includes(prev) ? prev : (values[0] || "");
  App.state.resultView.selection = sel.value;
  App.renderResultView();
};

/* ---------- Results: grid renderer ---------- */
App.renderResultView = function () {
  const wrap = document.getElementById("resultView");
  const schedule = App.state.schedule;
  const settings = App.state.settings;
  const sub = App.state.resultView.subtab;
  const sel = App.state.resultView.selection;

  if (!schedule) { wrap.innerHTML = "<p class='muted'>Générez d'abord l'emploi du temps (onglet 4).</p>"; return; }
  if (!sel) { wrap.innerHTML = "<p class='muted'>Rien à afficher.</p>"; return; }

  const sessions = schedule.sessions;
  const slotIndex = indexBySlot(sessions);

  // "view all" modes: every teacher / every group, each with its own table,
  // stacked on a single page.
  if (sub === "teacher" && sel === RESULT_ALL_TEACHERS) {
    renderStackedViews(wrap, "teacher", sessions, slotIndex, settings);
    return;
  }
  if (sub === "group" && sel === RESULT_ALL_GROUPS) {
    renderStackedViews(wrap, "group", sessions, slotIndex, settings);
    return;
  }

  let rowLabel, rowItems, match;
  if (sub === "day") {
    const daySessions = sessions.filter(s => s.day === sel);
    const rooms = Array.from(new Set(daySessions.map(s => s.room))).sort();
    rowLabel = "Salle";
    rowItems = rooms.length ? rooms : ["—"];
    match = (room, pIdx) => daySessions.filter(s => s.room === room && s.periodIdx === pIdx);
  } else if (sub === "group") {
    const [sem, grp] = sel.split("|");
    rowLabel = "Jour";
    rowItems = settings.days;
    match = (day, pIdx) => (slotIndex[day + "|" + pIdx] || []).filter(s => s.semester === sem && s.groups.includes(grp));
  } else {
    rowLabel = "Jour";
    rowItems = settings.days;
    match = (day, pIdx) => (slotIndex[day + "|" + pIdx] || []).filter(s => s.teacher === sel);
  }

  wrap.innerHTML = "";
  wrap.appendChild(buildScheduleTable(rowLabel, rowItems, settings.periods, match));
};

// sessions indexed by "day|periodIdx" for O(1) cell lookups
function indexBySlot(sessions) {
  const idx = {};
  sessions.forEach(s => {
    const k = s.day + "|" + s.periodIdx;
    (idx[k] = idx[k] || []).push(s);
  });
  return idx;
}

function buildScheduleTable(rowLabel, rowItems, periods, matchFn) {
  const table = document.createElement("table");
  table.className = "schedule-grid";
  const thead = document.createElement("thead");
  thead.innerHTML = "<tr><th class='corner'>" + escapeHtml(rowLabel) + "</th>" +
    periods.map(p => "<th>" + escapeHtml(p.label) + "</th>").join("") + "</tr>";
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  rowItems.forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = "<th>" + escapeHtml(row) + "</th>";
    periods.forEach((p, pIdx) => {
      const td = document.createElement("td");
      td.className = "slot";
      td.innerHTML = matchFn(row, pIdx).map(sessionChipHtml).join("");
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function renderStackedViews(wrap, kind, sessions, slotIndex, settings) {
  const stack = document.createElement("div");
  stack.className = "schedule-stack";

  let entities, title, filter;
  if (kind === "teacher") {
    entities = App.state.teachers;
    title = t => "Enseignant — " + t.name;
    filter = (s, t) => s.teacher === t.name;
  } else {
    entities = App.state.groupKeys;
    title = g => g.semester + " — Groupe " + g.group;
    filter = (s, g) => s.semester === g.semester && s.groups.includes(g.group);
  }

  entities.forEach(e => {
    const block = document.createElement("section");
    block.className = "schedule-stack__block";
    const h = document.createElement("h3");
    h.textContent = title(e);
    block.appendChild(h);
    const match = (day, pIdx) => (slotIndex[day + "|" + pIdx] || []).filter(s => filter(s, e));
    block.appendChild(buildScheduleTable("Jour", settings.days, settings.periods, match));
    stack.appendChild(block);
  });

  wrap.innerHTML = "";
  wrap.appendChild(stack);
}

function sessionChipHtml(s) {
  return `<div class="session-chip">
    <span class="m">${escapeHtml(s.module)}</span>
    <span class="t">${escapeHtml(s.teacher)}${s.room ? " · " + escapeHtml(s.room) : ""}</span>
    <span class="g">${escapeHtml(s.semester)} · ${escapeHtml(s.groupLabel)}</span>
  </div>`;
}

function escapeHtml(str) {
  return (str || "").toString().replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- header stats + conflicts box ---------- */
App.renderHeaderStats = function () {
  document.getElementById("statCourses").textContent = App.state.rawRows.length || "—";
  document.getElementById("statTeachers").textContent = App.state.teachers.length || "—";
  const s = App.state.schedule;
  document.getElementById("statSessions").textContent = s ? s.sessions.length : "—";
  document.getElementById("statConflicts").textContent = s ? s.conflicts.length : "—";
};

App.renderConflicts = function () {
  const box = document.getElementById("conflictsBox");
  const s = App.state.schedule;
  if (!s || !s.conflicts.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<p><strong>${s.conflicts.length}</strong> séance(s) n'ont pas pu être placées avec les contraintes actuelles. Essayez d'augmenter le nombre d'essais, d'assouplir un plafond quotidien, d'ajouter des salles, ou de revoir les réservations concernées :</p>
  <ul>${s.conflicts.map(c => `<li>${escapeHtml(c.module)} — ${escapeHtml(c.teacher)} — ${escapeHtml(c.semester)} (${escapeHtml(c.groupLabel)}) — séance ${c.partIndex}/${c.partTotal}</li>`).join("")}</ul>`;
};
