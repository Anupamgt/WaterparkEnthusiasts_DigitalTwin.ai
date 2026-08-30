import {
  N,
  STATION_META,
  argmaxShare,
  bodiesAtRisk,
  inferDark,
  monteCarlo,
  posterior,
  recommendNextSensor,
  scoreWeld,
  summarizeShift,
  whatIf,
} from "./engine.js";

function parseStation(text) {
  const named = text.match(/\b(s(?:tation)?)\s*(1[0-2]|[1-9])\b/i);
  if (named) return Number(named[2]) - 1;
  const role = [
    ["stamp", 0],
    ["form", 1],
    ["weld", 2],
    ["bolt", 3],
    ["hang", 4],
    ["prime", 5],
    ["basecoat", 6],
    ["bake", 7],
    ["oven", 7],
    ["clear", 8],
    ["trim", 9],
    ["chassis", 10],
    ["inspect", 11],
  ];
  const lower = text.toLowerCase();
  for (const [word, i] of role) {
    if (lower.includes(word)) return i;
  }
  return null;
}

function parsePct(text) {
  const m = text.match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) / 100 : null;
}

function constraintName(idx) {
  const s = STATION_META[idx];
  return s ? `${s.name} (${s.shop} ${s.role})` : "S?";
}

export function parseIntent(question) {
  const q = question.toLowerCase();
  const station = parseStation(q);
  const pct = parsePct(q);

  if (/plc|setpoint|interlock|closed.?loop|write the cell|actuator|slow the robot|open a clamp|auto-?slow/.test(q)) {
    return { tool: "refuse_plc", args: {} };
  }
  if (/sensor|where should|next sensor|coverage/.test(q)) {
    return { tool: "recommend_sensor", args: {} };
  }
  if (/at risk|bodies at|until inspect|latent/.test(q)) {
    return { tool: "bodies_at_risk", args: {} };
  }
  if (/false alarm|qc grade|quality gate|confusion/.test(q)) {
    return { tool: "qc_grade", args: {} };
  }
  if (/weld|defect|quality|isolation|autoencoder/.test(q)) {
    return { tool: "weld_status", args: {} };
  }
  if (/belief|cycle time|how long|posterior/.test(q)) {
    return { tool: "cycle_belief", args: { station: station ?? 2 } };
  }
  if (/what if|happen if|slow|faster|night shift|scenario/.test(q)) {
    const factor = pct != null ? (/faster|speed up/.test(q) ? 1 - pct : 1 + pct) : 1.15;
    return { tool: "what_if", args: { station: station ?? 3, factor } };
  }
  if (/dark|infer|confidence band|s\d+\s*\?/.test(q) && station != null) {
    return { tool: "estimate_dark", args: { station } };
  }
  return { tool: "run_forecast", args: { station } };
}

function formatForecast(mc) {
  const i = argmaxShare(mc.bottleneck);
  const when = mc.when[i];
  const conf = mc.conf[i];
  const top = mc.bottleneck
    .map((p, k) => ({ p, k }))
    .sort((a, b) => b.p - a.p)
    .slice(0, 4)
    .map(({ p, k }) => `${STATION_META[k].name} ${p}%`)
    .join(" · ");
  const whenTxt = when != null ? `in ~${when} s` : "within the horizon";
  return {
    text: `${constraintName(i)} is the likely constraint ${whenTxt} (${conf || mc.bottleneck[i]}% of ${mc.rolls} rollouts). Throughput ≈ ${(mc.meanTp * 60).toFixed(1)} bodies/min. Top ranks: ${top}.`,
    data: mc,
  };
}

function formatRunLine(intent, out) {
  const rolls = out.rolls ?? out.data?.rolls ?? out.data?.base?.rolls ?? 0;
  const ms = Number(out.ms).toFixed(0);
  return `▸ twin: ${intent.tool.replace(/_/g, " ")} · ${rolls} rolls · ${ms} ms`;
}

export function runTool(line, intent) {
  const t0 = performance.now ? performance.now() : Date.now();
  let result;
  switch (intent.tool) {
    case "refuse_plc": {
      result = {
        text: "Advisory twin. Talk to OT. No PLC. This system never writes a setpoint, speed, or interlock.",
        data: { rolls: 0, refused: true },
      };
      break;
    }
    case "recommend_sensor": {
      const rec = recommendNextSensor(line);
      result = { text: rec.reason, data: rec };
      break;
    }
    case "bodies_at_risk": {
      const risk = bodiesAtRisk(line);
      const text = risk.length
        ? `${risk.length} bod${risk.length === 1 ? "y" : "ies"} still upstream of S12 inspect: ${risk
            .slice(0, 6)
            .map((b) => `${b.id} @ ${b.at}${b.flagged ? " (flagged)" : " (latent)"}`)
            .join(", ")}${risk.length > 6 ? "…" : ""}. Defects welded at S3 only surface at Final inspect.`
        : "No flagged or latent-defect bodies are in the line right now.";
      result = { text, data: { risk, count: risk.length } };
      break;
    }
    case "qc_grade": {
      const shift = summarizeShift(line);
      const { tp, fp, fn, tn } = shift.qc;
      result = {
        text: `QC at S12 has graded ${shift.graded} bodies. Alerts vs inspect: TP ${tp} · FP ${fp} · FN ${fn} · TN ${tn}. False-alarm rate ${shift.falseAlarmPct}% of alerts; catch rate ${shift.catchPct}% of true weld defects. False alarms die because every Isolation Forest / autoencoder flag is scored against inspect.`,
        data: shift,
      };
      break;
    }
    case "weld_status": {
      const w = scoreWeld(line);
      const text = w.confirmed
        ? `Autoencoder confirms weld drift on S3 (reconstruction error ${w.ae.toFixed(1)}). Isolation Forest score ${w.isolation.toFixed(2)}. Bodies stay at risk until S12 inspect grades the alert.`
        : w.suspicious
          ? `Isolation Forest flags S3 as suspicious (${w.isolation.toFixed(2)}). Autoencoder has not confirmed yet.`
          : `S3 weld current is inside the normal band. Isolation ${w.isolation.toFixed(2)}, reconstruction ${w.ae.toFixed(1)}.`;
      result = { text, data: w };
      break;
    }
    case "cycle_belief": {
      const i = intent.args.station ?? 2;
      const s = line.stations[i];
      const post = posterior(s.obs, s.mean);
      result = {
        text: `${s.name} (${s.shop} ${s.role}) posterior ${post.mean.toFixed(2)} s ± ${(1.28 * post.sd).toFixed(2)} (80% CI), n=${post.n}. ${s.sensed ? "Sensed." : "Dark — this is a neighbor-bounded estimate, not a sensor reading."} Started from the ${STATION_META[i].mean.toFixed(1)} s standard time.`,
        data: post,
      };
      break;
    }
    case "estimate_dark": {
      const inferred = inferDark(line);
      const s = inferred[intent.args.station] || inferred.find((x) => x.dark) || inferred[3];
      result = {
        text: s.dark
          ? `${s.name} (${s.shop} ${s.role}) has no sensor. Flow conservation bounds cycle ≈ ${s.mean.toFixed(1)} s [${s.lo.toFixed(1)}–${s.hi.toFixed(1)} s, 80% CI]. Shown with a band, never false precision.`
          : `${s.name} is sensed. Belief ${s.mean.toFixed(2)} s [${s.lo.toFixed(1)}–${s.hi.toFixed(1)}].`,
        data: s,
      };
      break;
    }
    case "what_if": {
      const station = intent.args.station ?? 3;
      const factor = intent.args.factor ?? 1.15;
      const w = whatIf(line, { station, factor, rolls: 180, horizon: 80 });
      const slower = Math.round((factor - 1) * 100);
      const stay = w.baseConstraint === w.scenarioConstraint;
      const verb = slower >= 0 ? `${slower}% slower` : `${Math.abs(slower)}% faster`;
      const delta =
        Math.abs(w.dropPct) < 2.5
          ? `throughput holds (Δ ${w.dropPct.toFixed(1)}%, within noise — ${constraintName(station)} is not the live constraint)`
          : `throughput ${w.dropPct >= 0 ? "drops" : "rises"} ${Math.abs(w.dropPct).toFixed(0)}%`;
      result = {
        text: `If ${constraintName(station)} runs ${verb}, ${delta}. ${constraintName(w.scenarioConstraint)} ${stay ? "stays" : "becomes"} the constraint (${w.scenario.bottleneck[w.scenarioConstraint]}% of rollouts). Advisory only — the twin does not write the PLC.`,
        data: w,
      };
      break;
    }
    default: {
      result = formatForecast(monteCarlo(line, { rolls: 180, horizon: 30, seed: 21 }));
    }
  }
  const ms = (performance.now ? performance.now() : Date.now()) - t0;
  const rolls = result.data?.rolls || result.data?.base?.rolls || 0;
  return {
    tool: intent.tool,
    args: intent.args,
    ms,
    rolls,
    text: result.text,
    data: result.data,
  };
}

export function ask(line, question) {
  const intent = parseIntent(question);
  const out = runTool(line, intent);
  return {
    question,
    intent,
    runLine: formatRunLine(intent, out),
    answer: out.text,
    out,
    promoteType: promoteType(intent.tool),
  };
}

function promoteType(tool) {
  if (tool === "run_forecast") return "bottleneck";
  if (tool === "what_if") return "what_if";
  if (tool === "weld_status") return "weld_confirmed";
  if (tool === "recommend_sensor" || tool === "estimate_dark") return "next_sensor";
  if (tool === "bodies_at_risk") return "bodies_at_risk";
  return null;
}

export { N };
