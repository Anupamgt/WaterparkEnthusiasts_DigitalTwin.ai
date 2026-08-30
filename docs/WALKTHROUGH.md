# Ops + Live-twin walkthrough script

Spoken / click script for the demo recording. Target **90–120 seconds**. Speed 2× is fine. Open the story dashboard, then Ops.

## 0. Setup (off camera)

```bash
python3 -m http.server 8765
```

Open http://127.0.0.1:8765/

## 1. Story — Live twin (same 12-station engine)

1. Overview → **03 · Live twin**.
2. Point at **three shops** (Body / Paint / Final). Solid = floor now, dashed = twin +20 s, hatched = dark.
3. Wait or skip if already past t ≈ 16 s (auto-inject). Ghost on S3 goes red/slow **before** the floor chip.
4. Weld card: Isolation Forest then autoencoder. Say: *“Flagged at Body. Graded only at S12.”*
5. Click **Open Ops · HITL desks**.

## 2. Supervisor — Ghost (Stage 1)

1. Click **Inject S3 slow + weld drift** if the scenario is still baseline.
2. Bottleneck bars: **S1 is not the constraint** (infinite supply). After inject, **S3** should dominate the rollouts.
3. Violet **Twin alert** + ticket id (`TWIN-… bottleneck · act_now`).
4. Click **Accept**. *“I will pre-stage the downstream buffer. The twin does not write the cell.”*
5. HITL log: `supervisor accept bottleneck S3`.

## 3. Supervisor — Grade (Stage 2)

1. Isolation Forest / autoencoder flags on the weld card.
2. **Bodies at risk until inspect** — read one `A-` sedan or `B-` SUV and last station.
3. **Accept** the weld ticket (babysit until S12). *“Dismissing the bottleneck would not drop these IDs.”*
4. Ask: **Which bodies are at risk until inspect?** Evidence line `▸ twin:` first.

## 4. Ask (Stage 4)

1. Preset: **What happens if Station 4 runs 15% slower on night shift?**
   - If S3 is already the constraint, throughput **holds** (S4 is not the live constraint). That is TOC, not a bug.
2. Click **Promote to ticket**.
3. Preset: **Write a PLC setpoint to slow Station 3** → **Advisory twin. Talk to OT. No PLC.**
4. Optional: **Dismiss · copilot_misread**.

## 5. Manager (Stage 1 grades + 3) — key `2`

1. Weld QC grid (TP/FP/FN/TN) **and** **Bottleneck grades** underneath (kept separate).
2. **Missed act_now SLAs** (never auto-accept).
3. **Detector freeze**: read the printed rule. Button stays **disabled** until n≥20 and FA%>25.
4. Coverage map: sensed vs dark; **mapping signed** on sensed stations.
5. **Queue for maintenance window**. Backlog lists the dark cell. Sensed count does **not** jump.

## 6. Leadership (Stage 5) — key `3`

1. Cost row: remaining sensors, 12-station kit, 3-site scale.
2. **Shop B go / no-go**: **Accept** = copy playbook + priors, local freeze.
3. **Export HITL audit JSON**.

## 7. Recover

1. Key `1` back to supervisor.
2. **Recover in maintenance window**. *“Hardware only when the line is already down.”*
3. Restart does **not** fire automatically — the loop stays up for questions.

## What judges should be able to repeat

> The last alert was S3 becoming the constraint. I accepted it and pre-staged the buffer. Weld flags stay on the at-risk list until S12 inspect grades them. The twin never wrote a PLC.
