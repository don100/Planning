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
      <td>${r.semester}</td>
      <td>${r.module}</td>
      <td>${r.teacher}</td>
      <td>${r.weeklyHours} h</td>
      <td>${r.groupLabel}</td>
      <td class="muted">${r.coordinator || "—"}</td>
    </tr>`).join("");

  // Skipped rows highlighted in red
  const skippedHtml = skipped.slice(0, 30).map(r => `
    <tr class="row-error">
      <td>${r.semester}</td>
      <td>${r.module}</td>
      <td>${r.teacher}</td>
      <td>${r.hours}</td>
      <td>${r.group}</td>
      <td class="error-reason">Ligne ${r.rowIdx}: ${r.reason}</td>
    </tr>`).join("");

  const semesters = App.state.semesters.join(", ");
  const groups = App.state.groupKeys.map(g => g.semester + "/" + g.group).join(", ");
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
    row.innerHTML = `<input type="text" value="${p.label}" data-idx="${idx}"><button type="button" class="rm" title="Supprimer">✕</button>`;
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
      <td>${t.name}</td>
      <td class="muted">${t.weeklyHours} h</td>
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
App.populateResultSelector = function () {
  const sel = document.getElementById("resultSelector");
  const sub = App.state.resultView.subtab;
  sel.innerHTML = "";

  let options = [];
  if (sub === "day") options = App.state.settings.days.map(d => ({ value: d, label: d }));
  if (sub === "group") options = App.state.groupKeys.map(g => ({ value: g.semester + "|" + g.group, label: g.semester + " — Groupe " + g.group }));
  if (sub === "teacher") options = App.state.teachers.map(t => ({ value: t.name, label: t.name }));

  options.forEach(o => {
    const opt = document.createElement("option");
    opt.value = o.value; opt.textContent = o.label;
    sel.appendChild(opt);
  });

  App.state.resultView.selection = options.length ? options[0].value : null;
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

  let sessionsFilter, rowMode;
  if (sub === "day") {
    sessionsFilter = s => s.day === sel;
    rowMode = "room"; // rows = rooms, cols = periods (only for the single selected day)
  } else if (sub === "group") {
    const [sem, grp] = sel.split("|");
    sessionsFilter = s => s.semester === sem && s.groups.includes(grp);
    rowMode = "day"; // rows = days, cols = periods
  } else {
    sessionsFilter = s => s.teacher === sel;
    rowMode = "day";
  }

  const sessions = schedule.sessions.filter(sessionsFilter);

  const table = document.createElement("table");
  table.className = "schedule-grid";

  if (rowMode === "room") {
    const rooms = Array.from(new Set(sessions.map(s => s.room))).sort();
    const roomList = rooms.length ? rooms : ["—"];
    const thead = document.createElement("thead");
    thead.innerHTML = "<tr><th class='corner'>Salle</th>" + settings.periods.map(p => `<th>${p.label}</th>`).join("") + "</tr>";
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    roomList.forEach(room => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<th>${room}</th>`;
      settings.periods.forEach((p, pIdx) => {
        const td = document.createElement("td");
        td.className = "slot";
        const here = sessions.filter(s => s.room === room && s.periodIdx === pIdx);
        td.innerHTML = here.map(sessionChipHtml).join("");
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  } else {
    const thead = document.createElement("thead");
    thead.innerHTML = "<tr><th class='corner'>Jour</th>" + settings.periods.map(p => `<th>${p.label}</th>`).join("") + "</tr>";
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    settings.days.forEach(day => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<th>${day}</th>`;
      settings.periods.forEach((p, pIdx) => {
        const td = document.createElement("td");
        td.className = "slot";
        const here = sessions.filter(s => s.day === day && s.periodIdx === pIdx);
        td.innerHTML = here.map(sessionChipHtml).join("");
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  wrap.innerHTML = "";
  wrap.appendChild(table);
};

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
