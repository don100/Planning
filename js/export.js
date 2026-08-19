/* =========================================================
   export.js — builds a multi-sheet .xlsx from the generated
   schedule: one sheet per day, per semester/group, per teacher,
   plus a flat "Séances" sheet with every session as a row.
   ========================================================= */

function safeSheetName(name) {
  return name.replace(/[\\/?*\[\]:]/g, " ").slice(0, 31) || "Feuille";
}

function cellText(sessions) {
  return sessions.map(s => `${s.module}\n${s.teacher}\n${s.semester} - ${s.groupLabel}${s.room ? " (" + s.room + ")" : ""}`).join("\n---\n");
}

App.exportScheduleToExcel = function () {
  const schedule = App.state.schedule;
  const settings = App.state.settings;
  if (!schedule) { alert("Générez d'abord l'emploi du temps."); return; }

  const wb = XLSX.utils.book_new();

  // ---- Sheet per day (rows = rooms, cols = periods) ----
  settings.days.forEach(day => {
    const sessions = schedule.sessions.filter(s => s.day === day);
    const rooms = Array.from(new Set(sessions.map(s => s.room))).sort();
    const header = ["Salle", ...settings.periods.map(p => p.label)];
    const aoa = [header];
    (rooms.length ? rooms : ["—"]).forEach(room => {
      const row = [room];
      settings.periods.forEach((p, pIdx) => {
        const here = sessions.filter(s => s.room === room && s.periodIdx === pIdx);
        row.push(cellText(here));
      });
      aoa.push(row);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName("Jour_" + day));
  });

  // ---- Sheet per semester/group (rows = days, cols = periods) ----
  App.state.groupKeys.forEach(g => {
    const sessions = schedule.sessions.filter(s => s.semester === g.semester && s.groups.includes(g.group));
    const header = ["Jour", ...settings.periods.map(p => p.label)];
    const aoa = [header];
    settings.days.forEach(day => {
      const row = [day];
      settings.periods.forEach((p, pIdx) => {
        const here = sessions.filter(s => s.day === day && s.periodIdx === pIdx);
        row.push(cellText(here));
      });
      aoa.push(row);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(g.semester + "_" + g.group));
  });

  // ---- Sheet per teacher (rows = days, cols = periods) ----
  App.state.teachers.forEach(t => {
    const sessions = schedule.sessions.filter(s => s.teacher === t.name);
    const header = ["Jour", ...settings.periods.map(p => p.label)];
    const aoa = [header];
    settings.days.forEach(day => {
      const row = [day];
      settings.periods.forEach((p, pIdx) => {
        const here = sessions.filter(s => s.day === day && s.periodIdx === pIdx);
        row.push(cellText(here));
      });
      aoa.push(row);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName("Prof_" + t.name.slice(0, 22)));
  });

  // ---- Flat sessions sheet ----
  const flatHeader = ["Semestre", "Module", "Enseignant", "Groupes", "Jour", "Période", "Salle", "Durée (h)"];
  const flatRows = schedule.sessions.map(s => [
    s.semester, s.module, s.teacher, s.groupLabel, s.day, s.periodLabel, s.room, s.durationHours
  ]);
  const wsFlat = XLSX.utils.aoa_to_sheet([flatHeader, ...flatRows]);
  XLSX.utils.book_append_sheet(wb, wsFlat, "Séances");

  // ---- Unplaced/conflicts sheet, if any ----
  if (schedule.conflicts.length) {
    const cHeader = ["Semestre", "Module", "Enseignant", "Groupes", "Séance"];
    const cRows = schedule.conflicts.map(c => [c.semester, c.module, c.teacher, c.groupLabel, c.partIndex + "/" + c.partTotal]);
    const wsC = XLSX.utils.aoa_to_sheet([cHeader, ...cRows]);
    XLSX.utils.book_append_sheet(wb, wsC, "Non planifiées");
  }

  XLSX.writeFile(wb, "emploi_du_temps_uniplan.xlsx");
};
