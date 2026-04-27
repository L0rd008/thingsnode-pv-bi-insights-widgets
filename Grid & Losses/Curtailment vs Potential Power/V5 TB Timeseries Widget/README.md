# Curtailment vs Potential Power — V5 Timeseries Widget

V5 is the Timeseries-widget evolution of V3. It keeps the V3-style timeframe and interval controls,
adds calendar-based day navigation, and models potential power using real pvlib physics data fetched
directly from ThingsBoard when available, falling back to an internal half-sine model for day views
only.

> **Do not confuse this with V4**, which is a Latest Values widget.

---

## Potential Power — Two Sources

| Source | When used | Views |
|---|---|---|
| **TB Physics** (`potential_power` timeseries from pvlib-service) | When valid positive readings exist in the queried time window | **All views** — day, week, month |
| **Half-Sine Model** | When no TB physics data is available | Day views only |

- Negative values (`-1` sentinels written when pvlib has no valid computation) are silently dropped
  before bucketing — only positive readings are averaged into buckets.
- The summary bar shows `· TB Physics` or `· Sine Model` next to the Live/Simulated status label
  so you always know which source is active.
- The `hasPotentialData()` helper returns `true` when either TB physics data is available **or**
  the half-sine model applies (day view). Fill regions and legend items are gated on this flag, so
  week/month views that successfully fetch `potential_power` still render total-loss and
  curtailment-loss fills correctly.

---

## 1) Setup Checklist

1. Add the widget as a **Time Series** widget.
2. In the widget **Datasources** menu:
   - Type: **Entity**
   - Entity Alias: select the plant
   - Data keys: add at least one key such as `active_power` to satisfy ThingsBoard's UI requirement.
3. Save the dashboard.
4. As Tenant Admin, open the widget gear icon (⚙️) and configure:
   - `Actual Power Keys` — e.g. `active_power, power_v3`
   - `Setpoint Keys` — e.g. `setpoint_active_power, curtailment_limit`
   - `Potential Power Key` — e.g. `potential_power` (blank → half-sine model for day views only)
   - `Capacity Attribute Key` — default `Capacity`
   - `Capacity Unit` — `kW` or `MW`
   - `Display Unit` — `kW` or `MW`
   - `Fallback (kW)` — used if the capacity attribute is unavailable
   - `Decimal Places`, `Error Margin (%)`, `Show Potential Curve`

---

## 2) User Roles

| Role | Controls visible |
|---|---|
| Customer User / Customer Admin | Timeframe dropdown, Interval dropdown, Date navigation bar |
| Tenant Admin | All of the above **plus** the ⚙️ settings gear |

---

## 3) Display Behaviour

### Timeframe Windows

| Option | Window | Auto Bucket Size |
|---|---|---|
| Today | 5:00 AM → 7:00 PM | 5 min |
| Yesterday | 5:00 AM → 7:00 PM | 5 min |
| Day Before Yesterday | 5:00 AM → 7:00 PM | 5 min |
| This Week | Monday 00:00 → Sunday 23:59 | 15 min |
| Previous Week | Full Monday → Sunday | 15 min |
| This Month | 1st 00:00 → now | 1 hr |

- Day views always show the **full** 5 AM → 7 PM frame — future buckets are `null` until data arrives.
- `This Week` shows the full current week even before the week ends; future buckets remain `null`.
- `This Month` is clamped to the current time.

### Interval Override Dropdown

| Timeframe group | Auto | Available overrides |
|---|---|---|
| Day | 5 min | 1 min, 5 min, 10 min, 15 min, 30 min |
| Week | 15 min | 5 min, 15 min, 30 min, 1 hr, 2 hr, 4 hr |
| Month | 1 hr | 15 min, 30 min, 1 hr, 2 hr, 4 hr, 6 hr, 12 hr |

- **Auto** uses the timeframe default bucket size.
- Unsafe overrides that would exceed **5,000 plotted points** are silently rejected and fall back to Auto.
- When a non-auto override is active the interval button gains a cyan highlight (`override-active`).
- The active override is persisted via `localStorage` and restored on reload.

### Date Navigation

- **◀ Prev** / **Next ▶** move one day backward or forward in day mode.
- Clicking the **date label** opens a custom calendar popup.
- Future dates cannot be selected.
- Calendar days with daylight curtailment events are highlighted in amber.
- The calendar is opened by temporarily setting `overflow: visible` on all ancestor elements so it
  can escape the clipped widget card — ancestor styles are restored when the calendar closes.
  (Previous approach used `position: fixed` + dynamic viewport arithmetic, which was removed in
  favour of this simpler, more reliable overflow-escape technique.)

---

## 4) Dataset Layout

| # | Name | Visual | Notes |
|---|---|---|---|
| 0 | Potential Power | White dashed line | Shown on all views when TB physics data available; day views only for half-sine fallback |
| 1 | Exported Power | Cyan solid line | Always shown |
| 2 | Curtailment Limit | Orange dashed line | Drawn when setpoint < 99.5% |
| 3 | Total Loss Fill | Internal amber fill | Fills between exported power and the potential ceiling (non-curtailed gap) |
| 4 | Curtailment Loss Fill | Internal red fill | Fills from curtailment ceiling **down to** the potential line (red band above ceiling) |
| 5 | Curtailment Markers | Orange dots | First and last bucket of each curtailment event |
| 6 | Setpoint Limit | Amber dashed stepped line | Holds the raw setpoint-derived power level; `stepped: 'before'` |

> **Fill direction note:** Dataset 3 fills `above: amber` relative to dataset 1 (Exported Power).
> Dataset 4 fills `below: red` relative to dataset 0 (Potential Power), i.e. the region between
> the potential curve and the curtailment ceiling.

---

## 5) Calculations

- `Curtailment Ceiling = Capacity × (Setpoint% / 100)` when setpoint < 99.5%.
- `Total Loss per bucket = max(Potential − Exported, 0) × bucketHours`.
- `Curtailed Loss per bucket = max(Potential − Curtailment Ceiling, 0) × bucketHours`.
- During curtailed intervals the fills are split into two non-overlapping regions: amber for
  `Exported → Ceiling` and red for `Ceiling → Potential`.
- Actual power is allowed to exceed the modeled potential curve. Losses are clamped at zero
  instead of forcing the model upward.
- Setpoint uses **step-hold interpolation** with a 30-day lookback before `startTs`.
- If measured export exceeds configured capacity, the widget **auto-scales** capacity upward to
  avoid chart clipping (rounded up to the nearest 100 kW).

---

## 6) Query Strategy

V5 uses a shared safe query-selection rule for all power-series requests (power, setpoint,
potential):

| Scenario | Approx. intervals | Query mode |
|---|---:|---|
| Day @ 1 min | 840 | `agg=NONE` |
| Day @ 5 min | 168 | `agg=AVG` |
| Day @ 10 min | 84 | `agg=AVG` |
| Day @ 15 min | 56 | `agg=AVG` |
| Week @ 5 min | 2 016 | `agg=NONE` |
| Week @ 15 min | 672 | `agg=AVG` |
| Month @ 15 min | 2 880 | `agg=NONE` |
| Month @ 1 hr | 720 | `agg=AVG` |

- `agg=AVG` is used only when the interval count is **≤ 720**.
- When the interval count exceeds 720, the widget fetches raw telemetry with `agg=NONE` and
  performs client-side bucketing.
- The live-today **sunset-proxy** history request uses the same rule, so 1-minute day views never
  trigger the ThingsBoard `Incorrect TsKvQuery` interval error.
- The same `buildPowerTimeseriesUrl` helper is applied to the `potential_power` fetch, so
  fine-grained potential data is also protected by the 720-interval threshold.

---

## 7) Summary Bar

The summary bar can show (all separated by `|`):

| Token | Shown when |
|---|---|
| Live / Simulated · TB Physics / Sine Model | Always |
| Total Loss (value + % of potential) | Potential modeled and loss > 0 |
| Curtailed Loss (value ± margin + % of potential) | Curtailment detected |
| Hours curtailed | Curtailment detected |
| No losses detected | Potential modeled but zero loss |
| Potential model unavailable message | Non-day view with no TB physics data |
| Exported energy | Always |

---

## 8) Performance and Data Fetching

- **5 parallel requests** are issued per render cycle:
  1. Capacity attribute (via `attributeService`)
  2. Power telemetry (bucketed / raw)
  3. Setpoint telemetry (raw, 30-day lookback)
  4. Sunset-proxy history (prior 3 days, today view only)
  5. `potential_power` telemetry (TB physics, all views)
- All telemetry keys are URL-encoded individually before query assembly.
- `onDataUpdated` is **debounced by 250 ms** to avoid redundant fetch bursts.
- Setpoint telemetry is fetched raw with a 30-day lookback so step-hold interpolation is accurate
  at the start of the window.

---

## 9) Entity Resolution

V5 resolves the target entity by:

1. Scanning all configured datasources for the first entry with a valid `entityId` + `entityType`.
2. Falling back to `stateController.getStateParams().SelectedAsset` when dashboards pass the
   entity through navigation state.

---

## 10) settings.json Fields

The `settings.json` file exposes two ThingsBoard widget-settings fields. All other settings are
managed inside the widget's inline modal (gear icon, Tenant Admin only):

| Field | Default | Purpose |
|---|---|---|
| `dummyField` | *(empty)* | Placeholder satisfying TB's requirement for at least one declared setting. Displays a help hint about the inline modal. |
| `potentialPowerKeys` | `potential_power` | Timeseries key written by pvlib-service. The widget fetches this first and renders it as the dashed Potential Power line. Leave blank to fall back to the half-sine model. |

---

## 11) Simulation / Fallback Mode

When no live telemetry is returned (no datasource, or API error), the widget enters **Simulated**
mode (status badge: amber `SIMULATED`). It renders a synthetic 5 AM–7 PM sine-shaped potential
curve with a 70 % curtailment scenario between 10 AM and 2 PM, allowing the dashboard layout and
design to be verified without a real plant connection.
