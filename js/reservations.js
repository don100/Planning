/* =========================================================
   reservations.js — lets the user pick, per teacher, the
   slots where they are NOT available. Stored in
   App.state.reservations[teacherName] = Set("DAY|periodIdx").
   ========================================================= */

App.populateReservationTeacherSelect = function () {
  const sel = document.getElementById("reservationTeacherSelect");
  sel.innerHTML = "";
  App.state.teachers.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.name;
    opt.textContent = t.name + "  (" + t.weeklyHours + " h/sem.)";
    sel.appendChild(opt);
  });
  if (App.state.teachers.length) App.renderReservationGrid(sel.value);
};

App.renderReservationGrid = function (teacherName) {
  const wrap = document.getElementById("reservationGrid");
  const settings = App.state.settings;
  const mode = settings.reservationMode || "fix";
  if (!teacherName) { wrap.innerHTML = "<p class='muted'>Importez d'abord un fichier pour lister les enseignants.</p>"; return; }

  if (!App.state.reservations[teacherName]) App.state.reservations[teacherName] = new Set();
  const set = App.state.reservations[teacherName];
  const otherTeachers = Object.keys(App.state.reservations).filter(t => t !== teacherName);

  const table = document.createElement("table");
  table.className = "schedule-grid";

  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  trh.innerHTML = "<th class='corner'>Période</th>" + settings.days.map(d => `<th>${d}</th>`).join("");
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  settings.periods.forEach((p, pIdx) => {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = p.label;
    tr.appendChild(th);

    settings.days.forEach(day => {
      const key = day + "|" + pIdx;
      const td = document.createElement("td");
      const blocked = set.has(key);
      const othersHere = otherTeachers.filter(t => App.isReserved(t, day, pIdx));

      if (blocked) {
        td.className = "slot clickable blocked";
        td.title = mode === "fix"
          ? "Séance fixée ici — cliquer pour libérer"
          : "Indisponible pour cet enseignant — cliquer pour libérer";
        td.addEventListener("click", () => {
          set.delete(key);
          td.classList.remove("blocked");
          App.saveReservations();
        });
      } else if (othersHere.length) {
        // already taken by another teacher: visible but NOT selectable,
        // so the same slot can never be booked for two teachers.
        td.className = "slot other-blocked";
        td.title = "Déjà réservé par : " + othersHere.join(", ");
        const badge = document.createElement("span");
        badge.className = "other-blocked-badge";
        badge.textContent = othersHere.map(shortName).join(" · ");
        td.appendChild(badge);
      } else {
        td.className = "slot clickable";
        td.addEventListener("click", () => {
          set.add(key);
          td.classList.add("blocked");
          App.saveReservations();
        });
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  wrap.innerHTML = "";
  wrap.appendChild(table);
};

function shortName(name) {
  const parts = (name || "").split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return (parts[0] || "?").slice(0, 9);
  return parts.slice(0, 2).map(w => w[0].toUpperCase() + ".").join("");
}

App.exportReservationsJSON = function () {
  const plain = {};
  Object.keys(App.state.reservations).forEach(t => { plain[t] = Array.from(App.state.reservations[t]); });
  const blob = new Blob([JSON.stringify(plain, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "uniplan_reservations.json"; a.click();
  URL.revokeObjectURL(url);
};

App.importReservationsJSON = function (file, cb) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const plain = JSON.parse(e.target.result);
      if (!plain || typeof plain !== "object" || Array.isArray(plain)) throw new Error("invalid");
      const out = {};
      Object.keys(plain).forEach(t => {
        const v = plain[t];
        if (!Array.isArray(v)) throw new Error("invalid");
        const set = new Set();
        v.forEach(item => {
          if (typeof item !== "string" || item.indexOf("|") < 0) throw new Error("invalid");
          set.add(item);
        });
        out[t] = set;
      });
      App.state.reservations = out;
      App.saveReservations();
      if (cb) cb(true);
    } catch (err) {
      if (cb) cb(false);
    }
  };
  reader.readAsText(file);
};
