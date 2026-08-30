# DigitalTwin.ai

**AIC Round 2 · Track 4 · DigitalTwin.ai**  
**Team:** Waterpark Enthusiasts  
**Domain:** mixed-model vehicle **Body / Paint / Final** assembly — not wastewater.

This README is the **written hackathon submission**. The working prototype is in this repo. The longer business case is [PROPOSAL.md](PROPOSAL.md). Product flows: [docs/PRD.md](docs/PRD.md). HITL tickets: [docs/HITL-PRD.md](docs/HITL-PRD.md). Speaker script if you are recording: [docs/WALKTHROUGH.md](docs/WALKTHROUGH.md).

---

## 1. One paragraph

A vehicle shop can look green on the andon board and still be minutes from a starvation cascade, or hours from discovering that a weld made in Body will fail at Final inspect. We built a **clip-on advisory twin**: stations emit tiny timestamped events (never video), a Bayesian discrete-event model mirrors the line, Monte Carlo plus Isolation Forest / autoencoder predict the next bottleneck and weld drift, and a tool-calling copilot answers questions from the simulation — **never from model weights, never by writing a PLC**. A named person Accepts, Defers, or Dismisses every proposal. Hardware waits for a maintenance window the plant already has.

Round 1 told that story on five stations. Round 2 **runs it**: 12 stations standing in for a 30–50 station shop, ~70% sensed / ~30% dark, mixed-model sedan/SUV bodies, delayed QC at S12, three desks on one engine.

---

## 2. What to submit / where it lives

| Artifact | File |
| --- | --- |
| This write-up (start here) | `README.md` |
| Business proposal | `PROPOSAL.md` |
| Working prototype | `pages/ops.html` (also dashboard chapter **06 · Ops**) |
| Story (same engine, scripted) | `pages/live-twin.html` (chapter **03**) |
| Demo video | attach your recording; click script in `docs/WALKTHROUGH.md` |
| Tests | `npm test` (38 tests) |

Live URL if deployed: static Vercel site from the repo root. No env vars.

---

## 3. Problem (why a dashboard is not enough)

1. **Uneven coverage.** Some cells have clamps or a camera; others are dark. Treating dark as “unknown” wastes flow conservation. Treating them as sensed invents precision.
2. **Multi-causal, intermittent faults.** Mix shift (SUV vs sedan), a weld-tip dress, and a current drift can happen together. SPC stays quiet when the drift sits inside classic limits.
3. **No PLC writes.** IT/OT freeze, union rules, safety. Advice must be advisory. Hardware only in a scheduled window.
4. **Delayed defects.** A bad weld is a Body event discovered at Final inspect. Until then those bodies are at risk and the alert has not been graded.

If a floor supervisor cannot say *what the last alert was, what they did, and how they will know at inspect whether they were right*, the twin is a dashboard, not a product.

---

## 4. Solution

```
Sense → Mirror → Predict → Ask → Decide (HITL) → Act on the floor → Grade at inspect
```

| Move | What ships |
| --- | --- |
| **Sense** | `enter` / `exit` / `qc` JSON. Dark stations emit nothing. No video leaves the box. |
| **Mirror** | Bayesian cycle-time beliefs, bootstrapped from standard times. Dark cells: 80% CI from neighbors, **never a point**. |
| **Predict** | Monte Carlo + **active-period** rank (S1 infinite supply is not a constraint). Isolation Forest = suspicious; autoencoder = confirmed. Bodies stay **at risk until S12**. |
| **Ask** | Tool-calling copilot. Evidence line: `▸ twin: {tool} · {rolls} rolls · {ms} ms`. PLC / interlock → *Advisory twin. Talk to OT. No PLC.* |
| **Decide** | Ticket: Accept / Defer / Dismiss + reason. SLA timeout is a system **defer**, never a fake accept. |

**Plant (stated as a stand-in):** Body S1–S5 (S3 weld, S4 dark), Paint S6–S9 (S6/S8 dark), Final S10–S12 (S11 dark, S12 inspect). Mixed-model `A-####` sedan (×1.0) / `B-####` SUV (×1.12). Four-slot buffers. ~8 sensed / 4 dark.

**Deliberately not built:** 3D, MES, PLC upgrades, unit-level genealogy, closed-loop control, wastewater / SUMO models.

---

## 5. Round 2 brief → this repo

| Brief | Where it is |
| --- | --- |
| Uneven sensor coverage | 8/12 sensed; S4 and S8 named dark; CI + next-sensor window |
| Multi-causal / intermittent | Inject **S3 slow and weld drift**; dismiss codes `mix_shift`, `dressing_cycle` |
| No PLC / rare windows | Advisory copy; Recover labeled maintenance window; copilot refuses PLC |
| Delayed defect + root cause | Latent flag at S3, QC only at S12, at-risk list |
| Three stakeholder views | One `line` object; Supervisor / Manager / Leadership tabs |
| Multi-site variation | Leadership `site_go`: copy playbook + priors, local freeze |
| False alarms vs trust | S12 confusion matrix; freeze if FA% > 25 and n≥20 |
| 30–50 stations, mixed-model | 12-station stand-in, stated in UI and this README |
| Working prototype on illustrative data | Simulated events in `js/twin/engine.js`; `npm test` |
| Proposal + README + video | This file, `PROPOSAL.md`, your demo recording |

---

## 6. Three desks, one engine

1. **Floor supervisor** — solid chips = floor now, dashed = twin +20 s, hatched = dark. Bottleneck bars, weld wave, HITL tickets, at-risk bodies, Ask.
2. **Plant manager** — shift throughput, constraint heat, **weld QC** TP/FP/FN/TN (separate from **bottleneck grades**), coverage map, queue next sensor for a **window** (does not flip `sensed` live), freeze control (disabled until eligible).
3. **Leadership** — remaining clamps ₹7k, 12-station kit, 3-site scale, risks, Shop B go/no-go.

Switching tabs does not fork state. Pause / speed / inject are global.

---

## 7. How to run

No build. Static HTML + ES modules. Node 18+ only for tests.

```bash
python3 -m http.server 8765
```

Open **http://127.0.0.1:8765/**

| Page | URL |
| --- | --- |
| Story dashboard | `/` |
| Live twin (same engine, auto-inject) | `/pages/live-twin.html` or chapter **03** |
| **Ops (the prototype)** | `/pages/ops.html` or chapter **06** |

`npm start` is the same server. `npm test` runs 38 tests (posteriors, 12-station / 3-shop layout, dark S4/S8, mixed-model IDs, Monte Carlo, delayed QC, HITL tickets, PLC refuse, what-if holds on a non-constraint).

**Deploy:** Vercel, `framework: null`, project root. No environment variables.

---

## 8. Demo the judges should watch (~90–120 s)

Open **Ops** (`pages/ops.html`). Speed **2×**. Full spoken script: [docs/WALKTHROUGH.md](docs/WALKTHROUGH.md).

1. Solid vs dashed vs hatched. **Inject S3 slow + weld drift.**
2. Ticket `bottleneck · act_now` on **S3** (not S1). **Accept.** Twin does not write the cell.
3. Weld IF/AE + **bodies at risk** (`A-` sedan / `B-` SUV). **Accept** weld. Dismissing a bottleneck would not drop those IDs.
4. Ask: night-shift S4 15% slower → evidence line first; throughput **holds** if S3 is the constraint. Then: *Write a PLC setpoint…* → **No PLC.**
5. Key `2` Manager: QC grid, freeze rule locked until n≥20, **Queue for maintenance window** (sensed count unchanged).
6. Key `3` Leadership: cost row, Shop B **Accept**, **Export HITL audit JSON**.
7. Key `1` → **Recover in maintenance window.**

Line judges should be able to repeat:

> The last alert was S3 becoming the constraint. I accepted it and pre-staged the buffer. Weld flags stay on the at-risk list until S12 inspect grades them. The twin never wrote a PLC.

---

## 9. Assumptions (stated, not hidden)

1. **12 stations stand in for 30–50.** Body / Paint / Final.
2. **~70% sensed / ~30% dark.** Implementation: 8 sensed, 4 dark (S4, S6, S8, S11).
3. **Advisory only.** No actuator command exists in this codebase.
4. **Simulated production data.** Cycle times, weld current, QC pass/fail vs latent `weldDefect` are generated in-browser. Structurally realistic (blocking, starvation, delayed inspect). **Not** a live MES feed. **Not** a measured OEE lift.
5. **Published ~97% weld-quality figures are not this prototype’s accuracy.** They motivated Isolation Forest + autoencoder; here they run on a 1-D simulated current trace.
6. Demo clock is **seconds**; shop SLA is **minutes**. The ticket state machine is the same.
7. Manager freeze stays disabled in a short demo until n≥20 graded alerts — that is the rule, not a missing button.

---

## 10. Business case (snapshot)

Clip-on clamps, not a 12–18 month “full twin.” Story economics: ~₹7k/station; four remaining dark cells ≈ ₹28k; 12-station kit ≈ ₹84k; three sites sensors-only ≈ ₹2.5 lakh. The expensive object is **trust** (false alarms, fake dark-cell precision, any PLC write). Returns are argued from the simulation (bottleneck minutes, rule of ten on delayed weld, ranked next sensor) — **not** claimed as plant OEE.

Full numbers and roadmap: [PROPOSAL.md](PROPOSAL.md).

---

## 11. Repo map

```
README.md              this submission
PROPOSAL.md            business case
index.html             story dashboard
pages/ops.html         Round 2 prototype (three desks)
pages/live-twin.html   same engine, scripted story
js/twin/engine.js      Bayesian DES + Monte Carlo + weld + dark CI
js/twin/tickets.js     HITL propose / accept / defer / dismiss
js/twin/copilot.js     tool-calling Ask
js/twin/ops-ui.js      supervisor / manager / leadership
test/twin.test.js
docs/PRD.md            stage-wise product
docs/HITL-PRD.md       Decide
docs/WALKTHROUGH.md    what to open and what to say
```
