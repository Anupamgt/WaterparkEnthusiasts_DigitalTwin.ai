import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CAP,
  DEFAULT_SENSED,
  N,
  SHOPS,
  STATION_META,
  WELD_INDEX,
  INSPECT_INDEX,
  activePeriodRanks,
  applyScenario,
  autoencoderError,
  bodiesAtRisk,
  cloneLine,
  coverageMap,
  forecastGhost,
  freshLine,
  inferDark,
  isolationScore,
  leadershipCase,
  monteCarlo,
  mulberry32,
  posterior,
  recommendNextSensor,
  run,
  sampleCycle,
  scoreWeld,
  summarizeShift,
  tick,
  whatIf,
} from "../js/twin/engine.js";
import { ask, parseIntent } from "../js/twin/copilot.js";

describe("posterior beliefs", () => {
  it("starts from the plant standard time", () => {
    const p = posterior([]);
    assert.equal(p.mean, 4);
    assert.equal(p.n, 0);
  });

  it("moves toward slower observations", () => {
    const p = posterior(Array(20).fill(9));
    assert.ok(p.mean > 6, `expected mean > 6, got ${p.mean}`);
    assert.ok(p.mean < 9);
  });
});

describe("twelve-station mixed-model line", () => {
  it("has twelve stations in three shops and four-slot buffers", () => {
    const line = freshLine();
    assert.equal(line.stations.length, N);
    assert.equal(N, 12);
    assert.equal(CAP, 4);
    assert.equal(line.buf.length, N + 1);
    assert.deepEqual([...new Set(STATION_META.map((s) => s.shop))], SHOPS);
    assert.equal(STATION_META[WELD_INDEX].role, "weld");
    assert.equal(STATION_META[INSPECT_INDEX].role, "inspect");
  });

  it("senses about 70% of stations; S4 and S8 are dark", () => {
    const line = freshLine();
    const sensed = line.stations.filter((s) => s.sensed).length;
    assert.equal(sensed, 8);
    assert.equal(DEFAULT_SENSED[3], false);
    assert.equal(DEFAULT_SENSED[7], false);
    assert.equal(line.stations[3].name, "S4");
    assert.equal(line.stations[7].name, "S8");
    assert.equal(line.stations[3].sensed, false);
    assert.equal(line.stations[7].sensed, false);
    assert.ok(coverageMap(line).pct >= 60 && coverageMap(line).pct <= 75);
  });

  it("completes mixed-model bodies over time", () => {
    const line = freshLine();
    run(line, 140, mulberry32(1));
    assert.ok(line.completed >= 2, `completed ${line.completed}`);
    const ids = [];
    line.stations.forEach((s) => s.body && ids.push(s.body.id));
    line.parts.forEach((q) => q.forEach((b) => ids.push(b.id)));
    assert.ok(ids.some((id) => /^[AB]-\d+$/.test(id)), ids.join(","));
    assert.ok(line.events.some((e) => e.evt === "enter"));
    assert.ok(line.events.some((e) => e.evt === "exit"));
  });

  it("does not emit events from dark S4 or S8", () => {
    const line = freshLine();
    run(line, 80, mulberry32(2));
    assert.equal(line.events.filter((e) => e.st === "S4").length, 0);
    assert.equal(line.events.filter((e) => e.st === "S8").length, 0);
    assert.ok(line.stations[3].completed > 0);
    assert.ok(line.stations[7].completed > 0);
  });

  it("clone does not alias buffers or bodies", () => {
    const line = freshLine();
    run(line, 12, mulberry32(3));
    const c = cloneLine(line);
    c.buf[2] = 99;
    assert.notEqual(line.buf[2], 99);
    if (c.stations[0].body && line.stations[0].body) {
      c.stations[0].body.weldFlagged = true;
      assert.equal(line.stations[0].body.weldFlagged, false);
    }
  });
});

describe("forecasting", () => {
  it("ghost is a forward copy, not the live line", () => {
    const line = freshLine();
    run(line, 20, mulberry32(4));
    const g = forecastGhost(line, 20, mulberry32(5));
    assert.equal(g.t, line.t + 20);
    assert.equal(line.t, 20);
  });

  it("ranks a slowed weld station as the constraint", () => {
    const line = freshLine();
    applyScenario(line, "s3_slow_weld");
    run(line, 120, mulberry32(6));
    const ranks = activePeriodRanks(line);
    assert.equal(ranks[0].name, "S3");
  });

  it("monte carlo probabilities sum near 100", () => {
    const line = freshLine();
    run(line, 16, mulberry32(8));
    const mc = monteCarlo(line, { rolls: 60, horizon: 20, seed: 9 });
    const sum = mc.bottleneck.reduce((a, b) => a + b, 0);
    assert.ok(sum >= 90 && sum <= 110, `sum ${sum}`);
    assert.ok(mc.meanTp >= 0);
  });

  it("slowing a station drops throughput", () => {
    const line = freshLine();
    run(line, 40, mulberry32(10));
    const w = whatIf(line, { station: 7, factor: 2.0, rolls: 28, horizon: 80, seed: 11 });
    assert.ok(w.dropPct > 3, `drop ${w.dropPct}`);
  });
});

describe("dark stations", () => {
  it("reports a confidence band, not a fake point", () => {
    const line = freshLine();
    run(line, 60, mulberry32(12));
    const inf = inferDark(line);
    assert.equal(inf[3].dark, true);
    assert.equal(inf[7].dark, true);
    assert.ok(inf[3].hi > inf[3].lo);
    assert.ok(inf[3].mean > 2 && inf[3].mean < 9);
  });

  it("recommends a dark station for the next sensor", () => {
    const line = freshLine();
    run(line, 50, mulberry32(13));
    const rec = recommendNextSensor(line);
    assert.ok(["S4", "S6", "S8", "S11"].includes(rec.name), rec.name);
    assert.ok(rec.cutPct >= 18);
  });
});

describe("weld anomaly and delayed QC", () => {
  it("isolation forest scores outliers higher", () => {
    const normal = Array.from({ length: 40 }, (_, i) => 46 + Math.sin(i) * 2);
    const inBand = isolationScore(46.2, normal);
    const outlier = isolationScore(12, normal);
    assert.ok(outlier > inBand, `${outlier} vs ${inBand}`);
  });

  it("autoencoder error grows when the wave leaves the band", () => {
    const calm = Array(16).fill(46);
    const drift = [46, 44, 40, 32, 24, 18, 12, 8, 6, 4, 3, 2, 1, 0, -2, -4];
    assert.ok(autoencoderError(drift, 46) > autoencoderError(calm, 46));
  });

  it("flags confirmed drift after S3 scenario injection", () => {
    const line = freshLine();
    applyScenario(line, "s3_slow_weld");
    run(line, 140, mulberry32(14));
    const w = scoreWeld(line);
    assert.ok(w.confirmed || w.suspicious, JSON.stringify(w));
  });

  it("surfaces early weld defects only at Final inspect", () => {
    const line = freshLine();
    applyScenario(line, "s3_slow_weld");
    run(line, 220, mulberry32(17));
    const graded = line.qc.tp + line.qc.fp + line.qc.fn + line.qc.tn;
    assert.ok(graded >= 1, `graded ${graded}`);
    assert.ok(line.qc.tp + line.qc.fn >= 1, `true defects ${line.qc.tp + line.qc.fn}`);
    const qcEvents = line.events.filter((e) => e.evt === "qc");
    assert.ok(qcEvents.every((e) => e.st === "S12"));
    const risk = bodiesAtRisk(line);
    risk.forEach((b) => {
      assert.notEqual(b.at, "S12");
    });
    const shift = summarizeShift(line);
    assert.ok(shift.graded === graded);
  });
});

describe("scenario injector and leadership numbers", () => {
  it("applies S3 slow + weld drift by name", () => {
    const line = freshLine();
    applyScenario(line, "s3_slow_weld");
    assert.equal(line.injected.slow.station, WELD_INDEX);
    assert.equal(line.injected.drift, true);
    applyScenario(line, "recover");
    assert.equal(line.injected.slow, null);
    assert.equal(line.injected.drift, false);
  });

  it("states advisory-only retrofit math", () => {
    const line = freshLine();
    const L = leadershipCase(line);
    assert.equal(L.stations, 12);
    assert.equal(L.plcWrites, false);
    assert.equal(L.advisoryOnly, true);
    assert.equal(L.sites, 3);
    assert.equal(L.dark, 4);
    assert.ok(L.threeSiteInr > L.perSiteInr);
  });
});

describe("copilot is tool-calling only", () => {
  it("maps the night-shift question to what_if on S4", () => {
    const intent = parseIntent("What happens if Station 4 runs 15% slower on night shift?");
    assert.equal(intent.tool, "what_if");
    assert.equal(intent.args.station, 3);
    assert.ok(Math.abs(intent.args.factor - 1.15) < 1e-6);
  });

  it("maps sensor placement to recommend_sensor", () => {
    assert.equal(parseIntent("Where should the next sensor go?").tool, "recommend_sensor");
  });

  it("maps bodies-at-risk and QC questions", () => {
    assert.equal(parseIntent("Which bodies are at risk until inspect?").tool, "bodies_at_risk");
    assert.equal(parseIntent("What is the false alarm vs QC grade?").tool, "qc_grade");
  });

  it("answers from a simulation run, not free text", () => {
    const line = freshLine();
    run(line, 30, mulberry32(15));
    const a = ask(line, "When does the next bottleneck form?");
    assert.equal(a.intent.tool, "run_forecast");
    assert.match(a.answer, /S\d+/);
    assert.match(a.runLine, /▸ twin:/);
    assert.match(a.runLine, /rolls/);
    assert.match(a.runLine, /ms/);
  });

  it("sampleCycle stays positive", () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 50; i++) assert.ok(sampleCycle(4, 0.45, rng) > 0);
  });
});
