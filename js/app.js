/* =========================================================
   app.js — wires up navigation and all panel interactions.
   ========================================================= */
document.addEventListener("DOMContentLoaded", () => {

  App.loadSettings();
  App.loadReservations();

  /* ---------- tab navigation ---------- */
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("panel-" + tab.dataset.tab).classList.add("active");
      if (tab.dataset.tab === "results") App.renderResultView();
    });
  });

  /* ---------- import ---------- */
  const fileInput = document.getElementById("fileInput");
  const dropzone = document.getElementById("dropzone");

  function handleFile(file) {
    if (!file) return;
    document.getElementById("fileName").textContent = file.name;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        App.parseWorkbook(e.target.result);
        App.renderImportSummary();
        App.renderHeaderStats();
        App.renderTeacherCapsTable();
        App.populateReservationTeacherSelect();
        App.populateResultSelector();

        // Show import summary
        const n = App.state.assignments.length;
        const t = App.state.teachers.length;
        const g = App.state.groupKeys.length;
        if (n > 0) {
          console.log(`[UniPlan] ${n} affectations, ${t} enseignants, ${g} groupes importés avec succès.`);
        }
      } catch (err) {
        alert("Impossible de lire ce fichier.\n\n" + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));
  dropzone.addEventListener("dragover", e => { e.preventDefault(); dropzone.style.borderColor = "var(--amber)"; });
  dropzone.addEventListener("dragleave", () => { dropzone.style.borderColor = ""; });
  dropzone.addEventListener("drop", e => {
    e.preventDefault();
    dropzone.style.borderColor = "";
    if (e.dataTransfer.files.length) { fileInput.files = e.dataTransfer.files; handleFile(e.dataTransfer.files[0]); }
  });

  /* ---------- settings panel ---------- */
  function loadSettingsIntoForm() {
    App.renderDaysToggle();
    App.renderPeriodsList();
    document.getElementById("periodLength").value = App.state.settings.periodLength;
    document.getElementById("defaultMaxHoursDay").value = App.state.settings.defaultMaxHoursDay;
    document.getElementById("spreadSessions").checked = App.state.settings.spreadSessions;
    document.getElementById("roomsInput").value = (App.state.settings.rooms || []).join("\n");
  }
  loadSettingsIntoForm();

  document.getElementById("addPeriodBtn").addEventListener("click", () => {
    App.state.settings.periods.push({ label: "Nouvelle période" });
    App.renderPeriodsList();
  });

  document.getElementById("saveSettingsBtn").addEventListener("click", () => {
    const s = App.state.settings;
    s.periodLength = parseFloat(document.getElementById("periodLength").value) || 2;
    s.defaultMaxHoursDay = parseFloat(document.getElementById("defaultMaxHoursDay").value) || 6;
    s.spreadSessions = document.getElementById("spreadSessions").checked;
    s.rooms = document.getElementById("roomsInput").value.split("\n").map(r => r.trim()).filter(Boolean);
    App.saveSettings();
    App.renderTeacherCapsTable();
    App.populateReservationTeacherSelect();
    const status = document.getElementById("generateStatus");
    alert("Paramètres enregistrés.");
  });

  /* ---------- reservations panel ---------- */
  function renderReservationModeToggle() {
    const mode = App.state.settings.reservationMode || "fix";
    document.querySelectorAll("#reservationModeToggle .chip-toggle").forEach(btn => {
      btn.classList.toggle("on", btn.dataset.mode === mode);
    });
    const legend = document.getElementById("legendBlockedLabel");
    if (legend) legend.textContent = mode === "fix"
      ? "Fixé pour cet enseignant"
      : "Bloqué / indisponible";
    App.renderReservationGrid(document.getElementById("reservationTeacherSelect").value);
  }
  document.querySelectorAll("#reservationModeToggle .chip-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      App.state.settings.reservationMode = btn.dataset.mode;
      App.saveSettings();
      renderReservationModeToggle();
    });
  });
  renderReservationModeToggle();

  document.getElementById("reservationTeacherSelect").addEventListener("change", e => {
    App.renderReservationGrid(e.target.value);
  });
  document.getElementById("clearReservationsBtn").addEventListener("click", () => {
    const sel = document.getElementById("reservationTeacherSelect").value;
    App.state.reservations[sel] = new Set();
    App.saveReservations();
    App.renderReservationGrid(sel);
  });
  document.getElementById("exportReservationsBtn").addEventListener("click", App.exportReservationsJSON);
  document.getElementById("importReservationsInput").addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;
    App.importReservationsJSON(file, ok => {
      if (ok) { App.renderReservationGrid(document.getElementById("reservationTeacherSelect").value); alert("Réservations importées."); }
      else alert("Fichier JSON invalide.");
    });
  });

  /* ---------- generate panel ---------- */
  document.getElementById("generateBtn").addEventListener("click", () => {
    if (!App.state.assignments.length) { alert("Importez d'abord un fichier Excel (onglet 1)."); return; }
    const statusBox = document.getElementById("generateStatus");
    statusBox.hidden = false;
    statusBox.className = "status-box";
    statusBox.textContent = "Génération en cours…";

    // allow the "en cours" message to paint before the (synchronous) solve runs
    setTimeout(() => {
      const attempts = parseInt(document.getElementById("attemptsInput").value, 10) || 40;
      const schedule = App.generateSchedule(attempts);
      App.renderHeaderStats();
      App.renderConflicts();
      App.populateResultSelector();

      if (schedule.conflicts.length === 0) {
        statusBox.className = "status-box";
        statusBox.textContent = `Emploi du temps généré avec succès — ${schedule.sessions.length} séances placées, aucun conflit.`;
      } else {
        statusBox.className = "status-box error";
        statusBox.textContent = `Emploi du temps généré — ${schedule.sessions.length} séances placées, ${schedule.conflicts.length} non planifiées (voir détail ci-dessous).`;
      }
    }, 30);
  });

  /* ---------- results panel ---------- */
  document.querySelectorAll(".subtab").forEach(st => {
    st.addEventListener("click", () => {
      document.querySelectorAll(".subtab").forEach(s => s.classList.remove("active"));
      st.classList.add("active");
      App.state.resultView.subtab = st.dataset.subtab;
      App.populateResultSelector();
    });
  });
  document.getElementById("resultSelector").addEventListener("change", e => {
    App.state.resultView.selection = e.target.value;
    App.renderResultView();
  });
  document.getElementById("printBtn").addEventListener("click", () => window.print());
  document.getElementById("exportExcelBtn").addEventListener("click", App.exportScheduleToExcel);
});
