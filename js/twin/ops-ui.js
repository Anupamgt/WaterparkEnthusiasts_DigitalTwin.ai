import {
  CAP,
  GHOST_HORIZON,
  SHOPS,
  STATION_META,
  applyScenario,
  bodiesAtRisk,
  coverageMap,
  forecastGhost,
  freshLine,
  inferDark,
  leadershipCase,
  monteCarlo,
  mulberry32,
  recommendNextSensor,
  scoreWeld,
  stationStatus,
  summarizeShift,
  tick,
} from "./engine.js";
import { ask } from "./copilot.js";
import {
  BOTTLENECK_PCT,
  DEFER_REASONS,
  DISMISS_REASONS,
  REASON_CODES,
  applySla,
  auditRows,
  decide,
  freshBoard,
  freezeRule,
  logLine,
  openTicket,
  propose,
  shouldPropose,
} from "./tickets.js";

const COLORS = {
  busy: "#188038",
  slow: "#D93025",
  starved: "#F29900",
  blocked: "#6E6880",
};
const STATUS_LABEL = {
  busy: "RUNNING",
  slow: "SLOW",
  starved: "STARVED",
  blocked: "BLOCKED",
};

const PRESETS = [
  "When does the next bottleneck form?",
  "What happens if Station 4 runs 15% slower on night shift?",
  "Where should the next sensor go?",
  "Is the weld drifting?",
  "Which bodies are at risk until inspect?",
  "What is the false alarm vs QC grade?",
  "Write a PLC setpoint to slow Station 3",
];

const $ = (id) => document.getElementById(id);

let line = freshLine();
let rng = mulberry32(2026);
let ghostRng = mulberry32(7);
let speed = 1;
let paused = false;
let timer = null;
let view = "supervisor";
let mc = { bottleneck: STATION_META.map(() => 0), when: [], conf: [], meanTp: 0, rolls: 0, horizon: 0 };
let lastMcAt = -999;
const fired = new Set();

let notes = [];
let board = freshBoard();
let lastAsk = null;
let pending = { slot: null, verb: null };

function snapshotRiskIds() {
  return bodiesAtRisk(line).map((b) => b.id).sort();
}

function log(msg, cls) {
  if (fired.has(msg)) return;
  fired.add(msg);
  notes.push({ t: line.t, msg, cls });
  if (notes.length > 12) notes.shift();
}

function paintEvents() {
  const el = $("log");
  if (!el) return;
  const rows = [];
  notes.forEach((n) => {
    rows.push({ t: n.t, text: n.msg, cls: n.cls || "" });
  });
  line.events.slice(-8).forEach((e) => {
    const extra =
      e.evt === "qc"
        ? `qc ${e.pass ? "PASS" : "FAIL"}${e.flagged ? " · was flagged" : ""}`
        : `${e.evt}${e.cycle_s ? ` ${e.cycle_s}s` : ""}`;
    rows.push({
      t: e.ts,
      text: `${e.st} ${extra} ${e.body || ""}`.trim(),
      cls: e.evt === "qc" ? (e.pass ? "good" : "hot") : e.st === "S3" ? "tw" : "",
    });
  });
  rows.sort((a, b) => a.t - b.t);
  el.innerHTML = rows
    .slice(-10)
    .map((r) => `<div class="${r.cls}">t=${String(r.t).padStart(3, " ")}s  ${r.text}</div>`)
    .join("");
}

function buildShops() {
  const host = $("shops");
  host.innerHTML = "";
  for (const shop of SHOPS) {
    const stations = STATION_META.filter((s) => s.shop === shop);
    const wrap = document.createElement("section");
    wrap.className = "shop";
    wrap.innerHTML =
      `<div class="shop-h"><b>${shop}</b><span>${stations.length} stations</span></div>` +
      `<div class="lane ghost" data-shop="${shop}" data-kind="ghost"></div>` +
      `<div class="lane floor" data-shop="${shop}" data-kind="floor"></div>`;
    const ghost = wrap.querySelector(".ghost");
    const floor = wrap.querySelector(".floor");
    stations.forEach((s, idx) => {
      ghost.appendChild(chip(s, true));
      floor.appendChild(chip(s, false));
      if (idx < stations.length - 1) floor.appendChild(bufferEl(s.id + 1));
    });
    host.appendChild(wrap);
  }
}

function chip(meta, ghost) {
  const el = document.createElement("div");
  el.className = "chip" + (ghost ? " is-ghost" : "") + (meta.sensed ? "" : " is-dark");
  el.dataset.id = String(meta.id);
  el.innerHTML =
    `<span class="nm">${meta.name}</span>` +
    `<span class="role">${meta.role}${meta.sensed ? "" : " · dark"}</span>` +
    `<span class="st">—</span>` +
    `<span class="ci"></span>` +
    `<span class="body"></span>`;
  return el;
}

function bufferEl(bufIndex) {
  const el = document.createElement("div");
  el.className = "buf";
  el.dataset.buf = String(bufIndex);
  el.innerHTML = Array.from({ length: CAP }, () => "<i></i>").join("");
  return el;
}

function paintLane(kind, statuses, inferred, ghostLine) {
  const src = kind === "ghost" ? ghostLine : line;
  document.querySelectorAll(`.lane.${kind} .chip`).forEach((el) => {
    const i = Number(el.dataset.id);
    const status = statuses[i];
    const s = src.stations[i];
    const inf = inferred[i];
    el.style.setProperty("--chip", COLORS[status] || COLORS.busy);
    el.querySelector(".st").textContent = STATUS_LABEL[status] || status;
    el.querySelector(".body").textContent = s.body ? s.body.id : "";
    const ci = el.querySelector(".ci");
    if (!s.sensed && inf) {
      ci.textContent = `${inf.mean.toFixed(1)}s [${inf.lo.toFixed(1)}–${inf.hi.toFixed(1)}]`;
    } else {
      ci.textContent = s.lastCycle ? `${s.lastCycle.toFixed(1)}s` : "";
    }
  });
}

function paintBuffers() {
  document.querySelectorAll(".buf").forEach((el) => {
    const i = Number(el.dataset.buf);
    const fill = line.buf[i] || 0;
    [...el.querySelectorAll("i")].forEach((cell, b) => {
      cell.classList.toggle("on", b < fill);
    });
  });
}

function paintRisks() {
  const host = $("risks");
  if (!host.dataset.ready) {
    host.innerHTML = STATION_META.map(
      (s) =>
        `<div class="riskrow" data-i="${s.id}"><span class="nm">${s.name}</span>` +
        `<div class="riskbar"><div class="riskfill"></div></div>` +
        `<span class="pc">0%</span></div>`
    ).join("");
    host.dataset.ready = "1";
  }
  const top = mc.bottleneck.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p);
  host.querySelectorAll(".riskrow").forEach((row) => {
    const i = Number(row.dataset.i);
    const p = mc.bottleneck[i] || 0;
    const fill = row.querySelector(".riskfill");
    fill.style.width = p + "%";
    fill.style.background = p >= BOTTLENECK_PCT ? "#D93025" : p >= 22 ? "#F29900" : "#9D00F5";
    row.querySelector(".pc").textContent = p + "%";
    row.classList.toggle("hot", top[0] && top[0].i === i && p >= BOTTLENECK_PCT);
  });
}

function paintWeld() {
  const w = scoreWeld(line);
  const samples = line.weld;
  const poly = $("wave");
  if (samples.length) {
    const pts = samples
      .slice(-48)
      .map((y, i, arr) => {
        const x = arr.length <= 1 ? 0 : (i * 300) / (arr.length - 1);
        const yy = Math.max(6, Math.min(90, y));
        return `${x},${yy}`;
      })
      .join(" ");
    poly.setAttribute("points", pts);
  }
  $("fIF").classList.toggle("show", w.suspicious || w.confirmed || w.confirmedRaw);
  $("fAE").classList.toggle("show", w.confirmed);
  if (w.frozen) $("fAE").textContent = "Autoencoder muted · manager freeze";
  else $("fAE").textContent = "Autoencoder: drift confirmed";
}

function paintRiskBodies() {
  const risk = bodiesAtRisk(line);
  const host = $("atrisk");
  $("atrisk-count").textContent = String(risk.length);
  if (!risk.length) {
    host.innerHTML = "<div class='empty'>No bodies carrying a weld flag or latent defect.</div>";
    return;
  }
  host.innerHTML = risk
    .map(
      (b) =>
        `<div class="risk-body"><b>${b.id}</b> <span>${b.modelName}</span>` +
        `<em>${b.at}</em> ${b.flagged ? "<i class='tag'>flagged</i>" : "<i class='tag latent'>latent</i>"}</div>`
    )
    .join("");
}

function paintDark() {
  const inf = inferDark(line);
  const host = $("darklist");
  host.innerHTML = inf
    .filter((s) => s.dark)
    .map(
      (s) =>
        `<div class="darkrow"><b>${s.name}</b> ${s.shop} ${s.role}` +
        `<span>${s.mean.toFixed(1)} s · 80% CI ${s.lo.toFixed(1)}–${s.hi.toFixed(1)}</span></div>`
    )
    .join("");
}

function renderTicketBar(host, ticket, actor) {
  if (!host) return;
  if (!ticket) {
    host.innerHTML = `<div class="idle">No open ticket. Twin proposes when evidence crosses the line.</div>`;
    return;
  }
  const waiting = pending.slot === host.id && pending.verb;
  const reasons = waiting
    ? (pending.verb === "dismiss" ? DISMISS_REASONS : DEFER_REASONS)
        .map((c) => `<button type="button" data-reason="${c}" title="${REASON_CODES[c]}">${c}</button>`)
        .join("")
    : "";
  host.innerHTML =
    `<div class="tid">${ticket.id} · ${ticket.type} · ${ticket.severity} · ${ticket.state}</div>` +
    `<div class="dnote">${ticket.advisory}</div>` +
    (ticket.state === "proposed" || ticket.state === "acked"
      ? `<div class="verbs">
          <button type="button" class="accept" data-verb="accept" data-id="${ticket.id}" data-actor="${actor}">Accept</button>
          <button type="button" data-verb="defer" data-id="${ticket.id}" data-actor="${actor}">Defer</button>
          <button type="button" class="dismiss" data-verb="dismiss" data-id="${ticket.id}" data-actor="${actor}">Dismiss</button>
        </div>` + (reasons ? `<div class="reasons">${reasons}</div>` : "")
      : `<div class="idle">${ticket.decision}${ticket.reason_code ? " · " + ticket.reason_code : ""}</div>`);
}

function paintHitl() {
  const bn = openTicket(board, "bottleneck");
  const weld =
    openTicket(board, "weld_confirmed", 2) ||
    openTicket(board, "weld_suspicious", 2);
  renderTicketBar($("bn-ticket"), bn, "supervisor");
  renderTicketBar($("weld-ticket"), weld, "supervisor");
  renderTicketBar($("site-ticket"), openTicket(board, "site_go"), "leadership");
  const logEl = $("hitl-log");
  if (logEl) {
    const rows = board.tickets.slice(-10).map((t) => {
      const cls = t.state === "acted" ? "acted" : t.state === "dismissed" ? "dismissed" : t.state === "deferred" ? "deferred" : "";
      return `<div class="${cls}">${logLine(t, t.decidedT ?? t.createdT)}</div>`;
    });
    logEl.innerHTML = rows.join("") || "<div>No tickets yet.</div>";
  }
  if ($("missed-sla")) $("missed-sla").textContent = String(board.missedSla);
  if ($("queue-list")) {
    $("queue-list").textContent = board.queuedWindows.length
      ? "Queued (not installed): " + board.queuedWindows.join(", ")
      : "Window backlog empty.";
  }
  if ($("site-go-state")) {
    $("site-go-state").textContent = board.siteGo
      ? `Leadership: ${board.siteGo}. Priors copy; freeze thresholds stay local.`
      : "No leadership decision yet.";
  }
}

function proposeTickets() {
  const top = mc.bottleneck.indexOf(Math.max(...mc.bottleneck));
  const pct = mc.bottleneck[top] || 0;
  if (pct >= BOTTLENECK_PCT && shouldPropose(board, "bottleneck", top, line.t)) {
    const meta = STATION_META[top];
    propose(board, {
      type: "bottleneck",
      severity: "act_now",
      station: top,
      station_name: meta.name,
      t: line.t,
      tool: "run_forecast",
      rolls: mc.rolls,
      advisory: `${meta.name} (${meta.shop} ${meta.role}) is the constraint in ${pct}% of ${mc.rolls} rollouts. Advisory: pre-stage the downstream buffer and shift one operator. The twin does not write the cell.`,
    });
    log(`twin ALERT: ${meta.name} constraint · ticket proposed`, "tw");
  }
  const w = scoreWeld(line);
  if (w.suspicious && shouldPropose(board, "weld_suspicious", 2, line.t)) {
    propose(board, {
      type: "weld_suspicious",
      severity: "watch",
      station: 2,
      station_name: "S3",
      t: line.t,
      tool: "weld_status",
      body_ids: snapshotRiskIds(),
      advisory: "Isolation Forest: S3 suspicious. Watch the tips. Do not tear the line down.",
    });
    log("ticket weld_suspicious proposed", "tw");
  }
  if (w.confirmed && shouldPropose(board, "weld_confirmed", 2, line.t)) {
    propose(board, {
      type: "weld_confirmed",
      severity: "act_now",
      station: 2,
      station_name: "S3",
      t: line.t,
      tool: "weld_status",
      body_ids: snapshotRiskIds(),
      advisory: "Autoencoder confirms drift. Babysit flagged body IDs until S12 inspect. Rule of ten: accept-on-confirmed is a 1× re-weld, not a 10× tear-up.",
    });
    log("ticket weld_confirmed proposed", "hot");
  }
  if (!openTicket(board, "site_go") && !board.siteGo && line.t >= 8) {
    propose(board, {
      type: "site_go",
      severity: "info",
      t: line.t,
      sla: null,
      advisory: "Copy the playbook to Shop B with Shop A priors as the Bayesian start. Dismiss if Shop B has no inspect gate.",
    });
  }
}

function onTicketClick(e) {
  const btn = e.target.closest("button");
  if (!btn) return;
  const host = e.currentTarget;
  if (btn.dataset.reason) {
    const { id, verb, actor } = pending;
    if (!id || !verb) return;
    applyDecision(id, verb, actor, btn.dataset.reason);
    pending = { slot: null, verb: null };
    return;
  }
  const verb = btn.dataset.verb;
  const id = btn.dataset.id;
  const actor = btn.dataset.actor;
  if (!verb || !id) return;
  if (verb === "accept") {
    applyDecision(id, "accept", actor, null);
    pending = { slot: null, verb: null };
    return;
  }
  pending = { slot: host.id, verb, id, actor };
  paintHitl();
}

function applyDecision(id, verb, actor, reason) {
  const beforeRisk = snapshotRiskIds();
  const ticket = decide(board, id, { verb, reason_code: reason, actor_role: actor, t: line.t });
  if (ticket.type === "window_work" && verb === "accept") {
    line.queuedWindows = board.queuedWindows.slice();
  }
  if (ticket.type === "window_work" && /freeze/i.test(ticket.advisory || "") && verb === "accept") {
    line.aeFrozen = true;
  }
  log(logLine(ticket, line.t).replace(/^t=\s*\d+s\s+/, ""), ticket.state === "acted" ? "good" : ticket.state === "dismissed" ? "hot" : "tw");
  if (ticket.type === "bottleneck") {
    const afterRisk = snapshotRiskIds();
    const lost = beforeRisk.filter((x) => !afterRisk.includes(x));
    if (lost.length) log("HITL invariant broken: at-risk dropped", "hot");
  }
  paintHitl();
  paintRiskBodies();
  paintWeld();
  paintManager();
  paintLeadership();
}

function paintManager() {
  const shift = summarizeShift(line);
  const cover = coverageMap(line);
  const rec = recommendNextSensor(line);
  $("kpi-jph").textContent = shift.jph.toFixed(0);
  $("kpi-shift").textContent = Math.round(shift.projected).toLocaleString();
  $("kpi-done").textContent = String(shift.completed);
  $("kpi-cover").textContent = cover.pct + "%";
  $("heat").innerHTML = shift.heat
    .map((h) => {
      const pct = Math.round(h.util * 100);
      return (
        `<div class="heatrow ${h.sensed ? "" : "dark"}"><span class="nm">${h.name}</span>` +
        `<span class="shop">${h.shop}</span>` +
        `<div class="riskbar"><div class="riskfill" style="width:${pct}%;background:${pct > 70 ? "#D93025" : "#9D00F5"}"></div></div>` +
        `<span class="pc">${pct}%</span></div>`
      );
    })
    .join("");
  const { tp, fp, fn, tn } = shift.qc;
  $("qc-tp").textContent = String(tp);
  $("qc-fp").textContent = String(fp);
  $("qc-fn").textContent = String(fn);
  $("qc-tn").textContent = String(tn);
  $("qc-fa").textContent = shift.falseAlarmPct + "%";
  $("qc-catch").textContent = shift.catchPct + "%";
  $("cover-map").innerHTML = cover.stations
    .map(
      (s) =>
        `<div class="cov ${s.dark ? "dark" : "ok"}"><b>${s.name}</b><span>${s.dark ? "dark" : "sensed"}</span></div>`
    )
    .join("");
  $("next-sensor").innerHTML =
    `<b>${rec.name}</b> · uncertainty cut ~${rec.cutPct}%` + `<p>${rec.reason}</p>`;
  const rule = freezeRule(shift);
  if ($("freeze-copy")) $("freeze-copy").textContent = rule.copy;
  const freezeBtn = $("freeze-btn");
  if (freezeBtn) {
    freezeBtn.disabled = !rule.eligible || line.aeFrozen;
    freezeBtn.textContent = line.aeFrozen
      ? "AE confirm frozen until retune window"
      : "Freeze AE confirm until retune window";
  }
  if ($("freeze-state")) {
    $("freeze-state").textContent = line.aeFrozen
      ? "Isolation Forest still shows watch. Autoencoder confirm is muted."
      : "AE confirm is live.";
  }
  if ($("mapping")) {
    $("mapping").innerHTML = cover.stations
      .map((s) =>
        s.dark
          ? `<span class="mapchip dark">${s.name} unsigned · no sensor</span>`
          : `<span class="mapchip ok">${s.name} mapping signed</span>`
      )
      .join("");
  }
  if ($("missed-sla")) $("missed-sla").textContent = String(board.missedSla);
  if ($("queue-list")) {
    $("queue-list").textContent = board.queuedWindows.length
      ? "Queued (not installed): " + board.queuedWindows.join(", ")
      : "Window backlog empty.";
  }
}

function paintLeadership() {
  const L = leadershipCase(line);
  const shift = summarizeShift(line);
  $("lead-cover").textContent = `${L.sensedPct}% sensed · ${L.dark} dark`;
  $("lead-remain").textContent = "₹" + (L.remainingInr / 1000).toFixed(0) + "k";
  $("lead-site").textContent = "₹" + (L.perSiteInr / 1000).toFixed(0) + "k";
  $("lead-three").textContent = "₹" + (L.threeSiteInr / 100000).toFixed(2) + " lakh";
  $("lead-jph").textContent = shift.jph.toFixed(0) + " bodies/h";
  $("lead-qc").textContent = `catch ${shift.catchPct}% · false alarms ${shift.falseAlarmPct}%`;
  const i = mc.bottleneck.indexOf(Math.max(...mc.bottleneck));
  $("lead-constraint").textContent = STATION_META[i]
    ? `${STATION_META[i].name} ${STATION_META[i].shop} · ${mc.bottleneck[i] || 0}% of rollouts`
    : "—";
}

function paintClock() {
  $("clock").textContent = `t = ${line.t} s · ${line.completed} out`;
  $("scenario").textContent = line.injected.name === "s3_slow_weld" ? "S3 slow + weld drift" : line.injected.name;
}

function storyBeats() {
  if (line.t === 16) {
    applyScenario(line, "s3_slow_weld");
    $("phase").textContent =
      "S3 weld current is drifting and the cell is slowing. The floor cannot see S4 or S8. The twin can still bound them.";
    log("inject S3 slow ×2.2 + weld drift", "hot");
  }
  if (line.t === 28) log("Isolation Forest watching S3 weld current", "tw");
  if (line.t === 44) log("bodies with latent weld defects still short of S12 inspect", "tw");
  const w = scoreWeld(line);
  if (w.confirmed) log("autoencoder confirms weld drift · hold for QC grade", "hot");
  if (line.t === 90) {
    $("phase").textContent =
      "Defects welded at Body only surface at Final inspect. Alerts stay advisory until the maintenance window.";
  }
}

function maybeMc() {
  if (line.t - lastMcAt < 10 && lastMcAt >= 0) return;
  lastMcAt = line.t;
  mc = monteCarlo(line, { rolls: 180, horizon: 24, seed: 21 + line.t });
}

function step() {
  if (paused) return;
  tick(line, rng, true);
  storyBeats();
  const inferred = inferDark(line);
  const ghost = forecastGhost(line, GHOST_HORIZON, ghostRng);
  const liveStatus = stationStatus(line);
  const ghostStatus = stationStatus(ghost);
  paintLane("floor", liveStatus, inferred, line);
  paintLane("ghost", ghostStatus, inferred, ghost);
  paintBuffers();
  maybeMc();
  proposeTickets();
  const timed = applySla(board, line.t);
  timed.forEach((t) => log(`SLA timeout · ${t.id} deferred sla_timeout · never auto-accept`, "hot"));
  paintRisks();
  paintWeld();
  paintRiskBodies();
  paintDark();
  paintEvents();
  paintClock();
  paintHitl();
  if (view === "manager") paintManager();
  if (view === "leadership") paintLeadership();
  const top = mc.bottleneck.indexOf(Math.max(...mc.bottleneck));
  if (mc.bottleneck[top] >= BOTTLENECK_PCT && line.injected.name === "s3_slow_weld") {
    $("alert").classList.add("show");
  } else {
    $("alert").classList.remove("show");
  }
  if (line.t >= 280) reset();
}

function reset() {
  line = freshLine();
  rng = mulberry32(2026);
  ghostRng = mulberry32(7);
  lastMcAt = -999;
  fired.clear();
  notes = [];
  board = freshBoard();
  lastAsk = null;
  pending = { slot: null, verb: null };
  $("log").innerHTML = "";
  $("alert").classList.remove("show");
  $("fIF").classList.remove("show");
  $("fAE").classList.remove("show");
  $("wave").setAttribute("points", "");
  $("phase").textContent =
    "Steady state. 12 stations in Body, Paint, and Final. Eight sensed, four dark. Advisory only.";
  log("line up · mixed-model A/B · S4 S6 S8 S11 dark", "good");
  maybeMc();
  const inferred = inferDark(line);
  paintLane("floor", stationStatus(line), inferred, line);
  paintLane("ghost", stationStatus(line), inferred, line);
  paintBuffers();
  paintRisks();
  paintRiskBodies();
  paintDark();
  paintEvents();
  paintClock();
  paintManager();
  paintLeadership();
  paintHitl();
}

function runLoop() {
  if (timer) clearInterval(timer);
  timer = setInterval(step, Math.max(70, 280 / speed));
}

function setView(next) {
  view = next;
  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.view === view);
  });
  document.querySelectorAll(".board").forEach((el) => {
    el.classList.toggle("on", el.dataset.board === view);
  });
  const floor = view === "supervisor";
  $("shops").hidden = !floor;
  const legend = document.querySelector(".legendrow");
  if (legend) legend.hidden = !floor;
  if (view === "manager") paintManager();
  if (view === "leadership") paintLeadership();
  paintHitl();
}

function submitAsk(q) {
  const question = (q || $("askq").value || "").trim();
  if (!question) return;
  $("askq").value = question;
  const a = ask(line, question);
  lastAsk = a;
  $("runline").textContent = a.runLine;
  $("answer").textContent = a.answer;
}

buildShops();
document.querySelectorAll("[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => setView(btn.dataset.view));
});
$("pp").onclick = (e) => {
  paused = !paused;
  e.target.textContent = paused ? "Play" : "Pause";
};
$("rs").onclick = () => reset();
$("sp").onclick = (e) => {
  speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
  e.target.textContent = "Speed " + speed + "x";
  runLoop();
};
$("inj").onclick = () => {
  applyScenario(line, "s3_slow_weld");
  $("phase").textContent = "Manual inject: S3 slow + weld drift. Twin stays advisory — no PLC write.";
  log("operator inject S3 slow + weld drift", "hot");
  paintClock();
  paintEvents();
};
$("heal").onclick = () => {
  applyScenario(line, "recover");
  line.aeFrozen = false;
  $("phase").textContent = "Maintenance window: weld cell re-tuned. Retrofit only when the line is already down.";
  log("maintenance window · S3 recovered · still no PLC write", "good");
  $("alert").classList.remove("show");
  paintClock();
  paintEvents();
  paintWeld();
  paintManager();
};
$("askgo").onclick = () => submitAsk();
$("askq").addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitAsk();
});
$("presets").innerHTML = PRESETS.map((q) => `<button type="button" class="chip-btn">${q}</button>`).join("");
$("presets").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) submitAsk(b.textContent);
});

["bn-ticket", "weld-ticket", "site-ticket"].forEach((id) => {
  const el = $(id);
  if (el) el.addEventListener("click", onTicketClick);
});

$("ask-promote").onclick = () => {
  if (!lastAsk) {
    $("answer").textContent = "Ask first, then promote the evidence to a ticket.";
    return;
  }
  if (lastAsk.intent.tool === "refuse_plc") {
    $("answer").textContent = lastAsk.answer + " Nothing to promote — no actuator ticket exists.";
    return;
  }
  const type = lastAsk.promoteType || "what_if";
  const station = lastAsk.intent.args?.station ?? null;
  const meta = station != null ? STATION_META[station] : null;
  const t = propose(board, {
    type,
    severity: type === "bottleneck" || type === "weld_confirmed" ? "act_now" : "watch",
    station,
    station_name: meta?.name || lastAsk.out?.data?.name || null,
    t: line.t,
    tool: lastAsk.intent.tool,
    rolls: lastAsk.out.rolls,
    ms: lastAsk.out.ms,
    advisory: lastAsk.answer,
  });
  log(`promoted Ask → ${t.id} ${t.type}`, "tw");
  paintHitl();
};

$("ask-misread").onclick = () => {
  const t = propose(board, {
    type: lastAsk?.promoteType || "what_if",
    severity: "info",
    t: line.t,
    tool: lastAsk?.intent.tool || "run_forecast",
    advisory: lastAsk?.answer || "Copilot answer marked as a misread.",
  });
  decide(board, t.id, { verb: "dismiss", reason_code: "copilot_misread", actor_role: "supervisor", t: line.t });
  log("supervisor dismiss copilot_misread · re-ask", "hot");
  paintHitl();
};

$("queue-sensor").onclick = () => {
  const rec = recommendNextSensor(line);
  const sensedBefore = line.stations.filter((s) => s.sensed).length;
  const t = propose(board, {
    type: "window_work",
    severity: "watch",
    station: rec.station,
    station_name: rec.name,
    t: line.t,
    tool: "recommend_sensor",
    sla: null,
    advisory: `Queue ${rec.name} for the next maintenance window. ${rec.reason} Does not install live.`,
  });
  decide(board, t.id, { verb: "accept", actor_role: "manager", t: line.t });
  const sensedAfter = line.stations.filter((s) => s.sensed).length;
  if (sensedAfter !== sensedBefore) log("HITL invariant broken: live install", "hot");
  log(`manager queued ${rec.name} for window · sensed count still ${sensedAfter}`, "good");
  paintHitl();
  paintManager();
};

$("freeze-btn").onclick = () => {
  const rule = freezeRule(summarizeShift(line));
  if (!rule.eligible || line.aeFrozen) return;
  const t = propose(board, {
    type: "window_work",
    severity: "watch",
    station: 2,
    station_name: "S3",
    t: line.t,
    sla: null,
    advisory: "freeze AE confirm until retune window. Isolation Forest remains a watch.",
  });
  decide(board, t.id, { verb: "accept", actor_role: "manager", t: line.t });
  line.aeFrozen = true;
  log("manager freeze AE confirm · IF still watch", "tw");
  paintWeld();
  paintHitl();
  paintManager();
};

$("export-audit").onclick = () => {
  const rows = auditRows(board);
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "hitl-audit.json";
  a.click();
  URL.revokeObjectURL(a.href);
  log(`exported ${rows.length} HITL audit rows`, "good");
};

document.addEventListener("keydown", (e) => {
  if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
  if (e.key === "1") setView("supervisor");
  if (e.key === "2") setView("manager");
  if (e.key === "3") setView("leadership");
});

reset();
runLoop();
setView("supervisor");
