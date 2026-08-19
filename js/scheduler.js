/* =========================================================
   scheduler.js — assigns each teaching session to a
   (day, period, room) slot.

   Hard constraints respected:
     - a teacher is never double-booked at the same slot
     - a group is never double-booked at the same slot
       (conflict key = semester + individual group letter)
     - a room is never double-booked at the same slot
     - a teacher never exceeds their max hours/day
     - reservations follow the chosen mode:
         * "fix"   — the teacher's session(s) are pinned into the reserved
                     slots (one session per slot) before anything else
         * "block" — reserved slots are excluded for that teacher
       In both modes, pinned/blocked slots are never given to other
       teachers of the same conflicts, and repair never moves a pinned session.

   An assignment "4 H · A/B" is expanded so the volume is taught to each
   group separately (4h for A + 4h for B = 4 sessions of 2h), i.e. every
   session targets a single group letter.

   Preference model for the daily blocks of a group (and of a teacher):
   half-days are filled first — a group that studies morning-only or
   afternoon-only is best. Students may grow to 3-4 period days (6-8h)
   when no half-day slot is available, but only as a last resort. Blocks
   are never split by an empty period in the middle, except when no other
   slot is possible.

   Teachers (and medical staff) teach 2 consecutive periods within a
   half-day block — either morning (periods 0-1) or evening (periods 2-3).
   Crossing the midday boundary (periods 1-2) is strongly penalised and
   only used as an absolute last resort. "Spread sessions" is a soft
   preference (a mild penalty), so it only yields when a real 4h pair for
   the teacher is at stake.

   Strategy: most-constrained-variable greedy placement with
   randomized tie-breaking, repeated over several attempts;
   the best attempt (fewest unplaced sessions, then tidiest daily
   blocks) is kept. This is a heuristic, not an exact solver — for the
   sizes involved (tens to low hundreds of sessions) it finds a clean
   solution in the vast majority of runs, and reports the remainder as
   conflicts to resolve manually (e.g. by loosening a cap or a
   reservation) when it doesn't.
   ========================================================= */

App.buildSessionTasks = function () {
  const settings = App.state.settings;
  const periodLen = settings.periodLength || 2;
  const tasks = [];

  App.state.assignments.forEach(a => {
    let perGroup = Math.round(a.weeklyHours / periodLen);
    if (perGroup < 1) perGroup = 1;
    // each group letter gets the full weekly volume, taught separately
    a.groups.forEach(g => {
      for (let i = 0; i < perGroup; i++) {
        tasks.push({
          id: a.id + "-" + g + "-" + (i + 1),
          assignmentId: a.id,
          teacher: a.teacher,
          module: a.module,
          semester: a.semester,
          group: g,
          groups: [g],
          groupLabel: g,
          durationHours: periodLen,
          partIndex: i + 1,
          partTotal: perGroup
        });
      }
    });
  });
  return tasks;
};

function teacherMaxPerDay(teacherName) {
  const s = App.state.settings;
  const override = s.teacherCaps ? s.teacherCaps[teacherName] : null;
  const maxHours = override || s.defaultMaxHoursDay || 6;
  return Math.max(1, Math.floor(maxHours / (s.periodLength || 2)));
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function groupConflictKeys(task) {
  return task.groups.map(g => task.semester + "|" + g);
}

// Detect whether a period-index range crosses the midday boundary.
// With 4 periods (0..3), the boundary sits between indices 1 and 2.
// A block [1,2] crosses; [0,1] and [2,3] do not.
function crossesMidday(min, max) {
  return min <= 1 && max >= 2;
}

// Returns true when a block of given size is a clean 2-period morning
// or evening block (not crossing the midday boundary).
function isCleanHalfDay(min, max) {
  return (max - min + 1) === 2 && !crossesMidday(min, max);
}

App.runSchedulerAttempt = function (tasks, settings) {
  const days = settings.days;
  const periods = settings.periods;
  const rooms = (settings.rooms && settings.rooms.length) ? settings.rooms : autoRooms(settings, tasks);

  // occupancy trackers keyed by "day|periodIdx"
  const teacherBusy = {};   // slotKey -> Set(teacher)
  const groupBusy = {};     // slotKey -> Set(groupKey)
  const roomBusy = {};      // slotKey -> Set(room)
  const teacherDayCount = {}; // "teacher|day" -> count
  const groupDaySpan = {};    // "groupKey|day" -> {min,max} period indices
  const teacherDaySpan = {};  // "teacher|day" -> {min,max} period indices
  const assignmentDaysUsed = {}; // "assignmentId|group" -> Set(day)  (for spreading)

  const placed = [];
  const unplaced = [];

  // =========================================================
  // FIX mode: pre-place one of the teacher's sessions into each
  // reserved slot, so those exact day/period slots get a session.
  // The remaining sessions are then placed normally by the main loop.
  // =========================================================
  const fixedIds = new Set();
  if ((settings.reservationMode || "fix") !== "block") {
    const slots = [];
    Object.keys(App.state.reservations).forEach(t => {
      (App.state.reservations[t] || []).forEach(key => {
        const parts = String(key).split("|");
        if (parts.length !== 2) return;
        slots.push({ teacher: t, day: parts[0], pIdx: parseInt(parts[1], 10) });
      });
    });
    slots.sort((a, b) => {
      const da = days.indexOf(a.day), db = days.indexOf(b.day);
      if (da !== db) return da - db;
      return a.pIdx - b.pIdx;
    });

    slots.forEach(r => {
      if (r.pIdx < 0 || r.pIdx >= periods.length) return;
      const candidate = tasks.find(t => t.teacher === r.teacher && !fixedIds.has(t.id));
      if (!candidate) return;
      const slotKey = r.day + "|" + r.pIdx;
      if (teacherBusy[slotKey] && teacherBusy[slotKey].has(candidate.teacher)) return;
      const cg = groupConflictKeys(candidate);
      if (groupBusy[slotKey] && cg.some(gk => groupBusy[slotKey].has(gk))) return;
      const dayKey = candidate.teacher + "|" + r.day;
      if ((teacherDayCount[dayKey] || 0) >= teacherMaxPerDay(candidate.teacher)) return;
      const room = rooms.find(rr => !(roomBusy[slotKey] && roomBusy[slotKey].has(rr)));
      if (!room) return;

      teacherBusy[slotKey] = teacherBusy[slotKey] || new Set();
      teacherBusy[slotKey].add(candidate.teacher);
      groupBusy[slotKey] = groupBusy[slotKey] || new Set();
      cg.forEach(gk => groupBusy[slotKey].add(gk));
      roomBusy[slotKey] = roomBusy[slotKey] || new Set();
      roomBusy[slotKey].add(room);

      teacherDayCount[dayKey] = (teacherDayCount[dayKey] || 0) + 1;
      const tSpanKey = candidate.teacher + "|" + r.day;
      if (!teacherDaySpan[tSpanKey]) teacherDaySpan[tSpanKey] = { min: r.pIdx, max: r.pIdx };
      else {
        if (r.pIdx < teacherDaySpan[tSpanKey].min) teacherDaySpan[tSpanKey].min = r.pIdx;
        if (r.pIdx > teacherDaySpan[tSpanKey].max) teacherDaySpan[tSpanKey].max = r.pIdx;
      }
      cg.forEach(gk => {
        const gKey = gk + "|" + r.day;
        if (!groupDaySpan[gKey]) groupDaySpan[gKey] = { min: r.pIdx, max: r.pIdx };
        else {
          if (r.pIdx < groupDaySpan[gKey].min) groupDaySpan[gKey].min = r.pIdx;
          if (r.pIdx > groupDaySpan[gKey].max) groupDaySpan[gKey].max = r.pIdx;
        }
      });
      const spreadKey = candidate.assignmentId + "|" + candidate.groups[0];
      if (!assignmentDaysUsed[spreadKey]) assignmentDaysUsed[spreadKey] = new Set();
      assignmentDaysUsed[spreadKey].add(r.day);

      fixedIds.add(candidate.id);
      placed.push(Object.assign({}, candidate, {
        day: r.day,
        periodIdx: r.pIdx,
        periodLabel: periods[r.pIdx] ? periods[r.pIdx].label : "",
        room,
        fixed: true
      }));
    });
  }

  const order = shuffle(tasks.filter(t => !fixedIds.has(t.id))).sort((a, b) => {
    // most constrained first: teachers with many weekly sessions, then random
    const wa = tasks.filter(t => t.teacher === a.teacher).length;
    const wb = tasks.filter(t => t.teacher === b.teacher).length;
    if (wb !== wa) return wb - wa;
    // within a teacher, keep the parts of the same module+group adjacent so
    // they naturally land as a 4h consecutive pair
    const ka = a.assignmentId + "|" + a.groups[0];
    const kb = b.assignmentId + "|" + b.groups[0];
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  order.forEach(task => {
    const gKeys = groupConflictKeys(task);
    const maxPerDay = teacherMaxPerDay(task.teacher);
    const spreadKey = task.assignmentId + "|" + task.groups[0];
    const usedDays = assignmentDaysUsed[spreadKey] || new Set();

    // Is this exact slot available for this task right now?
    const slotFree = (day, pIdx) => {
      if (pIdx < 0 || pIdx >= periods.length) return false;
      const k = day + "|" + pIdx;
      if (teacherBusy[k] && teacherBusy[k].has(task.teacher)) return false;
      if (gKeys.some(gk => groupBusy[k] && groupBusy[k].has(gk))) return false;
      if (App.reservationBlocks(task.teacher, day, pIdx)) return false;
      return rooms.some(r => !(roomBusy[k] && roomBusy[k].has(r)));
    };

    // Score a candidate slot by how well it keeps daily blocks tidy. The
    // model for each group (and teacher) is: fill half-days (2 periods per
    // day) first — a group that can study morning-only or afternoon-only is
    // best; only when no half-day slot is left anywhere do we grow a day to
    // 6h (3 periods), and only as a last resort to a full day (4 periods).
    // A session that would open a detached second block on a day that already
    // has one is penalised (morning stays morning, afternoon stays afternoon,
    // no empty period inside a block).
    const blockScore = (day, pIdx) => {
      let score = 0;
      // "spread sessions" is now a soft preference: a day already used by the
      // same module+group is slightly penalised rather than forbidden, so it
      // only yields when a real 4h pair for the teacher is at stake.
      if (settings.spreadSessions && usedDays.has(day) && task.partTotal > 1) score -= 50;
      const gSpan = groupDaySpan[gKeys[0] + "|" + day];
      if (gSpan) {
        const inside = pIdx >= gSpan.min && pIdx <= gSpan.max;
        const extendsBlock = pIdx === gSpan.min - 1 || pIdx === gSpan.max + 1;
        if (inside) score += 1000; // fills a hole left by an earlier constraint
        else if (extendsBlock) {
          const size = Math.max(gSpan.max, pIdx) - Math.min(gSpan.min, pIdx) + 1;
          score += size <= 2 ? 1000 : 100; // students: 2-4 period blocks all OK
        } else score -= 1500; // would create a detached block that day
      }
      const tSpan = teacherDaySpan[task.teacher + "|" + day];
      if (tSpan) {
        const inside = pIdx >= tSpan.min && pIdx <= tSpan.max;
        const extendsBlock = pIdx === tSpan.min - 1 || pIdx === tSpan.max + 1;
        if (inside) score += 900;
        else if (extendsBlock) {
          const newMin = Math.min(tSpan.min, pIdx);
          const newMax = Math.max(tSpan.max, pIdx);
          const size = newMax - newMin + 1;
          if (size <= 2) {
            score += isCleanHalfDay(newMin, newMax) ? 900 : 400; // 2 periods: prefer clean half-day
          } else {
            const crosses = crossesMidday(newMin, newMax);
            score += size === 3 ? -40 : -200;
            if (crosses) score -= 500; // strong penalty for crossing midday
          }
        } else score -= 1200;
      } else if (!gSpan) {
        // fresh day for this teacher and group: prefer a slot in the
        // morning block (0-1) or evening block (2-3) so the teacher's
        // two consecutive sessions stay within one half-day and never
        // cross the midday boundary (periods 1-2).
        if (slotFree(day, pIdx - 1) || slotFree(day, pIdx + 1)) {
          if (pIdx <= 1) score += 150;       // morning half-day preferred
          else score += 90;                    // evening half-day OK
        } else {
          score -= 120;
        }
        // penalise a fresh start that would cross midday
        if (pIdx === 1 && (slotFree(day, 0) || !slotFree(day, 2))) {
          // period 1: next session at 2 crosses — push to 0 or 2-3
        } else if (pIdx === 1) {
          score -= 80; // crossing likely; prefer 0 or 2-3
        }
      }
      return score;
    };

    // build candidate slot list
    const candidates = [];
    days.forEach(day => {
      const dayCountKey = task.teacher + "|" + day;
      if ((teacherDayCount[dayCountKey] || 0) >= maxPerDay) return;

      periods.forEach((p, pIdx) => {
        if (App.reservationBlocks(task.teacher, day, pIdx)) return;
        const slotKey = day + "|" + pIdx;

        if (teacherBusy[slotKey] && teacherBusy[slotKey].has(task.teacher)) return;
        if (gKeys.some(gk => groupBusy[slotKey] && groupBusy[slotKey].has(gk))) return;

        const room = rooms.find(r => !(roomBusy[slotKey] && roomBusy[slotKey].has(r)));
        if (!room) return;

        candidates.push({ day, pIdx, slotKey, room });
      });
    });

    if (!candidates.length) {
      unplaced.push(task);
      return;
    }

    // contiguity first, then balance load across the week (fewest sessions
    // that day so far) as a tie-break; when a contiguous slot exists it is
    // always chosen over a gap-creating one.
    candidates.sort((a, b) => {
      const sa = blockScore(a.day, a.pIdx);
      const sb = blockScore(b.day, b.pIdx);
      if (sa !== sb) return sb - sa;
      const ca = teacherDayCount[task.teacher + "|" + a.day] || 0;
      const cb = teacherDayCount[task.teacher + "|" + b.day] || 0;
      return ca - cb;
    });
    // Always pick among the slots that score best (contiguous half-day
    // completions first, then 6h days, fresh days, and full days only when
    // nothing better exists) — never mixing a better score with a worse one.
    const topScore = blockScore(candidates[0].day, candidates[0].pIdx);
    const pool = candidates.filter(c => blockScore(c.day, c.pIdx) === topScore);
    const pick = pool[Math.floor(Math.random() * pool.length)];

    teacherBusy[pick.slotKey] = teacherBusy[pick.slotKey] || new Set();
    teacherBusy[pick.slotKey].add(task.teacher);
    groupBusy[pick.slotKey] = groupBusy[pick.slotKey] || new Set();
    gKeys.forEach(gk => {
      groupBusy[pick.slotKey].add(gk);
      const gkKey = gk + "|" + pick.day;
      if (!groupDaySpan[gkKey]) groupDaySpan[gkKey] = { min: pick.pIdx, max: pick.pIdx };
      else {
        if (pick.pIdx < groupDaySpan[gkKey].min) groupDaySpan[gkKey].min = pick.pIdx;
        if (pick.pIdx > groupDaySpan[gkKey].max) groupDaySpan[gkKey].max = pick.pIdx;
      }
    });
    roomBusy[pick.slotKey] = roomBusy[pick.slotKey] || new Set();
    roomBusy[pick.slotKey].add(pick.room);

    const dayCountKey = task.teacher + "|" + pick.day;
    teacherDayCount[dayCountKey] = (teacherDayCount[dayCountKey] || 0) + 1;
    const tKey = task.teacher + "|" + pick.day;
    if (!teacherDaySpan[tKey]) teacherDaySpan[tKey] = { min: pick.pIdx, max: pick.pIdx };
    else {
      if (pick.pIdx < teacherDaySpan[tKey].min) teacherDaySpan[tKey].min = pick.pIdx;
      if (pick.pIdx > teacherDaySpan[tKey].max) teacherDaySpan[tKey].max = pick.pIdx;
    }

    if (!assignmentDaysUsed[spreadKey]) assignmentDaysUsed[spreadKey] = new Set();
    assignmentDaysUsed[spreadKey].add(pick.day);

    placed.push(Object.assign({}, task, {
      day: pick.day,
      periodIdx: pick.pIdx,
      periodLabel: periods[pick.pIdx].label,
      room: pick.room
    }));
  });

  repairTeacherPairs(placed, settings);

  return { placed, unplaced };
};

// =========================================================
// repairTeacherPairs — post-processing pass that consolidates a teacher's
// isolated single sessions into consecutive 4h blocks, without ever
// overriding a reservation. Reservations are the absolute first priority:
// they are never moved, and a session is only ever re-placed onto a slot
// that is free AND not reserved for that teacher. A move must also keep
// every affected group's daily block contiguous and never push a teacher
// past their max hours/day. When a move would form a teacher pair, the
// "spread sessions" preference (same module-group on different days) is
// allowed to yield, since the teacher pairing is the stronger requirement.
// =========================================================
function repairTeacherPairs(placed, settings) {
  if (!placed.length) return;
  const periods = settings.periods;

  const teacherAt = {};   // "day|pIdx" -> teacher
  const groupsAt = {};    // "day|pIdx" -> Set(groupKey)
  const roomAt = {};      // "day|pIdx" -> room
  const teacherDay = {};  // teacher -> day -> [session]
  const groupDay = {};    // groupKey -> day -> [session]
  const slotKey = s => s.day + "|" + s.periodIdx;

  placed.forEach(s => {
    teacherAt[slotKey(s)] = s.teacher;
    const gs = groupsAt[slotKey(s)] = groupsAt[slotKey(s)] || new Set();
    s.groups.forEach(g => gs.add(s.semester + "|" + g));
    roomAt[slotKey(s)] = s.room;
    (teacherDay[s.teacher] = teacherDay[s.teacher] || {});
    (teacherDay[s.teacher][s.day] = teacherDay[s.teacher][s.day] || []).push(s);
    s.groups.forEach(g => {
      const gk = s.semester + "|" + g;
      groupDay[gk] = groupDay[gk] || {};
      (groupDay[gk][s.day] = groupDay[gk][s.day] || []).push(s);
    });
  });

  const allRooms = [];
  placed.forEach(s => { if (allRooms.indexOf(s.room) === -1) allRooms.push(s.room); });
  if (!allRooms.length) return;

  const maxPerDay = t => {
    const s = settings;
    const ov = s.teacherCaps ? s.teacherCaps[t] : null;
    const mh = ov || s.defaultMaxHoursDay || 6;
    return Math.max(1, Math.floor(mh / (s.periodLength || 2)));
  };

  const contiguous = list => {
    const ps = list.map(x => x.periodIdx).sort((a, b) => a - b);
    for (let i = 1; i < ps.length; i++) if (ps[i] - ps[i - 1] > 1) return false;
    return true;
  };

  const canPlace = (s, day, pIdx) => {
    if (pIdx < 0 || pIdx >= periods.length) return false;
    const k = day + "|" + pIdx;
    if (teacherAt[k] !== undefined) return false;
    const gs = groupsAt[k];
    if (gs) for (const g of s.groups) if (gs.has(s.semester + "|" + g)) return false;
    if (App.reservationBlocks(s.teacher, day, pIdx)) return false; // block-mode: exclude reserved
    return true;
  };

  const groupOkAdd = (s, day, pIdx) => {
    for (const g of s.groups) {
      const gk = s.semester + "|" + g;
      const list = (groupDay[gk][day] || []).concat({ periodIdx: pIdx });
      if (!contiguous(list)) return false;
    }
    return true;
  };

  const groupOkRemove = (s, day) => {
    for (const g of s.groups) {
      const gk = s.semester + "|" + g;
      const list = (groupDay[gk][day] || []).filter(x => x !== s);
      if (!contiguous(list)) return false;
    }
    return true;
  };

  const removeSession = s => {
    const k = slotKey(s);
    delete teacherAt[k];
    delete roomAt[k];
    if (groupsAt[k]) groupsAt[k].clear();
    const td = teacherDay[s.teacher][s.day];
    if (td) { const i = td.indexOf(s); if (i >= 0) td.splice(i, 1); }
    s.groups.forEach(g => {
      const gk = s.semester + "|" + g;
      const gd = groupDay[gk][s.day];
      if (gd) { const i = gd.indexOf(s); if (i >= 0) gd.splice(i, 1); }
    });
  };

  const placeSession = (s, day, pIdx) => {
    const k = day + "|" + pIdx;
    teacherAt[k] = s.teacher;
    const gs = groupsAt[k] = groupsAt[k] || new Set();
    s.groups.forEach(g => gs.add(s.semester + "|" + g));
    const free = allRooms.find(r => roomAt[k] !== r);
    if (free === undefined) return false;
    roomAt[k] = free;
    s.day = day;
    s.periodIdx = pIdx;
    s.periodLabel = periods[pIdx] ? periods[pIdx].label : s.periodLabel;
    s.room = free;
    (teacherDay[s.teacher][day] = teacherDay[s.teacher][day] || []).push(s);
    s.groups.forEach(g => {
      const gk = s.semester + "|" + g;
      groupDay[gk] = groupDay[gk] || {};
      (groupDay[gk][day] = groupDay[gk][day] || []).push(s);
    });
    return true;
  };

  let guard = 0;
  let changed = true;
  while (changed && guard++ < 20) {
    changed = false;
    Object.keys(teacherDay).forEach(t => {
      Object.keys(teacherDay[t] || {}).slice().forEach(day => {
        const list = teacherDay[t][day];
        if (!list || list.length !== 1) return;
        const s = list[0];
        if (s.fixed) return; // fix-mode: never move a pinned session
        let best = null;
        Object.keys(teacherDay[t]).forEach(d2 => {
          if (d2 === day) return;
          const other = teacherDay[t][d2];
          if (other.length >= maxPerDay(t)) return;
          const base = other.map(o => o.periodIdx);
          const spreadKey = s.assignmentId + "|" + s.groups[0];
          const breaksSpread = other.some(o => (o.assignmentId + "|" + o.groups[0]) === spreadKey);
          other.forEach(o => {
            [o.periodIdx - 1, o.periodIdx + 1].forEach(p => {
              if (!canPlace(s, d2, p)) return;
              const ps = base.concat(p).sort((a, b) => a - b);
              for (let i = 1; i < ps.length; i++) if (ps[i] - ps[i - 1] > 1) return;
              const size = ps[ps.length - 1] - ps[0] + 1;
              const crosses = crossesMidday(ps[0], ps[ps.length - 1]);
              // strongly prefer 2-period blocks that stay within morning
              // or evening (not crossing the midday boundary at 1-2)
              const cand = { day: d2, pIdx: p, size, breaksSpread, crosses };
              if (!best || cand.size < best.size ||
                  (cand.size === best.size && cand.crosses < best.crosses) ||
                  (cand.size === best.size && cand.crosses === best.crosses && cand.breaksSpread < best.breaksSpread)) {
                best = cand;
              }
            });
          });
        });
        if (!best) return;
        if (!groupOkAdd(s, best.day, best.pIdx)) return;
        if (!groupOkRemove(s, day)) return;
        if ((teacherDay[t][best.day] || []).length + 1 > maxPerDay(t)) return;
        removeSession(s);
        if (placeSession(s, best.day, best.pIdx)) changed = true;
      });
    });
  }

  // =========================================================
  // Pass B — relocate two isolated singles into a fresh free window of two
  // consecutive periods (4h block) on some other day. This is the fallback
  // when no adjacency exists next to an existing session: a teacher whose two
  // sessions ended up scattered can still be brought together into a pair.
  // =========================================================
  const days = settings.days;
  for (let round = 0; round < 5; round++) {
    const byTeacher = {};
    Object.keys(teacherDay).forEach(t => {
      Object.keys(teacherDay[t] || {}).forEach(day => {
        const list = teacherDay[t][day];
        if (list && list.length === 1 && !list[0].fixed) (byTeacher[t] = byTeacher[t] || []).push(list[0]);
      });
    });
    let moved = false;
    Object.keys(byTeacher).forEach(t => {
      const list = byTeacher[t];
      if (list.length < 2 || moved) return;
      for (let i = 0; i < list.length && !moved; i++) {
        for (let j = i + 1; j < list.length && !moved; j++) {
          const a = list[i], b = list[j];
          if (a.day === b.day) continue;
          const cap = maxPerDay(t);
          const curOnDay = d => (teacherDay[t][d] || []).length;
          for (const day of days) {
            if (day === a.day || day === b.day) continue;
            if (curOnDay(day) + 2 > cap) continue;
            const curPs = (teacherDay[t][day] || []).map(o => o.periodIdx);
              // prefer morning (0-1) or evening (2-3) blocks;
              // crossing midday (1-2) is allowed only as last resort
              const halfDaySlots = [];
              const crossSlots = [];
              for (let pp = 0; pp < periods.length - 1; pp++) {
                if (isCleanHalfDay(pp, pp + 1)) halfDaySlots.push(pp);
                else crossSlots.push(pp);
              }
              const slotOrder = halfDaySlots.concat(crossSlots);
              for (const p of slotOrder) {
                if (!canPlace(a, day, p) || !canPlace(b, day, p + 1)) continue;
                if (!contiguous(curPs.concat(p, p + 1))) continue;
                if (!groupOkAdd(a, day, p) || !groupOkAdd(b, day, p + 1)) continue;
                if (!groupOkRemove(a, a.day) || !groupOkRemove(b, b.day)) continue;
                removeSession(a); removeSession(b);
                const ok = placeSession(a, day, p) && placeSession(b, day, p + 1);
                if (ok) moved = true;
                break;
              }
          }
        }
      }
    });
    if (!moved) break;
  }
}

function autoRooms(settings, tasks) {
  // estimate parallel need: rough upper bound = ceil(total sessions / (days*periods)) + margin
  const slots = settings.days.length * settings.periods.length;
  const n = Math.max(1, Math.ceil(tasks.length / Math.max(1, slots)) + 2);
  const list = [];
  for (let i = 1; i <= n; i++) list.push("Salle " + i);
  return list;
}

function scheduleQuality(placed) {
  // Lower is better: penalises internal gaps inside a daily block (group or
  // teacher), blocks that grow past a half-day, and — above all — teacher
  // days with a single isolated session, so among equally-complete runs the
  // structurally tidiest one is kept: groups on half-days, teachers in 4h
  // consecutive pairs.
  const addBlocks = keyfn => {
    const blocks = {};
    placed.forEach(s => {
      const key = keyfn(s);
      const b = blocks[key] = blocks[key] || { min: s.periodIdx, max: s.periodIdx, n: 0 };
      b.n++;
      if (s.periodIdx < b.min) b.min = s.periodIdx;
      if (s.periodIdx > b.max) b.max = s.periodIdx;
    });
    return Object.values(blocks);
  };
  let q = 0;
  addBlocks(s => s.semester + "|" + s.groups[0] + "|" + s.day).forEach(b => {
    if (b.n > 1) q += (b.max - b.min + 1 - b.n) * 10; // empty period inside the block
    if (b.n > 2) q += (b.n - 2) * 5;                   // grew past a half-day
  });
  addBlocks(s => s.teacher + "|" + s.day).forEach(b => {
    if (b.n > 1) q += (b.max - b.min + 1 - b.n) * 10;  // empty period inside the block
    if (b.n === 1) q += 4;                             // isolated single session: teacher should teach in pairs
    else if (b.n > 2) q += (b.n - 2) * 5;              // 3+ periods penalised
    // teacher blocks that cross the midday boundary (periods 1-2) are
    // strongly discouraged — sessions should stay within morning or evening
    if (b.n >= 2 && crossesMidday(b.min, b.max)) q += 8;
  });
  return q;
}

App.generateSchedule = function (attempts) {
  const tasks = App.buildSessionTasks();
  const settings = App.state.settings;
  attempts = attempts || 40;

  let best = null;
  for (let i = 0; i < attempts; i++) {
    const result = App.runSchedulerAttempt(tasks, settings);
    const quality = scheduleQuality(result.placed);
    if (!best ||
        result.unplaced.length < best.unplaced.length ||
        (result.unplaced.length === best.unplaced.length && quality < best.quality)) {
      best = result;
      best.quality = quality;
      if (best.unplaced.length === 0 && best.quality === 0) break;
    }
  }

  App.state.schedule = {
    sessions: best.placed,
    conflicts: best.unplaced,
    totalTasks: tasks.length
  };
  return App.state.schedule;
};
