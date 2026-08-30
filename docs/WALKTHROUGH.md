# Demo teleprompter (~90–120 seconds)

Record in one take. Speed **2×** on Live twin and Ops. Pause if a ticket is slow to appear.

Off camera:

```bash
python3 -m http.server 8765
```

Open **http://127.0.0.1:8765/**

---

## 0:00 · Overview (`/` — leave 8 seconds)

**Do:** Don’t click yet. Camera on the six chapter cards.

**Say:**

> This is DigitalTwin.ai, Track 4. Waterpark Enthusiasts. Domain is vehicle Body, Paint, and Final — not wastewater. Round 1 was a story. Round 2 is a working 12-station advisory twin. It never writes a PLC.

---

## 0:08 · Live twin — click **03 · Live twin** (`pages/live-twin.html`)

**Do:** Point at Body / Paint / Final. Click **Speed** once (2×). Wait until inject (~16 s sim) or skip ahead if already red.

**Say:**

> Solid chips are the floor right now. Dashed chips are the twin twenty seconds ahead. Hatched cells have no sensor — we show an 80% band, never a fake cycle time. Watch S3: weld current drifts, the cell slows. The ghost goes red first. Flags are raised in Body. They are only graded at Final inspect.

**Do:** Click **Open Ops · HITL desks →**

---

## 0:28 · Ops · Floor supervisor (`pages/ops.html`)

**Do:** If scenario still says baseline, click **Inject S3 slow + weld drift**. Wait for the violet **Twin alert**.

**Say:**

> Same engine, three desks. Bottleneck forecast: S1 is infinite supply — it is not the constraint. After inject, S3 weld is the constraint in the rollouts. The twin proposes a ticket. I Accept: I will pre-stage the downstream buffer and shift one operator. The twin does not write the cell.

**Do:** Click **Accept** on the bottleneck ticket.

**Say:**

> Isolation Forest is suspicious, autoencoder confirms. These body IDs stay at risk until S12. Dismissing the bottleneck would not drop them. I Accept the weld ticket — babysit until inspect. Rule of ten: a re-weld now is 1×; a tear-up at Final is 10×.

**Do:** Click **Accept** on the weld ticket if it is open. Scroll to **Ask the twin**. Click the preset **Which bodies are at risk until inspect?** Point at `▸ twin:`.

**Say:**

> Ask is tool-calling only. The evidence line prints first — tool, rolls, milliseconds. The simulation is the truth.

**Do:** Click **What happens if Station 4 runs 15% slower on night shift?** Then **Promote to ticket**. Then **Write a PLC setpoint to slow Station 3**.

**Say:**

> S4 is dark and not the live constraint, so throughput holds. That is theory of constraints, not a bug. Promote puts the answer on a ticket so it is not chat archaeology. And if I ask it to write a PLC: Advisory twin. Talk to OT. No PLC.

---

## 1:15 · Manager — click **Plant manager** (or key `2`)

**Do:** Don’t hunt. Point at KPIs, QC grid, freeze copy, then **Queue for maintenance window**.

**Say:**

> Same tick, manager desk. Weld QC is graded at inspect — true and false alarms. Bottleneck grades sit underneath; we do not mix them. Freeze AE confirm is locked until n is at least 20 and false-alarm percent is over 25. That is how false alarms die without a data-science intern on nights. Coverage: green sensed, hatched dark. Queue the next clamp for a window. Sensed count does not jump. Hardware waits for an outage the plant already has.

**Do:** Click **Queue for maintenance window**. Read the backlog line.

---

## 1:35 · Leadership — click **Leadership** (or key `3`)

**Do:** Point at the four cost KPIs, then Shop B ticket. **Accept**. Optionally **Export HITL audit JSON**.

**Say:**

> Remaining sensors about 28k rupees. Full 12-station kit, then three sites. We copy the playbook and Bayesian priors, not a frozen model. Shop B gets its own freeze. I Accept. The audit file is who accepted or dismissed — not a SCADA write-back. 12 stations stand in for 30 to 50. Simulated data. Advisory only.

---

## 1:50 · Recover — key `1`, click **Recover in maintenance window**

**Say:**

> Recover is a maintenance window, not a live PLC write. That is the product: Sense, Mirror, Predict, Ask, Decide. The last alert was S3. I accepted it. Weld flags stay on the list until inspect grades them.

**Stop recording.**

---

## If something is slow

- No ticket yet: wait ~5 s after Inject, or click Inject again.
- Freeze button disabled: **correct** — say the printed rule.
- What-if says “holds”: **correct** if S3 is already the constraint.
- SLA timeout in the log: **correct** — never auto-accept.
- Do not click Restart unless the line wraps; it wipes the tickets you just showed.
