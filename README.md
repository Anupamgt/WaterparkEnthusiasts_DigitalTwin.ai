# DigitalTwin.ai — AIC Round 2 (Track 4)

A **clip-on advisory twin** for mixed-model vehicle assembly. Round 1 was a five-station story. Round 2 is that story plus a working 12-station predictive engine with three stakeholder desks.

**Domain is vehicle Body / Paint / Final. Not wastewater.**

| Submission | Where |
| --- | --- |
| Business proposal | [PROPOSAL.md](PROPOSAL.md) |
| Working prototype | Dashboard chapter **06 · Ops**, or open `pages/ops.html` |
| Demo video | [docs/demo.mp4](docs/demo.mp4) (also attached on the PR) |
| Tests | `npm test` |

## Assumptions (read these first)

- **12 stations stand in for a 30–50 station shop** (Body S1–S5, Paint S6–S9, Final S10–S12).
- **~70% sensed / ~30% dark.** Eight stations emit events; S4, S6, S8, S11 do not. S4 and S8 are the named dark cells.
- **Advisory only.** The twin never writes a PLC. Recover / retrofit actions wait for a maintenance window.
- **Simulated production data.** Cycle times, weld current, mixed-model body IDs (`A-####` sedan, `B-####` SUV), and S12 QC grades are generated in `js/twin/engine.js`. They are structurally realistic (blocking, starvation, delayed inspect). They are **not** a live plant feed and **not** a claim of measured OEE lift or 97% weld-classification accuracy. Published weld papers motivated the detectors; this prototype’s Isolation Forest + autoencoder run on a 1-D simulated current trace in the browser.

Deliberately skipped: 3D, MES, PLC upgrades, unit-level traceability, closed-loop control.

## Architecture (unchanged)

**Sense** (events, never video) → **Mirror** (Bayesian discrete-event twin) → **Predict** (Monte Carlo + active-period bottlenecks; Isolation Forest + autoencoder on weld) → **Ask** (tool-calling copilot; simulation is the truth).

The copilot prints `▸ twin: tool · rolls · ms` and will not answer from model weights alone.

## How to run

No build step. Static HTML + ES modules.

```bash
python3 -m http.server 8765
```

Open http://127.0.0.1:8765/

- Overview and story chapters: `index.html`
- Live prototype: http://127.0.0.1:8765/pages/ops.html  
  or `index.html#ops`

`npm start` is the same server command.

### Tests

```bash
npm test
```

Requires Node 18+ (`node --test`). Covers posteriors, 12-station / 3-shop layout, dark S4 and S8, mixed-model IDs, Monte Carlo, delayed QC at S12, scenario injector, and copilot tool routing.

## What the prototype is doing

On Ops, one engine feeds three views:

1. **Floor supervisor** — floor now vs ghost +20 s, bottleneck probabilities, weld flags, event log, pause/speed, dark-station CI bands, bodies at risk until inspect, copilot.
2. **Plant manager** — shift throughput, constraint heat, false-alarm vs QC grade, sensor-coverage map, next-sensor uncertainty cut.
3. **Leadership** — retrofit cost, advisory-only rollout, 3-site scale, risks.

At t ≈ 16 s the scenario injector applies **S3 slow + weld drift**. S3 defects only surface when the body reaches **S12 inspect**. Use **Recover in maintenance window** to show that hardware changes are not live PLC writes.

The five-station **Live twin** chapter is still the pedagogical animation from Round 1. The Round 2 predictive mechanism is Ops.

## Deploy

Static site. Vercel serves the project root; `vercel.json` sets `framework` to none. No environment variables.

## Repo map

```
index.html            story dashboard
pages/                opening, camera, live-twin, architecture, setup, ops
js/twin/engine.js     discrete-event twin
js/twin/copilot.js    tool-calling copilot
js/twin/ops-ui.js     three-view UI
test/twin.test.js
PROPOSAL.md
docs/demo.mp4
```
