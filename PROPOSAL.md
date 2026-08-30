# DigitalTwin.ai — Round 2 Business Proposal

**Track 4 · Problem statement: DigitalTwin.ai**  
**Team:** Waterpark Enthusiasts  
**Prototype:** this repository (static site + `js/twin` engine)  
**Domain:** mixed-model vehicle body / paint / final assembly. Not wastewater.

This document is the Round 2 written submission. The working prototype of the core predictive mechanism is the **Ops** chapter (`pages/ops.html`), driven by `js/twin/engine.js` on simulated production events. Stage-wise product flows (Sense → Grade → scale) are in [docs/PRD.md](docs/PRD.md). Human-in-the-loop tickets and Accept/Defer/Dismiss are in [docs/HITL-PRD.md](docs/HITL-PRD.md).

---

## 1. Problem

A vehicle assembly shop can look green on the andon board and still be minutes away from a starvation cascade, or hours away from discovering that a weld made in Body will fail at Final inspect.

Four facts make that gap expensive:

1. **Uneven sensor coverage.** A typical shop has current clamps, part counters, or a camera on some stations and nothing on others. Treating dark stations as “unknown” wastes the fact that a serial segment conserves flow. Treating them as if they were sensed invents precision the plant does not have.
2. **Multi-causal, intermittent faults.** A weld cell slows because of a dressing cycle, a model mix shift (SUV vs sedan), and a current drift at the same time. SPC charts stay quiet when the drift sits inside classic control limits.
3. **No PLC writes.** IT/OT policy, union rules, and safety sign-off forbid closed-loop control from a new system. Advice has to be advisory. Hardware can only go on during a maintenance window the plant already planned.
4. **Delayed defect surfacing.** An early weld defect is not a Final-line event. It is a Body event that is discovered six to ten stations later. Until inspect, those bodies are at risk and the alert has not been graded.

Round 1 told this story on five stations. Round 2 runs it on a **12-station Body / Paint / Final line that stands in for a 30–50 station shop**, with mixed-model body IDs, four dark cells (including S4 and S8), an S3 slow + weld-drift injector, and QC at S12 that grades every weld flag.

---

## 2. Users

Three desks, one engine.

| Desk | Job in the last hour of a shift | What the twin shows |
| --- | --- | --- |
| **Floor supervisor** | Is the line about to starve? Is S3 lying? Which bodies do I babysit until inspect? | Floor-now vs +20 s ghost, bottleneck probabilities, weld Isolation Forest / autoencoder flags, event log, dark-station 80% CI, bodies at risk, pause/speed, copilot |
| **Plant manager** | Will we hit the shift number? Where is the constraint heat? Are the weld alarms real? Where does the next ₹7k sensor go? | Shift throughput, busy-fraction heat, false-alarm vs QC grade, coverage map, next-sensor uncertainty cut |
| **Leadership** | What do we buy, what do we refuse to buy, and what happens at three sites? | Retrofit cost, advisory-only rollout, 3-site scale, risks already designed against |

Nobody in this list needs a 3D digital mock-up, an MES cut-in, or a PLC upgrade. They need flow math they can argue with.

---

## 3. Design

Unchanged from Round 1, scaled to the Round 2 plant:

```
Sense (events, never video)
  → Mirror (Bayesian discrete-event twin)
    → Predict (Monte Carlo + active-period bottlenecks;
               Isolation Forest + autoencoder on weld current)
      → Ask (tool-calling copilot; simulation is the truth)
```

**Sense.** Stations that are instrumented emit `enter` / `exit` / `qc` events of a few hundred bytes. Dark stations emit nothing. S4 (Body bolt) and S8 (Paint bake) are named dark cells; S6 and S11 join them so coverage is ~70% / ~30%.

**Mirror.** Each sensed station starts from that station’s standard time as a Bayesian prior, then updates from observed cycle times. Dark stations are bounded by flow conservation from their neighbors and **drawn with an 80% CI, never a point estimate**. Mixed-model bodies (`A-4182` sedan, `B-4183` SUV) stretch cycle time; the posterior absorbs the mix instead of pretending the line is one SKU.

**Predict.** Monte Carlo rollouts rank the next constraint with the **active-period method** (current uninterrupted busy streak — utilization lies). Weld current is scored in-line with an Isolation Forest (suspicious) and a reconstruction autoencoder (confirmed). A defect flag at S3 does not wait until it is a scrap event: the body is listed **at risk until S12 inspect**.

**Ask.** The copilot only tool-calls (`run_forecast`, `what_if`, `recommend_sensor`, `weld_status`, `estimate_dark`, `bodies_at_risk`, `qc_grade`). The UI prints `▸ twin: tool · rolls · ms`. The LLM is the interface; the simulation is the truth.

**Deliberately skipped:** 3D rendering, MES integration, PLC upgrades, unit-level traceability, closed-loop control.

---

## 4. Business case

### What we refuse to sell

A “full digital twin” that needs laser scans, a historian cut-over, and a PLC write path. That is a 12–18 month IT programme. This is a **clip-on advisory twin** that is useful on day one because it boots from the plant’s own standard times.

### Unit economics (sensors, this stand-in line)

| Item | Figure | Note |
| --- | --- | --- |
| Clamp / counter midpoint | ₹7,000 / station | Story range ₹6–8k; camera can cover four |
| Remaining dark cells on the 12-station stand-in | 4 × ₹7k ≈ ₹28k | S4, S6, S8, S11 |
| Full 12-station kit | ≈ ₹84k | Sensors only, not gateway + install |
| Three sites, sensors only | ≈ ₹2.5 lakh | Same kit cloned |
| Installed 5-station bay (Round 1 story) | ₹1–1.5 lakh | Includes gateway, one shift |

The expensive object is not the clamp. It is **trust**: false alarms, fake precision on dark cells, and any hint that the box will write the PLC. The prototype is built to kill those three objections in the first demo.

### Where the money comes back

- **Bottleneck minutes, not utilization.** Catching S3 as the constraint 20 seconds (demo scale) / 20 minutes (shop scale) before S4/S5 starve is an extra body that was already in the system.
- **Rule of ten.** A weld defect caught as a current drift at Body is a re-weld. The same defect found at Final inspect is a tear-up. Delayed QC is modeled on purpose so that “at risk until inspect” is a first-class object.
- **Sensor placement as a ranked option.** The next clamp is the dark cell whose CI width cuts forecast uncertainty the most — not “instrument everything.”

These returns are **directionally argued from the simulation**, not claimed as a measured OEE lift from a live plant. See §8.

---

## 5. Phased roadmap

| Phase | When | What ships | What does not |
| --- | --- | --- | --- |
| **0 · Clip on** | Day 1, one shift | Clamps / counters / one camera. Event gateway. Twin boots from standard times. | PLC, MES, 3D |
| **1 · Ghost** | Week 1 | Monte Carlo + active-period bottleneck on the instrumented segment. Supervisor view. | Closed loop |
| **2 · Grade** | Week 2–3 | Weld Isolation Forest + autoencoder. Every alert graded at inspect. Manager QC card. | Labeled defect archives (they do not exist) |
| **3 · Dark honesty** | Week 3 | CI bands on dark cells. Next-sensor recommendation. | Fake point estimates |
| **4 · Ask** | Ongoing | Tool-calling copilot on the live twin. | Free-text answers from the LLM |
| **5 · Three sites** | After one shop trusts it | Copy priors, coverage rule, and QC grading. Leadership cost card. | A custom model per site on day one |

Retrofits happen **only in maintenance windows**. Between windows the twin stays advisory.

HITL tightens with each phase (mapping sign-off → bottleneck accept/dismiss → weld babysit + QC grade → sensor queued for a window → copilot as evidence only → per-site go/no-go). Full product flows: [docs/PRD.md](docs/PRD.md). Decision tables: [docs/HITL-PRD.md](docs/HITL-PRD.md).

---

## 6. Risks and mitigations

| Risk | Why it shows up | Mitigation already in the prototype |
| --- | --- | --- |
| False alarms erode supervisor trust | Unsupervised detectors on weld current | Every flag is graded at S12; false-alarm % is a manager KPI |
| Dark station is the real constraint | ~30% of cells have no sensor | 80% CI + next-sensor uncertainty cut; never a fake point |
| Mixed-model mix shift looks like a fault | SUV cycle ×1.12 vs sedan | Body IDs carry model; cycle posterior updates from events |
| Delayed defect blamed on Final | Weld made at S3, found at S12 | At-risk list from weld to inspect |
| IT/OT / safety block | Any PLC write | Advisory only. Inject / recover are maintenance-window moves |
| Copilot hallucinates a throughput number | LLM answering from weights | Tool-calling only; `▸ twin: tool · rolls · ms` is on screen |
| Demo over-claims accuracy | Published weld papers quote ~97% | Those papers are motivation. This repo reports simulation, not plant accuracy |
| 12 stations ≠ 30–50 | Scope of a hackathon twin | Stated as a stand-in in the UI, README, and this proposal |

---

## 7. Complexities demonstrated

Mapped to the Round 2 brief:

| Brief | Where it lives |
| --- | --- |
| Uneven sensor coverage | `DEFAULT_SENSED` — 8/12 sensed; S4 and S8 named dark |
| Multi-causal / intermittent | Scenario injector: S3 slow **and** weld drift on mixed-model flow |
| No PLC writes | Ops UI copy + recover button labeled “maintenance window” |
| Delayed defect surfacing | Latent `weldDefect` at S3, QC event only at S12, at-risk list |
| Three stakeholder views | Ops tabs: supervisor, manager, leadership; same `line` object |
| Validation against QC | Confusion matrix TP/FP/FN/TN; false-alarm % |

---

## 8. Assumptions (stated clearly)

1. **12 stations stand in for 30–50.** Shops are Body (S1–S5), Paint (S6–S9), Final (S10–S12).
2. **~70% sensed / ~30% dark.** Implementation is 8 sensed / 4 dark (S4, S6, S8, S11).
3. **Advisory only.** The engine never emits an actuator command.
4. **Simulated production data.** Cycle times, weld current, and QC outcomes are generated by `js/twin/engine.js`. They are realistic in structure (buffers, blocking, mixed models, delayed inspect), not a replay of a confidential plant log.
5. **Published weld-quality accuracy is not this prototype’s accuracy.** Isolation Forest + autoencoder here are small in-browser models on a 1-D current trace.
6. **Skipped on purpose:** 3D, MES, PLC upgrades, unit-level traceability, closed-loop control.

---

## 9. What to run, what to watch

- Written submission: [README.md](README.md) (start here).
- Prototype: `pages/ops.html` (also dashboard chapter **06 · Ops**).
- Story: chapters 01–05; **03 · Live twin** now runs the same 12-station engine (scripted inject/recover). HITL verbs are on Ops.
- Tests: `npm test`.
- Demo click / speak script: [docs/WALKTHROUGH.md](docs/WALKTHROUGH.md).
