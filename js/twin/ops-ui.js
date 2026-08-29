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
    fill.style.background = p >= 50 ? "#D93025" : p >= 22 ? "#F29900" : "#9D00F5";
    row.querySelector(".pc").textContent = p + "%";
    row.classList.toggle("hot", top[0] && top[0].i === i && p >= 40);
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
  $("fIF").classList.toggle("show", w.suspicious || w.confirmed);
  $("fAE").classList.toggle("show", w.confirmed);
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
  mc = monteCarlo(line, { rolls: 48, horizon: 24, seed: 21 + line.t });
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
  paintRisks();
  paintWeld();
  paintRiskBodies();
  paintDark();
  paintEvents();
  paintClock();
  if (view === "manager") paintManager();
  if (view === "leadership") paintLeadership();
  const top = mc.bottleneck.indexOf(Math.max(...mc.bottleneck));
  if (mc.bottleneck[top] >= 50 && line.injected.name === "s3_slow_weld") {
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
}

function submitAsk(q) {
  const question = (q || $("askq").value || "").trim();
  if (!question) return;
  $("askq").value = question;
  const a = ask(line, question);
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
  $("phase").textContent = "Maintenance window: weld cell re-tuned. Retrofit only when the line is already down.";
  log("maintenance window · S3 recovered · still no PLC write", "good");
  $("alert").classList.remove("show");
  paintClock();
  paintEvents();
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

document.addEventListener("keydown", (e) => {
  if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
  if (e.key === "1") setView("supervisor");
  if (e.key === "2") setView("manager");
  if (e.key === "3") setView("leadership");
});

reset();
runLoop();
setView("supervisor");
