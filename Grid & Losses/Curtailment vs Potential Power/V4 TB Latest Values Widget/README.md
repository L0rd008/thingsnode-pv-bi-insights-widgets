# Curtailment vs Potential Power — LATEST VALUES VERSION (V4)

This is the **Latest Values** variant of the Curtailment widget.
It focuses on **single-day navigation** with a user-controlled date picker and configurable bucket interval, instead of V3's fixed timeframe dropdown.

> **Source of truth**: V3 Timeseries Widget. V4 was branched from V3 to experiment with date-based navigation and a visible setpoint line.

---

## 1) Setup Checklist
1. Add widget as **Latest Values**.
2. Go to the widget Datasources menu:
   - Type: **Entity**
   - Entity Alias: Select your plant
   - Data keys: Add any key (e.g., `active_power`) to satisfy ThingsBoard's UI constraints.
3. Save the dashboard.
4. (Dashboard Edit) Open the widget **Settings** panel to configure all data keys and display options — V4 uses the native TB settings form, not an inline modal.

---

## 2) Settings Reference (TB settings.json)
| Setting | Default | Description |
|---|---|---|
| `widgetTitle` | `CURTAILMENT VS POTENTIAL POWER` | Header text |
| `unitLabel` | `kW` | Y-axis and tooltip unit (kW or MW) |
| `actualPowerKeys` | `active_power` | Comma-separated telemetry keys for real exported power |
| `setpointKeys` | `setpoint_active_power, curtailment_limit, power_limit` | Comma-separated setpoint keys (% of capacity) |
| `plantCapacityKey` | `Plant Total Capacity` | Server-scope attribute key for plant capacity |
| `capacityUnit` | `MW` | Unit of the capacity attribute (converted to `unitLabel` if needed) |
| `maxPower` | `1000` | Fallback / simulation peak power in `unitLabel` units |
| `exportLimitKw` | `800` | Simulation curtailment ceiling |
| `sunriseHour` | `6` | Simulation sunrise (potential curve start) |
| `sunsetHour` | `18` | Simulation sunset (potential curve end) |
| `theoreticalMargin` | `10` | Error margin % applied to curtailment loss estimates |
| `decimals` | `1` | Decimal places in all displayed values |
| `showCurtailmentLabel` | `true` | Toggle the inline "Curtailed Energy" text on the chart |
| `accentColor` | *(blank)* | Override border/glow accent color (CSS value) |
| `tooltipText` | *(blank)* | Static tooltip override; leave blank for auto-generated |
| `smoothLines` | `false` | Bezier tension on lines (false = straight, true = curved) |

---

## 3) User Roles
- **All Users**: Full widget is visible. There is no role-gated gear icon — all configuration is done via the TB dashboard edit panel by the dashboard owner.
- **Date Navigation**: Available to all users (Previous/Next day, calendar picker).
- **Interval Selection**: Available to all users (1 / 5 / 10 / 15-minute dropdown).

---

## 4) Display Behaviour

### Date Navigation
- **◀ Prev** / **▶ Next** buttons step one day at a time.
- Clicking the **date label** opens a native calendar picker to jump to any past date.
- The label shows `Today — YYYY-MM-DD` (highlighted cyan) or `Mon — YYYY-MM-DD`.
- The **Next** button is disabled when on today; the picker's `max` attribute is set to today.

### Time Window
- **Today**: 00:00 to `now` (live partial-day view).
- **Any past date**: Full 24-hour window (00:00 → 23:59) of the selected date.
- All views are single-day only. Multi-day (week/month) views are not supported.

### Interval Selector
- Bucket size is user-selectable: **1 min / 5 min / 10 min / 15 min**.
- Changing the interval triggers an immediate re-fetch and re-render.
- Data is bucketed client-side (last-write-wins per bucket, no server aggregation).

### Data Window
- The chart always shows **5:00 AM to ~7:15 PM** (sliced to daylight hours based on interval).

---

## 5) Datasets

| # | Name | Visual | Condition |
|---|---|---|---|
| 0 | **Potential Power** | White dashed line | Always shown (pre-computed sine from `sunriseHour`/`sunsetHour`) |
| 1 | **Exported Power** | Cyan solid line, filled to zero | Always shown |
| 2 | **Curtailment Envelope** | Invisible (red fill between ds2 and ds1) | When setpoint < 99% and potential > allowed power |
| 3 | **Setpoint Limit** | Amber dashed stepped line (`#FFA726`) | When setpoint < 99.5% of capacity |

- **Potential Power**: A pure half-sine bell between configurable `sunriseHour` and `sunsetHour`. Unlike V3, it is **not** fitted dynamically to actual production data — it is always the theoretical maximum.
- **Setpoint Limit** (ds3): The allowed power ceiling (`capacity × setpoint%/100`), drawn as a **stepped** line that holds its value until the next setpoint update. This makes setpoint transitions visually precise.
- **Curtailment Envelope** (ds2): Invisible border used only to colour the red fill zone between itself and the exported line.
- **Auto-capacity scaling**: If live data exceeds the configured capacity, the capacity is auto-scaled to `ceil(maxDataValue × 1.1 / 100) × 100`.

---

## 6) Calculations

- `Setpoint% = step-hold lookup` in sorted setpoint telemetry (last value at or before bucket midpoint).
- `Allowed Power = capacity × (setpointPct / 100)` when `setpointPct < 99%`.
- `Curtailed Envelope[b] = max(potential[b], exported[b])` when curtailment is active.
- `Curtailed Energy (tooltip) = Σ max(envelope[b] − exported[b], 0) × bucketHours`.
- Setpoint data is fetched **only within the selected day** (no 30-day lookback).

---

## 7) Performance Notes
- All keys (power + setpoint) are encoded individually and merged into a **single HTTP request** using `agg=NONE` (raw values).
- Capacity attribute is fetched once per day-change, before the telemetry request.
- A **250 ms debounce** prevents redundant fetches when ThingsBoard fires `onDataUpdated` multiple times for multi-key datasources.
- Entity resolution iterates all configured datasources; falls back to `stateController.getStateParams().SelectedAsset` for compatibility with state-driven dashboards.

---

## 8) Known Limitations vs V3
- No **week or month view** — single-day only.
- No **role-based settings gear** — all config through the TB settings form.
- No **curtailment markers** (orange start/end dots) on the chart.
- No **summary bar** with kWh totals — replaced by a hover tooltip panel.
- Setpoint lookback is limited to the current day (setpoints issued before midnight may be missed if not re-issued at start of day).
- No display unit toggle (kW/MW) for customers — unit is fixed in settings.
