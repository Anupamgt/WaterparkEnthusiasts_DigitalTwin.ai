# Ops walkthrough script (HITL demo)

Use this as the spoken / click script while recording. Target ~90–120 seconds. Open **Ops** (`pages/ops.html` or `index.html#ops`). Speed 2× is fine.

## 0. Setup (off camera)

```bash
python3 -m http.server 8765
```

Open http://127.0.0.1:8765/pages/ops.html

## 1. Supervisor — Ghost (Stage 1)

1. Point at **solid chips = floor now**, **dashed = twin +20 s**, hatched = dark (CI only).
2. Click **Inject S3 slow + weld drift** (or wait until t ≈ 16 s).
3. When the violet **Twin alert** appears, show the ticket id (`TWIN-… bottleneck · act_now`).
4. Click **Accept**. Say: *“I will pre-stage the downstream buffer. The twin does not write the cell.”*
5. Confirm the HITL log line: `supervisor accept bottleneck S3`.

## 2. Supervisor — Grade (Stage 2)

1. Isolation Forest / autoencoder flags on the weld card.
2. Scroll to **Bodies at risk until inspect**. Read one body ID (`A-` sedan or `B-` SUV) and last station.
3. If a weld ticket is open, **Accept** it (babysit until S12). Say: *“Dismissing the bottleneck would not drop these IDs.”*
4. Ask: **Which bodies are at risk until inspect?** Evidence line `▸ twin:` appears first.

## 3. Ask (Stage 4)

1. Preset: **What happens if Station 4 runs 15% slower on night shift?**
2. Click **Promote to ticket**.
3. Preset: **Write a PLC setpoint to slow Station 3**. Copilot must answer **Advisory twin. Talk to OT. No PLC.**
4. Click **Dismiss · copilot_misread** on a bad parse if you re-ask (optional).

## 4. Manager (Stage 0 + 3) — key `2`

1. QC grid (TP/FP/FN/TN) and **Missed act_now SLAs** (never auto-accept).
2. **Detector freeze**: read the printed rule. Button stays **disabled** until n≥20 and FA%>25. That is the spec, not a bug.
3. Coverage map: sensed vs dark; **mapping signed** on sensed stations.
4. Click **Queue for maintenance window**. Backlog lists the dark cell. Sensed count does **not** jump.

## 5. Leadership (Stage 5) — key `3`

1. Cost row: remaining sensors, 12-station kit, 3-site scale.
2. **Shop B go / no-go**: **Accept** = copy playbook + priors, local freeze. Or **Dismiss** if no inspect gate.
3. Click **Export HITL audit JSON**. That file is the decision log.

## 6. Recover

1. Key `1` back to supervisor.
2. **Recover in maintenance window**. Say: *“Hardware only when the line is already down.”*

## What judges should be able to repeat

> The last alert was S3 becoming the constraint. I accepted it and pre-staged the buffer. Weld flags stay on the at-risk list until S12 inspect grades them.
