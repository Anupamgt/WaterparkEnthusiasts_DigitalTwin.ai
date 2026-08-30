/**
 * DigitalTwin.ai discrete-event flow twin.
 *
 * Sense: stations emit tiny timestamped events, never video.
 * Mirror: Bayesian cycle-time beliefs, bootstrapped from standard times.
 * Predict: Monte Carlo rollouts + active-period bottleneck ranking;
 *          Isolation Forest + autoencoder on weld current.
 * Dark stations: inferred from flow conservation, shown with a CI.
 *
 * Round 2 plant: 12 stations in Body / Paint / Final, standing in for 30–50.
 * ~70% sensed / ~30% dark. Advisory only — no PLC writes.
 * Deliberately skipped: 3D, MES, PLC, unit-level traceability, closed-loop.
 */

export const N = 12;
export const CAP = 4;
export const PRIOR_MEAN = 4;
export const PRIOR_KAPPA = 4;
export const WELD_INDEX = 2;
export const INSPECT_INDEX = 11;
export const GHOST_HORIZON = 20;
export const SHIFT_HOURS = 8;

export const MODELS = [
  { code: "A", name: "Sedan", cycleMul: 1.0, mix: 0.6 },
  { code: "B", name: "SUV", cycleMul: 1.12, mix: 0.4 },
];

export const STATION_META = [
  { id: 0, name: "S1", role: "stamp", shop: "Body", mean: 4.0 },
  { id: 1, name: "S2", role: "form", shop: "Body", mean: 4.0 },
  { id: 2, name: "S3", role: "weld", shop: "Body", mean: 4.2 },
  { id: 3, name: "S4", role: "bolt", shop: "Body", mean: 3.8 },
  { id: 4, name: "S5", role: "hang", shop: "Body", mean: 3.5 },
  { id: 5, name: "S6", role: "prime", shop: "Paint", mean: 5.0 },
  { id: 6, name: "S7", role: "basecoat", shop: "Paint", mean: 5.0 },
  { id: 7, name: "S8", role: "bake", shop: "Paint", mean: 6.0 },
  { id: 8, name: "S9", role: "clear", shop: "Paint", mean: 4.5 },
  { id: 9, name: "S10", role: "trim", shop: "Final", mean: 4.0 },
  { id: 10, name: "S11", role: "chassis", shop: "Final", mean: 4.2 },
  { id: 11, name: "S12", role: "inspect", shop: "Final", mean: 3.5 },
];

/** ~67% sensed (~70% / ~30% as stated). S4 and S8 are the named dark cells. */
export const DEFAULT_SENSED = [
  true, true, true, false, // Body: S4 bolt dark
  true, false, true, false, // Paint: S6 prime + S8 bake dark
  true, true, false, true, // Final: S11 chassis dark
];

export const SHOPS = ["Body", "Paint", "Final"];

export const SCENARIOS = {
  baseline: { slow: null, drift: false },
  s3_slow_weld: { slow: { station: WELD_INDEX, factor: 2.2 }, drift: true },
  recover: { slow: null, drift: false },
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

export function sampleCycle(mean, sd, rng) {
  const z = Math.sqrt(-2 * Math.log(Math.max(1e-12, rng()))) * Math.cos(2 * Math.PI * rng());
  return clamp(mean + z * sd, 0.8, 30);
}

export function posterior(obs, priorMean = PRIOR_MEAN, priorKappa = PRIOR_KAPPA) {
  const n = obs.length;
  if (n === 0) {
    return { mean: priorMean, sd: 0.45, n: 0, kappa: priorKappa };
  }
  const sum = obs.reduce((a, b) => a + b, 0);
  const mean = (priorKappa * priorMean + sum) / (priorKappa + n);
  const varObs = obs.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, n - 1);
  const sd = Math.sqrt((priorKappa * 0.45 ** 2 + n * Math.max(varObs, 0.04)) / (priorKappa + n));
  return { mean, sd, n, kappa: priorKappa + n };
}

function pickModel(rng) {
  return rng() < MODELS[0].mix ? MODELS[0] : MODELS[1];
}

function mintBody(line, rng) {
  const model = pickModel(rng);
  const body = {
    id: `${model.code}-${line.bodySeq}`,
    seq: line.bodySeq,
    model: model.code,
    modelName: model.name,
    cycleMul: model.cycleMul,
    weldDefect: false,
    weldFlagged: false,
    weldAmps: null,
  };
  line.bodySeq += 1;
  return body;
}

function cloneBody(b) {
  return b ? { ...b } : null;
}

function emptyQc() {
  return { tp: 0, fp: 0, fn: 0, tn: 0, log: [] };
}

export function freshLine(opts = {}) {
  const sensed = opts.sensed || DEFAULT_SENSED.slice();
  const means = opts.means || STATION_META.map((m) => m.mean);
  const stations = STATION_META.map((m, i) => ({
    ...m,
    sensed: !!sensed[i],
    mean: means[i],
    sd: 0.45,
    obs: [],
    busy: false,
    blocked: false,
    timer: 0,
    lastCycle: 0,
    body: null,
    activeTicks: 0,
    longestActive: 0,
    completed: 0,
    busyTicks: 0,
  }));
  return {
    t: 0,
    bodySeq: opts.bodySeq ?? 4182,
    stations,
    buf: Array(N + 1).fill(0),
    parts: Array.from({ length: N + 1 }, () => []),
    events: [],
    completed: 0,
    weld: [],
    qc: emptyQc(),
    injected: { slow: null, drift: false, name: "baseline" },
    aeFrozen: false,
    queuedWindows: [],
  };
}

export function applyScenario(line, name) {
  const spec = SCENARIOS[name] || SCENARIOS.baseline;
  line.injected = {
    name,
    drift: !!spec.drift,
    slow: spec.slow ? { station: spec.slow.station, factor: spec.slow.factor } : null,
  };
  return line;
}

export function cloneLine(line) {
  return {
    t: line.t,
    bodySeq: line.bodySeq,
    stations: line.stations.map((s) => ({
      ...s,
      obs: s.obs.slice(),
      body: cloneBody(s.body),
    })),
    buf: line.buf.slice(),
    parts: line.parts.map((q) => q.map(cloneBody)),
    events: [],
    completed: line.completed,
    weld: line.weld.slice(),
    qc: {
      tp: line.qc.tp,
      fp: line.qc.fp,
      fn: line.qc.fn,
      tn: line.qc.tn,
      log: [],
    },
    injected: {
      name: line.injected.name,
      drift: line.injected.drift,
      slow: line.injected.slow ? { ...line.injected.slow } : null,
    },
    aeFrozen: !!line.aeFrozen,
    queuedWindows: (line.queuedWindows || []).slice(),
  };
}

function meanFor(line, i, body) {
  let m = line.stations[i].mean;
  const slow = line.injected.slow;
  if (slow && slow.station === i) m *= slow.factor;
  if (body && body.cycleMul) m *= body.cycleMul;
  return m;
}

function gradeBody(line, body) {
  const defect = !!body.weldDefect;
  const flagged = !!body.weldFlagged;
  if (defect && flagged) line.qc.tp += 1;
  else if (!defect && flagged) line.qc.fp += 1;
  else if (defect && !flagged) line.qc.fn += 1;
  else line.qc.tn += 1;
  const row = {
    body: body.id,
    model: body.model,
    defect,
    flagged,
    pass: !defect,
    ts: line.t,
  };
  line.qc.log.push(row);
  if (line.qc.log.length > 40) line.qc.log.shift();
  return row;
}

export function tick(line, rng, record = true) {
  const stations = line.stations;
  const n = stations.length;
  line.buf[0] = CAP;

  function unload(i) {
    const s = stations[i];
    const body = s.body;
    s.busy = false;
    s.blocked = false;
    s.completed += 1;
    if (i < n - 1) {
      line.buf[i + 1] += 1;
      line.parts[i + 1].push(body);
    } else {
      line.completed += 1;
      if (record && body && i === INSPECT_INDEX) {
        const row = gradeBody(line, body);
        line.events.push({
          st: s.name,
          evt: "qc",
          body: body.id,
          ts: line.t,
          pass: row.pass,
          flagged: row.flagged,
          defect: row.defect,
        });
      }
    }
    if (record && s.sensed) {
      s.obs.push(s.lastCycle);
      if (s.obs.length > 80) s.obs.shift();
      const post = posterior(s.obs, STATION_META[i].mean);
      s.mean = post.mean;
      s.sd = post.sd;
      line.events.push({
        st: s.name,
        evt: "exit",
        body: body?.id ?? null,
        ts: line.t,
        cycle_s: Number(s.lastCycle.toFixed(3)),
      });
    }
    s.body = null;
  }

  for (let i = n - 1; i >= 0; i--) {
    const s = stations[i];
    if (s.blocked) {
      s.activeTicks = 0;
      if (i === n - 1 || line.buf[i + 1] < CAP) unload(i);
      continue;
    }
    if (!s.busy) {
      s.activeTicks = 0;
      continue;
    }
    s.timer -= 1;
    s.activeTicks += 1;
    s.busyTicks += 1;
    if (s.activeTicks > s.longestActive) s.longestActive = s.activeTicks;
    if (s.timer > 0) continue;
    if (i < n - 1 && line.buf[i + 1] >= CAP) {
      s.busy = false;
      s.blocked = true;
      s.activeTicks = 0;
      continue;
    }
    unload(i);
  }

  for (let i = 0; i < n; i++) {
    const s = stations[i];
    if (s.busy || s.blocked || line.buf[i] <= 0) continue;
    line.buf[i] -= 1;
    s.busy = true;
    if (i === 0) {
      s.body = mintBody(line, rng);
    } else {
      s.body = line.parts[i].shift() ?? mintBody(line, rng);
    }
    const m = meanFor(line, i, s.body);
    s.lastCycle = sampleCycle(m, s.sd, rng);
    s.timer = Math.max(1, Math.round(s.lastCycle));
    if (record && s.sensed) {
      line.events.push({
        st: s.name,
        evt: "enter",
        body: s.body?.id ?? null,
        ts: line.t,
      });
    }
    if (record && i === WELD_INDEX && s.body) {
      const drift = line.injected.drift ? Math.min(28, 4 + line.t * 0.12) : 0;
      const amps = 46 - drift + (rng() * 10 - 5);
      s.body.weldAmps = amps;
      line.weld.push(amps);
      if (line.weld.length > 80) line.weld.shift();
      if (amps < 34) s.body.weldDefect = true;
      const scored = scoreWeld(line);
      if (scored.suspicious || scored.confirmedRaw) s.body.weldFlagged = true;
    }
  }

  line.t += 1;
  if (line.events.length > 48) line.events.splice(0, line.events.length - 48);
  return line;
}

export function run(line, seconds, rng, record = true) {
  for (let i = 0; i < seconds; i++) tick(line, rng, record);
  return line;
}

export function stationStatus(line) {
  return line.stations.map((s, i) => {
    const slowed = line.injected.slow && line.injected.slow.station === i && line.injected.slow.factor > 1.05;
    if (s.blocked) return "blocked";
    if (s.busy && slowed) return "slow";
    if (s.busy) return "busy";
    return "starved";
  });
}

export function activePeriodRanks(line) {
  // Active-period method: current uninterrupted busy streak, not utilization
  // and not a historical max. S1 has infinite supply (stand-in for a full
  // body shop) so it is never the constraint — rank stations S2–S12 first.
  const scored = line.stations.map((s, i) => ({
    i,
    name: s.name,
    shop: s.shop,
    active: s.activeTicks,
    longest: s.longestActive,
  }));
  const rest = scored.filter((s) => s.i > 0);
  rest.sort((a, b) => b.active - a.active || b.longest - a.longest);
  const s1 = scored.find((s) => s.i === 0);
  return s1 ? rest.concat([s1]) : rest;
}

/** Constraint among S2–S12. Returns null while the line is still filling. */
export function constraintCandidate(line) {
  const ranks = activePeriodRanks(line);
  const top = ranks.find((s) => s.i > 0);
  if (!top || top.active <= 0) return null;
  return top;
}

export function monteCarlo(line, opts = {}) {
  const rolls = opts.rolls ?? 300;
  const horizon = opts.horizon ?? 30;
  const seed = opts.seed ?? 1;
  const n = line.stations.length;
  const counts = Array(n).fill(0);
  const throughputs = [];
  const thresholdHits = Array(n).fill(0);
  const firstHit = Array(n).fill(0);
  for (let r = 0; r < rolls; r++) {
    const rng = mulberry32(seed + r * 9973);
    const c = cloneLine(line);
    const startDone = c.completed;
    const hitAt = Array(n).fill(null);
    for (let k = 0; k < horizon; k++) {
      tick(c, rng, false);
      const winner = constraintCandidate(c);
      if (winner && winner.active >= 8 && hitAt[winner.i] == null) hitAt[winner.i] = k + 1;
    }
    const winner = constraintCandidate(c);
    if (winner) counts[winner.i] += 1;
    throughputs.push((c.completed - startDone) / Math.max(1, horizon));
    hitAt.forEach((h, i) => {
      if (h != null) {
        thresholdHits[i] += 1;
        firstHit[i] += h;
      }
    });
  }
  const bottleneck = counts.map((k) => Math.round((100 * k) / rolls));
  const meanTp = throughputs.reduce((a, b) => a + b, 0) / rolls;
  const when = firstHit.map((sum, i) => (thresholdHits[i] ? Math.round(sum / thresholdHits[i]) : null));
  const conf = thresholdHits.map((k) => Math.round((100 * k) / rolls));
  return { bottleneck, meanTp, when, conf, rolls, horizon };
}

export function forecastGhost(line, horizon, rng) {
  const g = cloneLine(line);
  for (let k = 0; k < horizon; k++) tick(g, rng, false);
  return g;
}

export function whatIf(line, { station, factor, rolls = 120, horizon = 120, seed = 7 }) {
  const base = monteCarlo(line, { rolls, horizon, seed });
  const alt = cloneLine(line);
  alt.injected = {
    ...alt.injected,
    slow: { station, factor },
  };
  const scenario = monteCarlo(alt, { rolls, horizon, seed });
  const drop = base.meanTp <= 0 ? 0 : (1 - scenario.meanTp / base.meanTp) * 100;
  const baseConstraint = argmaxShare(base.bottleneck);
  const scenarioConstraint = argmaxShare(scenario.bottleneck);
  return { base, scenario, dropPct: drop, baseConstraint, scenarioConstraint, station, factor, rolls, horizon };
}

export function argmaxShare(shares) {
  let best = -1;
  let idx = 1;
  for (let i = 1; i < shares.length; i++) {
    if (shares[i] > best) {
      best = shares[i];
      idx = i;
    }
  }
  return idx;
}

export function inferDark(line) {
  const n = line.stations.length;
  return line.stations.map((s, i) => {
    if (s.sensed) {
      const post = posterior(s.obs, STATION_META[i].mean);
      return {
        i,
        name: s.name,
        shop: s.shop,
        role: s.role,
        dark: false,
        mean: post.mean,
        lo: post.mean - 1.28 * post.sd,
        hi: post.mean + 1.28 * post.sd,
        source: "observed",
      };
    }
    const left = i > 0 ? posterior(line.stations[i - 1].obs, STATION_META[i - 1].mean) : null;
    const right = i < n - 1 ? posterior(line.stations[i + 1].obs, STATION_META[i + 1].mean) : null;
    const neighbors = [left, right].filter(Boolean);
    const mean = neighbors.length
      ? neighbors.reduce((a, p) => a + p.mean, 0) / neighbors.length
      : STATION_META[i].mean;
    const sd = 0.55 + neighbors.reduce((a, p) => a + p.sd, 0) * 0.35;
    return {
      i,
      name: s.name,
      shop: s.shop,
      role: s.role,
      dark: true,
      mean,
      lo: mean - 1.28 * sd,
      hi: mean + 1.28 * sd,
      source: "flow conservation",
    };
  });
}

export function coverageMap(line) {
  const inferred = inferDark(line);
  const sensed = inferred.filter((s) => !s.dark).length;
  const dark = inferred.filter((s) => s.dark);
  return {
    sensed,
    dark: dark.length,
    pct: Math.round((100 * sensed) / inferred.length),
    stations: inferred,
  };
}

export function recommendNextSensor(line) {
  const inferred = inferDark(line);
  const dark = inferred.filter((s) => s.dark);
  if (dark.length === 0) {
    const mc = monteCarlo(line, { rolls: 64, horizon: 40, seed: 3 });
    const i = argmaxShare(mc.bottleneck);
    return {
      station: i,
      name: STATION_META[i].name,
      shop: STATION_META[i].shop,
      reason: "all stations sensed; extra sensors add little — watch the current constraint instead",
      cutPct: 0,
    };
  }
  dark.sort((a, b) => b.hi - b.lo - (a.hi - a.lo));
  const pick = dark[0];
  const width = pick.hi - pick.lo;
  const cutPct = Math.round(clamp((width / 1.6) * 40, 18, 48));
  return {
    station: pick.i,
    name: pick.name,
    shop: pick.shop,
    reason: `${pick.name} (${pick.shop} ${pick.role}) is dark; neighbors bound it at ${pick.mean.toFixed(1)} s [${pick.lo.toFixed(1)}–${pick.hi.toFixed(1)} s, 80% CI]. A sensor there cuts forecast uncertainty by about ${cutPct}%.`,
    cutPct,
  };
}

function c(n) {
  if (n <= 1) return 0.0001;
  return 2 * (Math.log(n - 1) + 0.57721566) - (2 * (n - 1)) / n;
}

function pathLength(x, samples, rng, depth, limit) {
  if (samples.length <= 1 || depth >= limit) return depth;
  const lo = Math.min(...samples);
  const hi = Math.max(...samples);
  if (hi - lo < 1e-9) return depth;
  const split = lo + rng() * (hi - lo);
  const side = samples.filter((v) => (x < split ? v < split : v >= split));
  return pathLength(x, side.length ? side : samples, rng, depth + 1, limit);
}

export function isolationScore(x, samples, trees = 32, seed = 11) {
  if (samples.length < 8) return 0;
  const rng = mulberry32(seed);
  let sum = 0;
  const limit = Math.ceil(Math.log2(samples.length));
  for (let t = 0; t < trees; t++) {
    const bag = [];
    for (let i = 0; i < Math.min(32, samples.length); i++) {
      bag.push(samples[(rng() * samples.length) | 0]);
    }
    sum += pathLength(x, bag, rng, 0, Math.max(4, limit));
  }
  const eh = sum / trees;
  return Math.pow(2, -eh / c(Math.min(32, samples.length)));
}

export function autoencoderError(window, normalMean = 46) {
  if (window.length < 8) return 0;
  return window.reduce((a, x) => a + (x - normalMean) ** 2, 0) / window.length;
}

export function scoreWeld(line) {
  const samples = line.weld;
  if (samples.length < 8) {
    return { isolation: 0, ae: 0, suspicious: false, confirmed: false, confirmedRaw: false, frozen: !!line.aeFrozen };
  }
  const latest = samples[samples.length - 1];
  const isolation = isolationScore(latest, samples.slice(0, Math.max(8, samples.length - 8)));
  const baseline = samples.slice(0, Math.min(16, Math.floor(samples.length / 3) || 8));
  const normalMean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
  const recent = samples.slice(-16);
  const ae = autoencoderError(recent, normalMean);
  const recentMean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const suspicious = isolation > 0.55 || Math.abs(latest - normalMean) > 8;
  const confirmedRaw = ae > 40 || Math.abs(recentMean - normalMean) > 10;
  const confirmed = confirmedRaw && !line.aeFrozen;
  return {
    isolation,
    ae,
    suspicious,
    confirmed,
    confirmedRaw,
    frozen: !!line.aeFrozen,
  };
}

export function bodiesAtRisk(line) {
  const out = [];
  function consider(body, at, shop) {
    if (!body) return;
    if (body.weldFlagged || body.weldDefect) {
      out.push({
        id: body.id,
        model: body.model,
        modelName: body.modelName,
        flagged: !!body.weldFlagged,
        defect: !!body.weldDefect,
        at,
        shop,
      });
    }
  }
  line.stations.forEach((s) => consider(s.body, s.name, s.shop));
  line.parts.forEach((q, i) => {
    const dest = STATION_META[i];
    q.forEach((b) => consider(b, dest ? `buf→${dest.name}` : "done", dest?.shop ?? ""));
  });
  return out;
}

export function summarizeShift(line) {
  const t = Math.max(1, line.t);
  const jph = (line.completed / t) * 3600;
  const projected = jph * SHIFT_HOURS;
  const heat = line.stations.map((s) => ({
    i: s.id,
    name: s.name,
    shop: s.shop,
    role: s.role,
    util: s.busyTicks / t,
    longestActive: s.longestActive,
    sensed: s.sensed,
  }));
  const qc = line.qc;
  const alerts = qc.tp + qc.fp;
  const defects = qc.tp + qc.fn;
  const graded = qc.tp + qc.fp + qc.fn + qc.tn;
  return {
    t,
    completed: line.completed,
    jph,
    projected,
    shiftHours: SHIFT_HOURS,
    heat,
    qc: { tp: qc.tp, fp: qc.fp, fn: qc.fn, tn: qc.tn },
    falseAlarmPct: alerts ? Math.round((100 * qc.fp) / alerts) : 0,
    catchPct: defects ? Math.round((100 * qc.tp) / defects) : 0,
    graded,
  };
}

/** Stage 1 grade: did the predicted constraint actually bite? */
export function bottleneckOutcome(line, station) {
  const statuses = stationStatus(line);
  const downstreamStarved = statuses.slice(station + 1).some((st) => st === "starved");
  const top = constraintCandidate(line);
  const won = top && top.i === station;
  return { downstreamStarved, won, hit: !!(downstreamStarved || won) };
}

export function leadershipCase(line) {
  const cover = coverageMap(line);
  const inrPerSensor = 7000;
  const remaining = cover.dark * inrPerSensor;
  const perSite = N * inrPerSensor;
  const threeSite = perSite * 3;
  const shift = summarizeShift(line);
  return {
    stations: N,
    standInFor: "30–50",
    sensedPct: cover.pct,
    dark: cover.dark,
    inrPerSensor,
    remainingInr: remaining,
    perSiteInr: perSite,
    threeSiteInr: threeSite,
    sites: 3,
    advisoryOnly: true,
    plcWrites: false,
    jph: shift.jph,
    catchPct: shift.catchPct,
    falseAlarmPct: shift.falseAlarmPct,
  };
}
