/**
 * Pedagogical Live-twin chapter. Same 12-station engine as Ops,
 * scripted inject / recover so the story page stays watchable.
 */
import {
  CAP,
  GHOST_HORIZON,
  SHOPS,
  STATION_META,
  applyScenario,
  argmaxShare,
  forecastGhost,
  freshLine,
  monteCarlo,
  mulberry32,
  scoreWeld,
  stationStatus,
  tick,
} from "./engine.js";

const COLORS = {
  busy: "#188038",
  slow: "#D93025",
  starved: "#F29900",
  blocked: "#6E6880",
};
const LABEL = { busy: "RUNNING", slow: "SLOW", starved: "STARVED", blocked: "BLOCKED" };
const $ = (id) => document.getElementById(id);

let line = freshLine();
let rng = mulberry32(2026);
let ghostRng = mulberry32(7);
let speed = 1;
let paused = false;
let timer = null;
let mc = { bottleneck: STATION_META.map(() => 0) };
let lastMcAt = -999;
const fired = new Set();

function log(msg, cls) {
  const key = `${line.t}:${msg}`;
  if (fired.has(key)) return;
  fired.add(key);
  const el = $("log");
  const d = document.createElement("div");
  if (cls) d.className = cls;
  d.textContent = `t=${String(line.t).padStart(3, " ")}s  ${msg}`;
  el.appendChild(d);
  while (el.children.length > 8) el.removeChild(el.firstChild);
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
      `<div class="lane ghost" data-kind="ghost"></div>` +
      `<div class="lane floor" data-kind="floor"></div>`;
    const ghost = wrap.querySelector(".ghost");
    const floor = wrap.querySelector(".floor");
    stations.forEach((s, idx) => {
      ghost.appendChild(chip(s, true));
      floor.appendChild(chip(s, false));
      if (idx < stations.length - 1) {
        const buf = document.createElement("div");
        buf.className = "buf";
        buf.dataset.buf = String(s.id + 1);
        buf.innerHTML = Array.from({ length: CAP }, () => "<i></i>").join("");
        floor.appendChild(buf);
      }
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
    `<span class="st">—</span>`;
  return el;
}

function paintLanes(kind, statuses, src) {
  document.querySelectorAll(`.lane.${kind} .chip`).forEach((el) => {
    const i = Number(el.dataset.id);
    const status = statuses[i];
    el.style.setProperty("--chip", COLORS[status] || COLORS.busy);
    el.querySelector(".st").textContent = LABEL[status] || status;
    if (src.stations[i].body) el.querySelector(".st").textContent += ` · ${src.stations[i].body.id}`;
  });
}

function paintBuffers() {
  document.querySelectorAll(".buf").forEach((el) => {
    const fill = line.buf[Number(el.dataset.buf)] || 0;
    [...el.querySelectorAll("i")].forEach((cell, b) => cell.classList.toggle("on", b < fill));
  });
}

function paintRisks() {
  const host = $("risks");
  if (!host.dataset.ready) {
    host.innerHTML = STATION_META.map(
      (s) =>
        `<div class="riskrow"><span class="nm">${s.name}</span>` +
        `<div class="riskbar"><div class="riskfill" data-i="${s.id}"></div></div>` +
        `<span class="pc" data-i="${s.id}">0%</span></div>`
    ).join("");
    host.dataset.ready = "1";
  }
  host.querySelectorAll(".riskfill").forEach((fill) => {
    const p = mc.bottleneck[Number(fill.dataset.i)] || 0;
    fill.style.width = p + "%";
    fill.style.background = p >= 60 ? "#D93025" : p >= 22 ? "#F29900" : "#9D00F5";
  });
  host.querySelectorAll(".pc").forEach((pc) => {
    pc.textContent = (mc.bottleneck[Number(pc.dataset.i)] || 0) + "%";
  });
}

function paintWeld() {
  const w = scoreWeld(line);
  const samples = line.weld;
  if (samples.length) {
    const pts = samples
      .slice(-48)
      .map((y, i, arr) => {
        const x = arr.length <= 1 ? 0 : (i * 300) / (arr.length - 1);
        return `${x},${Math.max(6, Math.min(90, y))}`;
      })
      .join(" ");
    $("wave").setAttribute("points", pts);
  }
  $("fIF").classList.toggle("show", w.suspicious || w.confirmed);
  $("fAE").classList.toggle("show", w.confirmed);
}

function maybeMc() {
  if (line.t - lastMcAt < 8 && lastMcAt >= 0) return;
  lastMcAt = line.t;
  mc = monteCarlo(line, { rolls: 48, horizon: 24, seed: 21 + line.t });
}

function storyBeats() {
  if (line.t === 16) {
    applyScenario(line, "s3_slow_weld");
    $("phase").textContent =
      "S3 weld current is drifting and the cell is slowing. The floor cannot see S4 or S8. The ghost already can.";
    log("inject S3 slow ×2.2 + weld drift", "hot");
  }
  if (line.t === 22) log("Isolation Forest: S3 weld suspicious", "tw");
  if (line.t === 36) log("autoencoder confirms drift · bodies stay at risk until S12", "tw");
  const top = argmaxShare(mc.bottleneck);
  if (mc.bottleneck[top] >= 60 && line.injected.name === "s3_slow_weld") {
    $("alert").classList.add("show");
    log(`twin ALERT: ${STATION_META[top].name} constraint · pre-stage downstream buffer`, "tw");
  }
  if (line.t === 90) {
    $("phase").textContent =
      "Defects welded at Body only surface at Final inspect. The twin is advisory — Recover waits for a window.";
  }
  if (line.t === 140) {
    applyScenario(line, "recover");
    $("alert").classList.remove("show");
    $("phase").textContent =
      "Maintenance window: weld cell re-tuned. Hardware only when the line is already down. The ghost turns green first.";
    log("maintenance window · S3 recovered · still no PLC write", "good");
  }
}

function step() {
  if (paused) return;
  tick(line, rng, true);
  maybeMc();
  storyBeats();
  const ghost = forecastGhost(line, GHOST_HORIZON, ghostRng);
  paintLanes("floor", stationStatus(line), line);
  paintLanes("ghost", stationStatus(ghost), ghost);
  paintBuffers();
  paintRisks();
  paintWeld();
  $("clock").textContent = `t = ${line.t} s · ${line.completed} out`;
  if (line.t >= 200) reset();
}

function reset() {
  line = freshLine();
  rng = mulberry32(2026);
  ghostRng = mulberry32(7);
  lastMcAt = -999;
  fired.clear();
  $("log").innerHTML = "";
  $("alert").classList.remove("show");
  $("fIF").classList.remove("show");
  $("fAE").classList.remove("show");
  $("wave").setAttribute("points", "");
  $("phase").textContent =
    "Steady state. 12 stations in Body, Paint, and Final. Eight sensed, four dark. Same engine as Ops.";
  log("line up · mixed-model A/B · S4 S6 S8 S11 dark", "good");
  maybeMc();
  paintLanes("floor", stationStatus(line), line);
  paintLanes("ghost", stationStatus(line), line);
  paintBuffers();
  paintRisks();
  $("clock").textContent = "t = 0 s";
}

function runLoop() {
  if (timer) clearInterval(timer);
  timer = setInterval(step, Math.max(80, 280 / speed));
}

buildShops();
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
reset();
runLoop();
