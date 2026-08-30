/**
 * Advisory HITL tickets. The twin may create `proposed`.
 * Only a human (or SLA timeout) may leave `proposed`.
 * Dismissing a bottleneck never clears weld at-risk bodies.
 */

export const TICKET_TYPES = [
  "bottleneck",
  "weld_suspicious",
  "weld_confirmed",
  "bodies_at_risk",
  "dark_ci",
  "next_sensor",
  "what_if",
  "window_work",
  "site_go",
  "mapping",
  "detectors_vs_floor",
];

export const DISMISS_STREAK = 3;
export const RANK_WORSEN_PP = 15;
export const GRADE_HORIZON = 20;

export const REASON_CODES = {
  mix_shift: "SUV vs sedan mix; posterior catching up",
  dressing_cycle: "Known weld-tip dress; spike is scheduled",
  manual_check_ok: "Operator already looked; cell is fine",
  dark_guess: "Alert leans on a dark-station CI; too wide to act",
  already_handled: "Buffer already pre-staged / operator already moved",
  waiting_window: "Needs hardware work in a maintenance window",
  copilot_misread: "Question was parsed wrong; re-ask",
  sla_timeout: "No ack within SLA — never auto-accept",
  other: "Other (reviewed weekly)",
};

export const DISMISS_REASONS = ["mix_shift", "dressing_cycle", "manual_check_ok", "dark_guess", "copilot_misread", "other"];
export const DEFER_REASONS = ["already_handled", "waiting_window"];

export const FREEZE_FA_PCT = 25;
export const FREEZE_MIN_N = 20;
export const SLA_ACT_NOW = 60;
export const BOTTLENECK_PCT = 60;

export function freshBoard(opts = {}) {
  return {
    date: opts.date || "2026-08-29",
    seq: 0,
    tickets: [],
    missedSla: 0,
    queuedWindows: [],
    siteGo: null,
    mappingSigned: true,
    bnGrade: { tp: 0, fp: 0, fn: 0, tn: 0 },
    lastFnT: -999,
  };
}

export function freezeRule(shift) {
  const n = (shift?.qc?.tp || 0) + (shift?.qc?.fp || 0);
  const faPct = shift?.falseAlarmPct ?? 0;
  const eligible = n >= FREEZE_MIN_N && faPct > FREEZE_FA_PCT;
  const copy =
    n >= FREEZE_MIN_N
      ? faPct > FREEZE_FA_PCT
        ? `FA% ${faPct} exceeds ${FREEZE_FA_PCT}% with n=${n} alerts. Manager may freeze AE confirm until a retune window.`
        : `FA% ${faPct} is inside the ${FREEZE_FA_PCT}% band (n=${n}). Freeze stays off.`
      : `Freeze locked until n≥${FREEZE_MIN_N} graded alerts (now n=${n}). Rule: FA% > ${FREEZE_FA_PCT} with n≥${FREEZE_MIN_N}.`;
  return { n, faPct, thresholdPct: FREEZE_FA_PCT, minN: FREEZE_MIN_N, eligible, copy };
}

export function openTicket(board, type, station = null) {
  return board.tickets.find(
    (t) =>
      t.type === type &&
      (station == null || t.station === station) &&
      (t.state === "proposed" || t.state === "acked")
  );
}

function lastOf(board, type, station) {
  for (let i = board.tickets.length - 1; i >= 0; i--) {
    const t = board.tickets[i];
    if (t.type !== type) continue;
    if (station != null && t.station !== station) continue;
    return t;
  }
  return null;
}

function recentlyClosed(board, type, station, nowT, windowS) {
  const t = lastOf(board, type, station);
  if (!t) return false;
  if (t.state === "proposed" || t.state === "acked") return true;
  if (t.decidedT != null && nowT - t.decidedT < windowS) return true;
  return false;
}

export function dismissCount(board, type, station) {
  return board.tickets.filter(
    (t) => t.type === type && (station == null || t.station === station) && t.state === "dismissed"
  ).length;
}

export function shouldPropose(board, type, station, nowT, extra = {}) {
  if (openTicket(board, type, station)) return false;
  if (type === "bottleneck") {
    const last = lastOf(board, type, station);
    if (!last) return true;
    if (last.state === "proposed" || last.state === "acked") return false;
    if (last.decision === "defer" && last.reason_code !== "sla_timeout") {
      const prev = last.evidence?.pct ?? 0;
      const pct = extra.pct ?? 0;
      return pct >= prev + RANK_WORSEN_PP;
    }
    if (last.decidedT != null && nowT - last.decidedT < 20) return false;
    return true;
  }
  if (type === "weld_suspicious" && recentlyClosed(board, type, station, nowT, 12)) return false;
  if (type === "weld_confirmed" && recentlyClosed(board, type, station, nowT, 12)) return false;
  if (type === "detectors_vs_floor" && recentlyClosed(board, type, station, nowT, 80)) return false;
  return true;
}

export function propose(board, spec) {
  const t = {
    id: `TWIN-${board.date}-${String(++board.seq).padStart(3, "0")}`,
    type: spec.type,
    severity: spec.severity || "watch",
    evidence: spec.evidence || {},
    state: "proposed",
    decision: null,
    reason_code: null,
    reason_text: null,
    actor: "twin",
    actor_role: "twin",
    sla: spec.sla ?? (spec.severity === "act_now" ? SLA_ACT_NOW : null),
    grade: "n/a",
    station: spec.station ?? null,
    station_name: spec.station_name ?? null,
    body_ids: (spec.body_ids || []).slice(),
    advisory: spec.advisory || "",
    createdT: spec.t ?? 0,
    decidedT: null,
    tool: spec.tool || null,
    rolls: spec.rolls ?? 0,
    ms: spec.ms ?? 0,
  };
  board.tickets.push(t);
  return t;
}

export function decide(board, id, { verb, reason_code = null, reason_text = null, actor_role, t }) {
  const ticket = board.tickets.find((x) => x.id === id);
  if (!ticket) throw new Error("unknown ticket " + id);
  if (ticket.state !== "proposed" && ticket.state !== "acked") {
    throw new Error("ticket already left proposed: " + ticket.state);
  }
  if (verb === "dismiss" && !reason_code) {
    throw new Error("dismiss requires a reason_code");
  }
  if (verb === "accept") {
    ticket.state = "acted";
    ticket.decision = "accept";
  } else if (verb === "defer") {
    ticket.state = "deferred";
    ticket.decision = "defer";
    ticket.reason_code = reason_code || "already_handled";
  } else if (verb === "dismiss") {
    ticket.state = "dismissed";
    ticket.decision = "dismiss";
    ticket.reason_code = reason_code;
  } else {
    throw new Error("unknown verb " + verb);
  }
  ticket.reason_text = reason_text;
  ticket.actor_role = actor_role;
  ticket.actor = actor_role;
  ticket.decidedT = t ?? ticket.createdT;
  if (ticket.type === "window_work" && verb === "accept" && ticket.station_name) {
    if (!board.queuedWindows.includes(ticket.station_name)) {
      board.queuedWindows.push(ticket.station_name);
    }
  }
  if (ticket.type === "site_go") {
    board.siteGo = verb === "accept" ? "go" : verb === "defer" ? "defer" : "no-go";
  }
  return ticket;
}

/** Three dismisses of the same type+station in one shift → manager review. */
export function shouldOpenDisagreement(board, ticket) {
  if (ticket.decision !== "dismiss") return false;
  if (ticket.type === "detectors_vs_floor") return false;
  return dismissCount(board, ticket.type, ticket.station) >= DISMISS_STREAK;
}

/** Grade bottleneck tickets after the demo/shop horizon; never mix with weld QC. */
export function gradeBottlenecks(board, outcomeFor, nowT, starvedWithoutTicket) {
  for (const ticket of board.tickets) {
    if (ticket.type !== "bottleneck" || ticket.grade !== "n/a") continue;
    if (nowT - ticket.createdT < GRADE_HORIZON) continue;
    const hit = outcomeFor(ticket.station);
    ticket.grade = hit ? "tp" : "fp";
    board.bnGrade[ticket.grade] += 1;
  }
  if (starvedWithoutTicket && !openTicket(board, "bottleneck")) {
    const recent = lastOf(board, "bottleneck", null);
    const recentlyProposed = recent && nowT - recent.createdT < GRADE_HORIZON + 10;
    if (!recentlyProposed && nowT - (board.lastFnT ?? -999) > GRADE_HORIZON) {
      board.bnGrade.fn += 1;
      board.lastFnT = nowT;
    }
  }
}

export function ack(board, id, actor_role, t) {
  const ticket = board.tickets.find((x) => x.id === id);
  if (!ticket || ticket.state !== "proposed") return ticket;
  ticket.state = "acked";
  ticket.actor_role = actor_role;
  ticket.ackedT = t;
  return ticket;
}

/** SLA timeout is a system defer, never a fake accept. */
export function applySla(board, nowT) {
  const timed = [];
  for (const ticket of board.tickets) {
    if (ticket.state !== "proposed") continue;
    if (ticket.severity !== "act_now" || !ticket.sla) continue;
    if (nowT - ticket.createdT < ticket.sla) continue;
    ticket.state = "deferred";
    ticket.decision = "defer";
    ticket.reason_code = "sla_timeout";
    ticket.actor_role = "system";
    ticket.actor = "system";
    ticket.decidedT = nowT;
    board.missedSla += 1;
    timed.push(ticket);
  }
  return timed;
}

export function auditRows(board) {
  return board.tickets.map((t) => ({
    timestamp: t.decidedT ?? t.createdT,
    ticket_id: t.id,
    type: t.type,
    station: t.station_name,
    body_ids: t.body_ids,
    state: t.state,
    verb: t.decision,
    reason_code: t.reason_code,
    actor_role: t.actor_role,
    evidence_tool: t.tool,
    rolls: t.rolls,
    ms: t.ms,
    grade: t.grade,
    advisory: t.advisory,
  }));
}

export function logLine(ticket, t) {
  const who = ticket.actor_role || "twin";
  const verb = ticket.decision || "proposed";
  const reason = ticket.reason_code ? ` · ${ticket.reason_code}` : "";
  const st = ticket.station_name ? ` ${ticket.station_name}` : "";
  return `t=${String(t).padStart(3, " ")}s  ${who} ${verb} ${ticket.type}${st}${reason}`;
}
