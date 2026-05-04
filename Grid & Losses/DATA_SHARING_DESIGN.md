# Grid & Losses — Cross-Widget Data Sharing Design

**Scope:** `grid_loss` state in `Dashboard.json` (8 widgets).
**Focus widget:** `V5 TB Timeseries Widget` (Curtailment vs Potential Power).
**Consumers:** Loss Attribution (4 modes), Capacity Factor Compliance, Grid Outage Event Summary, Grid Outage Timeline.

---

## 1. Current State (verified, not assumed)

**V5 computes, in-memory only:**

| Quantity | Variable / location | Semantics |
|---|---|---|
| Potential power series | `potential[]` (per bucket, kW) | Modeled half-sine bell when no external key exists |
| Exported power series | `exported[]` (per bucket, kW) | Measured `active_power`, bucketed |
| Curtailment ceiling series | `ceiling[]` (per bucket, kW) | `capacity × setpoint% / 100` when setpoint < 99.5% |
| Setpoint line | Dataset 6 (stepped) | Raw setpoint with 30-day lookback |
| Total loss | `totalLoss` scalar (kWh in summary bar) | `Σ max(potential − exported, 0) × bucketHours` |
| Curtailment loss | `curtailedLoss` scalar (kWh in summary bar) | `Σ max(potential − ceiling, 0) × bucketHours` |
| Curtailment event days (calendar) | `_curtailedDays{}` map | Days where any daylight setpoint < 99.5% |

**V5 persists only settings** in `localStorage['tb_curt_settings_<widgetId>']`. No computed values are written anywhere — neither to attributes, nor to a bus, nor to state.

**Loss Attribution is a passive "latest value" card.** The code reads `self.ctx.data[0].data[0][1]` (literally one number from its one datasource), formats it per `cardMode` (grid / curtail / revenue / insurance), and colors a severity dot. It does nothing else. In `Dashboard.json` the four instances are bound to these server-side attributes on entity alias `512cc246-a610-a01b-1a55-7e5815d190dd`:

| Mode | Attribute key | Computed by |
|---|---|---|
| `grid` | `loss_grid_availability_mwh` | **Unknown / external** (not V5) |
| `curtail` | `loss_curtailment_mwh` | **Unknown / external** (overlaps V5) |
| `revenue` | `revenue_at_risk` | **Unknown / external** (derivable from V5 + tariff) |
| `insurance` | `loss_insurance_claimable` | **Unknown / external** (needs event classification) |

The other three widgets read their own independent keys (`contract_cf_target`, `actual_cf_ytd`, `insurance_claims_data`, `grid_outage_events`).

**Inter-widget communication that actually exists today:** none. Only `stateController.getStateParams().SelectedAsset` is used — and only for entity resolution, not data flow. No `postMessage`, no `BroadcastChannel`, no `window.dispatchEvent`, no shared singleton. Each widget is an island.

**V5 already has `self.ctx.attributeService` in hand** (it uses it to read the `Capacity` attribute). So writing attributes from V5 is mechanically possible — the question is whether it's a good idea.

---

## 2. Root-Cause Hypotheses (why the duplication exists)

**H1 — No shared layer was ever built.** Each widget solved its own telemetry needs against ThingsBoard directly; no author ever had the task of "share what V5 just computed." The grep confirms zero cross-widget primitives.
Rating confidence: **95%**.

**H2 — ThingsBoard does not ship an idiomatic in-dashboard data bus.** Widgets are designed as isolated views over telemetry/attributes/alarms. `stateController` is for *navigation parameters*, actions are for *click handlers*. Neither fits a "V5 just finished a bucket pass, here is the new curtailment loss kWh" push.
Rating confidence: **92%**.

**H3 — The Loss Attribution attributes are meant to be populated by the backend, not by a widget.** `loss_curtailment_mwh` as a server-scope attribute on the plant entity is the signature of a rule chain / scheduled job, not a widget's responsibility.
Rating confidence: **90%**.

**H4 — V5 knows things the backend doesn't.** V5 fits a half-sine potential model client-side when no `potential_power` series exists. The backend may not model potential at all, so V5 is not just duplicating — it's computing a value the rest of the stack can't easily reproduce. That matters for `revenue_at_risk` (needs potential × tariff) and for "loss vs the modeled curve".
Rating confidence: **95%**.

**H5 — Loss Attribution semantics are period-totals (MTD/YTD), V5 semantics are interactive windows (Today / This Week / picked date).** They are not the same number even if they share units. A naive "V5 writes, card reads" pipe would overwrite a YTD value with whatever window the last V5 viewer happened to pick. Confidence this semantic mismatch is real: **90%**.

---

## 3. Solution Hypotheses (rated, with confidence in the rating)

Scale: 1 (bad) — 10 (excellent). "Confidence" = my confidence that the rating is correct after weighing trade-offs.

### SH-A — Merge everything into a single "Grid & Losses Hub" mega-widget
Combine V5 + 4 cards + Capacity Factor + timeline + event summary into one widget.
**Pros:** single data pipeline, zero sync issues, one fetch.
**Cons:** destroys dashboard composition (can't resize/reorder independently); ~100 KB+ JS; you lose the ability to reuse `Loss Attribution` in other states (e.g., an Exec Overview); a regression in one sub-section breaks the whole panel; Tenant admins lose fine-grained permissions/visibility.
**Rating: 2/10. Confidence in rating: 95%.**

### SH-B — V5 writes computed losses back as entity attributes
On each recompute, V5 calls `attributeService.saveEntityAttributes(entity, 'SERVER_SCOPE', [...])` to push `loss_curtailment_mwh`, `potential_energy_kwh_today`, etc. Loss Attribution cards stay unchanged.
**Pros:** zero change to consumer widgets; durable; any future widget gets it for free.
**Cons:** (1) Customer users usually lack attribute-write permission — writes will 403; (2) multiple concurrent viewers of V5 race each other; (3) V5's active window (Today / Yesterday / 2024-03-04) determines the value written — a user clicking "Day Before Yesterday" silently corrupts the dashboard for everyone else; (4) when no one has V5 open, values go stale.
**Rating: 4/10. Confidence in rating: 93%.** The permission and window-coupling issues are close to fatal.

### SH-C — Backend rule chain computes canonical period totals
A ThingsBoard rule chain (or scheduled Python job) computes `loss_curtailment_mwh`, `loss_grid_availability_mwh`, `revenue_at_risk`, `loss_insurance_claimable` as SERVER-SCOPE attributes on the plant, refreshed every N minutes. Loss Attribution cards read those, unchanged.
**Pros:** correct source of truth; stateless; always up to date even with no widget open; correct permissions (server writes, clients read); independent of V5's active window.
**Cons:** work happens outside the widget repo; doesn't give **interactive** sync — if a user picks "Yesterday" in V5, the cards still show MTD.
**Rating for "official numbers" job: 8/10. Confidence: 94%.**
**Rating for "V5-interactive sync" job: 2/10. Confidence: 95%.** (Wrong tool for it.)

### SH-D — In-browser pub/sub bus (`window.__gridLossBus`)
V5 publishes `{ tf, startTs, endTs, curtailedLossKwh, totalLossKwh, potentialEnergyKwh, exportedEnergyKwh }` every time it finishes a recompute. Loss Attribution cards (extended) subscribe and, when the user toggles a per-card "Follow chart window" option, display the bus value instead of the datasource value.
**Pros:** zero backend change; reactive to timeframe, interval, and date-picker changes; millisecond latency; opt-in per card.
**Cons:** live only (nothing persists if V5 isn't mounted); requires code change in every consumer widget; single `window` singleton leaks across dashboards on the same tab; modest coupling risk.
**Rating: 7/10. Confidence: 93%.** Great for interactivity, not a replacement for durable period totals.

### SH-E — Shoehorn computed data into `stateController.updateState(...)`
Push V5's numbers into dashboard state params.
**Pros:** built-in TB API.
**Cons:** `stateController` is explicitly for navigation params (entity IDs), triggers full state re-evaluation / re-render cascades on every update, not intended for high-frequency numeric streams. Idiomatic antipattern.
**Rating: 3/10. Confidence: 91%.**

### SH-F — Widget action wired through the dashboard
Use TB's `widgetActions` so V5 can fire a custom action that other widgets react to.
**Pros:** officially supported.
**Cons:** actions are built for user-initiated events (row click, dot click). Firing an action from a background `onDataUpdated` cycle against 4 targets every 250 ms is not what the mechanism is designed for, and dashboard action sources are brittle to widget IDs changing.
**Rating: 4/10. Confidence: 90%.**

### SH-G — BroadcastChannel across tabs
Same shape as SH-D, but `new BroadcastChannel('grid-loss')`.
**Pros:** standard API; survives iframe boundaries.
**Cons:** cross-tab is almost always unwanted here (user has two dashboards open → numbers flicker between contexts); all of SH-D's other caveats.
**Rating: 5/10. Confidence: 90%.**

### SH-H — Hybrid: SH-C (durable totals) + SH-D (interactive sync)
Two orthogonal channels serving two different use cases:
1. **Backend rule chain (SH-C)** keeps the server-scope attributes `loss_*` / `revenue_at_risk` fresh as period totals — the "canonical" numbers that match what a manager sees when they land on the dashboard with nothing open.
2. **Pub/sub bus (SH-D)** lets the cards (and future widgets) opt into "follow the V5 chart". When the user picks a different day/week in V5, a card in "Follow chart" mode updates instantly with the window-scoped number V5 just computed. When "Follow chart" is off (default), the card shows the attribute and behaves exactly as today.

**Pros:**
- Correct default behavior with no V5 open (SH-C handles it).
- Interactive exploration when V5 *is* open (SH-D handles it).
- No shared global responsibility (writes on server, reads on client).
- Backward-compatible: if we ship only the bus, cards still work. If we ship only the rule chain, cards still work. They compose.
- The bus also unblocks future widgets (e.g., a "Curtailment event table" that hot-tracks V5's date navigation).

**Cons:**
- Two subsystems to maintain.
- Needs a thin contract doc so the payload shape is stable.

**Rating: 9/10. Confidence: 94%.**

---

## 4. Recommendation

**Go with SH-H (hybrid).** Neither channel does both jobs; forcing either one to do both produces the fatal flaws listed in SH-B / SH-C-for-interactivity.

The split is clean:
- "What's the curtailment loss this month?" → **attribute** (written by backend).
- "What's the curtailment loss on the day I just picked in the chart?" → **bus** (published by V5).

---

## 5. Implementation Plan

### Phase 1 — Client bus (SH-D), no backend dependency

1. **Add a tiny bus module** that lives on `window.__gridLossBus`, created on first use. Shape:
   ```js
   window.__gridLossBus ||= {
     _subs: new Map(),           // topic -> Set<handler>
     _last: new Map(),           // topic -> last payload (late-subscriber replay)
     publish(topic, payload) {...},
     subscribe(topic, handler) {...}, // returns unsubscribe fn; replays _last on subscribe
   };
   ```
   Embed it inline in V5's `.js` (top of file) and in the extended Loss Attribution `.js`. Creating it in both places is fine — the `||=` guard makes it a shared singleton.

2. **V5 — publish on every completed recompute.** After `processLiveTimeSeries(...)` finishes and the summary numbers are computed, call:
   ```js
   window.__gridLossBus.publish('grid_loss.v5.snapshot', {
     entityId: entity.id,
     timeframe: s.timeframe,
     selectedDate: _selectedDate ? _selectedDate.toISOString() : null,
     startTs, endTs,
     curtailedLossKwh, totalLossKwh,
     potentialEnergyKwh, exportedEnergyKwh,
     updatedAt: Date.now()
   });
   ```
   Topic is namespaced so future widgets can add their own without collisions.

3. **Loss Attribution — add a "Follow chart window" setting.** In `settings.json`, add `followChartWindow: false`. In the HTML modal (if/when admin settings are exposed) show a toggle. In `.js onInit`, subscribe to `grid_loss.v5.snapshot` and, when `followChartWindow` is true, replace `val` with the bus's corresponding field based on `cardMode`:
   - `grid` → (no V5 equivalent yet; fall back to datasource)
   - `curtail` → `payload.curtailedLossKwh / 1000` (convert to MWh)
   - `revenue` → `payload.curtailedLossKwh × tariffLkrPerKwh` (tariff from settings)
   - `insurance` → (no V5 equivalent; fall back to datasource)
   Always unsubscribe in `onDestroy`.

4. **UI cue.** When a card is in Follow-chart mode, append a small label to the subtitle — e.g. "for Today", "for Yesterday", "for 2026-04-14" — so viewers don't confuse the live window with an MTD figure.

5. **Entity guard.** The bus payload includes `entityId`. Cards must check `payload.entityId === myEntity.id` before accepting; prevents cross-plant leakage if a dashboard later shows multiple plants.

6. **Test harness.** Re-use the existing `test_harness.html` pattern. Open V5 and a Loss Attribution card side-by-side; flip V5's timeframe and confirm the card follows within 250 ms.

### Phase 2 — Backend canonical totals (SH-C), runs independently

1. **Rule chain node (preferred) or cron job**, keyed off the plant entity, on a schedule that matches product needs (hourly is usually enough):
   - `loss_curtailment_mwh` — recompute from raw telemetry using the same formula V5 uses (`Σ max(potential − ceiling, 0)`). Specify the window explicitly in a sibling attribute (`loss_curtailment_window` = `MTD` or `YTD`) so the number is never ambiguous.
   - `loss_grid_availability_mwh` — compute from grid outage events (already in `grid_outage_events`) as `Σ energyLost`.
   - `revenue_at_risk` — `potential_energy_kwh × ppa_tariff_lkr_per_kwh`.
   - `loss_insurance_claimable` — subset of events with `severity ∈ {high, maint-with-claim}` and approved status from `insurance_claims_data`.
2. **Potential model stays in V5.** Do not try to replicate the half-sine fit in the rule chain unless you're prepared to port and test it; the rule chain can use `potential_power` if it exists as telemetry, and fall back to a simpler daylight-capacity envelope otherwise. V5 retains its edge as the interactive modeler.
3. **Do not let V5 write attributes.** Keep V5 read-only on attributes; eliminates race conditions and permission issues.

### Phase 3 — Harden

- Document the bus contract (topics, payload shapes, versioning field) in `M:\Documents\Projects\MAGICBIT\Widgets\Grid & Losses\BUS_CONTRACT.md`.
- Add a `schemaVersion` field to payloads from day one.
- Add a no-op fallback in consumers: if the bus is absent (e.g., Loss Attribution loaded before V5 mounts), the card reads from datasource as today.

---

## 6. What this does NOT solve (on purpose)

- **Capacity Factor Compliance**, **Grid Outage Timeline**, **Grid Outage Event Summary** — these compute from independent domains (capacity factor, outage events, claims). They shouldn't subscribe to V5. Leave them alone; they don't have overlap worth sharing.
- **Cross-plant dashboards** — the bus is per-tab and filtered on `entityId`. If a future dashboard renders multiple plants, each V5 instance publishes its own entity-scoped snapshot and cards pick theirs. That's fine; it's not a multi-plant aggregator.

---

## 7. Open questions to resolve before Phase 1 merges

1. **Who owns the backend rule chain** that currently populates `loss_curtailment_mwh` etc.? Need to confirm it exists and is actually running — if it doesn't, Phase 2 is a prerequisite, not optional.
2. **PPA tariff location** — is the LKR/kWh rate an entity attribute (`ppa_tariff_lkr_per_kwh`) or a tenant setting? Revenue mode needs this.
3. **Time window for each card's "official" value** — MTD or YTD? The card currently just shows whatever scalar the backend stored; clarifying this lets us label the UI properly.
4. **Customer-user visibility of the "Follow chart window" toggle** — is it admin-only, or a normal-user feature?
