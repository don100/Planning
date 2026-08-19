/* =========================================================
   parser.js — turns the "Affectation" Excel sheet into a
   normalized list of teaching assignments the scheduler can use.

   Flexible column detection — the parser adapts to files with
   varying numbers of columns:

   Required (at minimum):
     SEMESTRE | Professeur | and either Nombre Heures or Volume Horaire

   Optional (auto-detected when present):
     Elément de module | GROUPE | Nombre Groupes | Coordonnateurs

   When GROUPE is absent, a default group "T" (all) is assigned.
   When Nombre Heures is absent, Volume Horaire is used as fallback.

   Merged cells are handled via forward-fill: if a cell is empty
   (because it sits inside a merged range), the last known value
   for that column is carried forward.
   ========================================================= */
App.parseWorkbook = function (arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array", cellStyles: true });

  let bestResult = null;
  let bestCount = 0;
  const sheetDiagnostics = [];

  wb.SheetNames.forEach(name => {
    const ws = wb.Sheets[name];
    const raw = XLSX.utils.sheet_to_json(ws, { defval: "", header: 1 });
    if (!raw.length) { sheetDiagnostics.push({ name, rows: 0 }); return; }

    // Scan first 10 rows to find the header row
    let headerIdx = 0;
    for (let i = 0; i < Math.min(10, raw.length); i++) {
      const cells = raw[i].map(c => (c || "").toString().toLowerCase());
      const joined = cells.join(" ");
      const hits = ["semestre", "professeur", "groupe", "module", "volume", "heure"]
        .filter(k => joined.includes(k)).length;
      if (hits >= 2) { headerIdx = i; break; } // lowered from 3 to 2 for minimal 4-col files
    }

    const headerRow = raw[headerIdx];
    if (!headerRow || !headerRow.length) { sheetDiagnostics.push({ name, rows: 0 }); return; }

    const keyed = [];
    for (let i = headerIdx + 1; i < raw.length; i++) {
      const obj = {};
      let hasContent = false;
      headerRow.forEach((h, ci) => {
        if (h === undefined || h === null) return;
        const key = h.toString().trim();
        if (!key) return;
        const val = raw[i][ci] !== undefined ? raw[i][ci] : "";
        obj[key] = val;
        if (val !== "" && val !== null && val !== undefined) hasContent = true;
      });
      if (hasContent) keyed.push(obj);
    }

    const result = App.normalizeRows(keyed, name);
    sheetDiagnostics.push({ name, rows: keyed.length, assignments: result.assignments.length });

    if (result.assignments.length > bestCount) {
      bestCount = result.assignments.length;
      bestResult = result;
    }
  });

  if (!bestResult || !bestResult.assignments.length) {
    const diag = sheetDiagnostics.map(s =>
      `  • "${s.name}": ${s.rows} lignes, ${s.assignments || 0} affectations`
    ).join("\n");
    throw new Error(
      "Aucune affectation trouvée dans le fichier.\n\n" +
      "Feuilles détectées :\n" + (diag || "  (aucune)") + "\n\n" +
      "Colonnes attendues (minimum) :\n" +
      "  SEMESTRE | Professeur | Nombre Heures (ou Volume Horaire)\n\n" +
      "Colonnes optionnelles (auto-détectées) :\n" +
      "  Elément de module | GROUPE | Nombre Groupes | Coordonnateurs\n\n" +
      "Astuce : ouvrez la console (F12) pour voir les en-têtes réellement trouvées."
    );
  }

  return bestResult;
};

function normHeader(key) {
  return key.toString().trim().toLowerCase();
}

function findKey(row, candidates) {
  const keys = Object.keys(row);
  for (const k of keys) {
    const nk = normHeader(k);
    if (candidates.some(c => nk.includes(c))) return k;
  }
  return null;
}

function parseHours(val) {
  if (val === null || val === undefined) return 0;
  const s = val.toString().toUpperCase().replace(",", ".");
  const m = s.match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

function normalizeSemester(val) {
  const s = (val || "").toString().toUpperCase().trim();
  const m = s.match(/(\d+)/);
  if (m) return "S" + m[1];
  return s || "S?";
}

function splitGroups(raw) {
  if (!raw) return [];
  return raw.toString()
    .split("/")
    .map(g => g.trim())
    .filter(Boolean)
    .map(g => g.replace(/\s+/g, ""));
}

App.normalizeRows = function (rows, sheetName) {
  if (!rows.length) return { assignments: [], teachers: [], semesters: [], groupKeys: [] };

  const first = rows[0];

  // --- Column detection ---
  const kSem      = findKey(first, ["semestre"]);
  const kModule   = findKey(first, ["module", "élément", "element", "matière", "matiere"]);
  const kVolume   = findKey(first, ["volume"]);
  const kTeacher  = findKey(first, ["professeur", "enseignant", "prof", "ens."]);
  const kHeures   = findKey(first, ["nombre heures", "nombreeures", "nb heures", "heures"]);
  const kGroupe   = findKey(first, ["groupe"]);
  const kNbGroupes = findKey(first, ["nombre groupes", "nb groupes"]);
  const kCoord    = findKey(first, ["coordonnateur", "coordonnateurs"]);

  const keys = Object.keys(first);
  const kGroupeExact = keys.find(k => normHeader(k) === "groupe") || kGroupe;

  const hasDedicatedHeures = !!kHeures;
  const hasGroupe = !!kGroupeExact;

  // Diagnostics
  const missing = [];
  if (!kSem)      missing.push("SEMESTRE");
  if (!kTeacher)  missing.push("Professeur");
  if (!kHeures && !kVolume) missing.push("Nombre Heures / Volume Horaire");
  if (missing.length) {
    console.warn("[UniPlan] Colonnes obligatoires manquantes :", missing.join(", "));
    console.warn("[UniPlan] En-têtes trouvées :", Object.keys(first).join(" | "));
  }
  if (!hasGroupe) {
    console.warn("[UniPlan] Pas de colonne GROUPE → groupe par défaut \"T\" sera utilisé.");
  }
  if (!hasDedicatedHeures && kVolume) {
    console.warn("[UniPlan] Pas de colonne \"Nombre Heures\" → Volume Horaire partagé entre les enseignants.");
  }

  App.state.rawRows = rows;

  // ============================================================
  // PASS 1 — read every row with forward-fill, collect raw entries
  // grouped by (semester, module) so we can divide shared hours.
  // ============================================================
  let currentModule = "", currentVolume = "", currentCoord = "";
  let currentHeures = 0;
  let currentSemester = "";
  let currentGroupes = "";

  const cell = (row, col) => {
    const v = col ? row[col] : "";
    return (v === undefined || v === null) ? "" : String(v).trim();
  };

  // "moduleKey" → { volume, totalHeures, entries: [{teacher, semester, groups, coord}] }
  const moduleBlocks = {};
  const skippedRows = [];
  let blockIdx = 0; // for generating unique block IDs

  rows.forEach((row, idx) => {
    const semRaw = kSem ? row[kSem] : "";
    if (!semRaw && !row[kTeacher]) return;

    const moduleCell = cell(row, kModule);
    const volumeCell = cell(row, kVolume);
    const coordCell  = cell(row, kCoord);
    const heuresCell = cell(row, kHeures);
    const groupeCell = cell(row, kGroupeExact);
    const semCell    = cell(row, kSem);
    const teacher    = cell(row, kTeacher);

    // Forward-fill
    if (moduleCell) { currentModule = moduleCell; blockIdx++; }
    if (volumeCell) currentVolume = volumeCell;
    if (coordCell)  currentCoord  = coordCell;
    if (semCell)    currentSemester = semCell;
    if (groupeCell) currentGroupes  = groupeCell;

    if (heuresCell) currentHeures = parseHours(heuresCell);

    const semester = normalizeSemester(semCell || currentSemester || "");
    const weeklyHours = currentHeures;
    const groups = hasGroupe ? splitGroups(currentGroupes) : ["T"];

    if (!teacher || !weeklyHours || !groups.length) {
      const reasons = [];
      if (!teacher)       reasons.push("Enseignant manquant");
      if (!weeklyHours)   reasons.push("Heures invalides (= 0)");
      if (!groups.length) reasons.push("Groupe manquant");
      skippedRows.push({
        rowIdx: idx + 2,
        reason: reasons.join(" · ") || "Ligne vide",
        semester: semester || "—",
        module: currentModule || "—",
        teacher: teacher || "—",
        hours: weeklyHours || "—",
        group: currentGroupes || "—"
      });
      return;
    }

    // Group by semester+module to detect shared-volume modules
    const mKey = semester + "|" + currentModule + "|" + blockIdx;
    if (!moduleBlocks[mKey]) {
      moduleBlocks[mKey] = {
        module: currentModule,
        volume: currentVolume,
        totalHeures: weeklyHours,
        semester,
        coord: currentCoord,
        entries: []
      };
    }
    moduleBlocks[mKey].entries.push({ teacher, groups });
  });

  // ============================================================
  // PASS 2 — build assignments, dividing shared hours when
  // there is no dedicated "Nombre Heures" column.
  // ============================================================
  const assignments = [];
  const teacherHours = {};
  const semesterSet = new Set();
  const groupKeySet = new Map();

  Object.values(moduleBlocks).forEach(block => {
    const nTeachers = block.entries.length;

    block.entries.forEach(entry => {
      // When Volume Horaire is shared (no dedicated heures column),
      // divide by the number of teachers for this module.
      const perTeacherHours = hasDedicatedHeures
        ? block.totalHeures
        : Math.round((block.totalHeures / nTeachers) * 10) / 10; // 1 decimal

      if (!perTeacherHours) return;

      semesterSet.add(block.semester);
      entry.groups.forEach(g => {
        const key = block.semester + "|" + g;
        if (!groupKeySet.has(key)) groupKeySet.set(key, { semester: block.semester, group: g });
      });

      teacherHours[entry.teacher] = (teacherHours[entry.teacher] || 0) +
        perTeacherHours * Math.max(1, entry.groups.length);

      assignments.push({
        id: "A" + (assignments.length + 1),
        semester: block.semester,
        module: block.module || "(module non nommé)",
        volumeHoraireTotal: block.volume,
        teacher: entry.teacher,
        weeklyHours: perTeacherHours,
        groups: entry.groups,
        groupLabel: entry.groups.join("/"),
        nbGroupesText: entry.groups.length > 1 ? String(entry.groups.length) : "",
        coordinator: block.coord,
        sourceRow: 0
      });
    });
  });

  const teachers = Object.keys(teacherHours).sort().map(name => ({
    name, weeklyHours: teacherHours[name]
  }));

  App.state.assignments = assignments;
  App.state.teachers = teachers;
  App.state.semesters = Array.from(semesterSet).sort();
  App.state.groupKeys = Array.from(groupKeySet.values()).sort((a, b) =>
    a.semester === b.semester ? a.group.localeCompare(b.group) : a.semester.localeCompare(b.semester)
  );
  App.state.skippedRows = skippedRows;

  console.log(
    `[UniPlan] Import "${sheetName || "?"}": ${assignments.length} affectations, ` +
    `${teachers.length} enseignants, ${App.state.semesters.length} semestre(s), ` +
    `${App.state.groupKeys.length} groupe(s)` +
    (skippedRows.length ? ` — ${skippedRows.length} ligne(s) ignorée(s)` : "")
  );

  return {
    assignments, teachers,
    semesters: App.state.semesters,
    groupKeys: App.state.groupKeys,
    skippedRows
  };
};
