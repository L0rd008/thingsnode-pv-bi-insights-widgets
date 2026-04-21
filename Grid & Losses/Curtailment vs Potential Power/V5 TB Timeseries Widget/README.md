# Curtailment vs Potential Power — TIMESERIES V5

V5 is the production-ready evolution of V3 (Timeseries). It preserves the full V3 architecture — server-side aggregation, inline settings modal, timeframe dropdown — and adds a calendar-based date navigation system with curtailed-day highlighting, a full-day 5 AM–7 PM view without data clipping, a stepped setpoint line, and several reliability improvements back-ported from V4.

> **Do not confuse with V4** (Latest Values Widget). V5 remains a Timeseries Widget.

---

## 1) Setup Checklist
1. Add widget as **Time Series**.
2. Go to the widget Datasources menu:
   - Type: **Entity**
   - Entity Alias: Select your plant
   - Data keys: Add any key (e.g., `active_power`) to satisfy ThingsBoard's UI constraints.
3. Save the dashboard.
4. (Tenant Admin) Click the **⚙️ gear icon** inside the widget header to map your telemetry keys:
   - `Actual Power Keys` (e.g. `active_power, power_v3`)
   - `Setpoint Keys` (e.g. `setpoint_active_power, curtailment_limit`)
   - `Capacity Attribute Key` (default: `Capacity`, assumed kW by default)

---

## 2) User Roles
- **Customer Users / Customer Admins**: See the **Timeframe dropdown**, **Display Unit dropdown**, and the **Date Navigation bar**. No access to advanced settings.
- **Tenant Admins**: Additionally see the **⚙️ gear icon** for full data-key and capacity configuration.

---

## 3) Display Behaviour

### Timeframe Dropdown (V3 preserved)
| Option | Window | Auto Bucket Size |
|---|---|---|
| Today | 5:00 AM → 7:00 PM (full, never clipped to now) | **5 min** |
| Yesterday | 5:00 AM → 7:00 PM | **5 min** |
| Day Before | 5:00 AM → 7:00 PM | **5 min** |
| This Week | 00:00 Mon → now | **15 min** |
| Previous Week | Full Mon–Sun | **15 min** |
| This Month | 00:00 1st → now | **1 hr** |

> **[F1] Bug Fix**: In V3, "Today" was clipped to the current time, leaving the right side of the chart empty as the day progressed. V5 always shows the full 5 AM–7 PM window. Buckets with no data yet are `null` (no line segment) — this is correct behaviour for a live day.

### Sensitivity / Interval Override Dropdown

The third button in the toolbar lets users override the automatic bucket size for the active timeframe, changing chart resolution (sensitivity):

| When Timeframe is… | Auto | Available Overrides |
|---|---|---|
| Day (today / yesterday / day before / calendar date) | 5 min | 1 min, 5 min, 10 min, 15 min, 30 min |
| Week (this week / prev week) | 15 min | 5 min, 15 min, 30 min, 1 hr, 2 hr, 4 hr |
| Month | 1 hr | 15 min, 30 min, 1 hr, 2 hr, 4 hr, 6 hr, 12 hr |

- **Auto** (default) uses the timeframe's built-in interval — the button label shows `Auto · X min`.
- When an override is active the button turns **cyan** to indicate manual control.
- Selecting **Auto** from the menu resets back to timeframe-driven defaults.
- **Safety guard**: overrides that would produce more than 5,000 data points for the active timeframe are automatically rejected and the widget falls back to Auto.
- **Timeframe switches**: when the timeframe changes to one where the current override would be unsafe (>5,000 points), the override is auto-cleared back to Auto. Safe overrides are preserved across timeframe switches.

### Date Navigation Bar [F2]
- **◀ Prev** / **▶ Next** buttons step one day backward or forward.
- **Clicking the date label** opens the custom calendar picker.
- The date label shows `Today — YYYY-MM-DD` (highlighted cyan) or `Mon — YYYY-MM-DD` for historic dates.
- The **▶ Next** button is automatically disabled when today's date is displayed.
- When a specific date is selected via the calendar or buttons, it overrides the dropdown's day selection but the timeframe setting is preserved for week/month switching.
- Selecting a week or month from the dropdown clears the date override.

### Custom Calendar Picker [F3]
- A fully styled 42-cell calendar overlay appears when the date label is clicked.
- Month navigation arrows allow browsing past months.
- **Curtailed days are highlighted in amber/orange**: days on which at least one setpoint reading below 99.5% was recorded during daylight hours (5 AM–7 PM) receive an amber background tint and an orange dot indicator.
- Curtailed-day data is fetched per calendar month as the user navigates.
- Future dates are greyed out and non-selectable.
- The currently selected date is highlighted with a cyan border.

---

## 4) Datasets

| # | Name | Visual | Condition |
|---|---|---|---|
| 0 | **Potential Power** | White dashed line | Day views only (fitted to actual production hours) |
| 1 | **Exported Power** | Cyan solid line, filled to zero | Always shown |
| 2 | **Curtailment Limit** | Orange dashed line (red fill above ds1) | When setpoint < 99.5% |
| 3 | **Curtailment Markers** | Orange circle dots | Start & end of each curtailment event |
| 4 | **Setpoint Line** [F4] | Amber dashed stepped line | When any curtailment is detected |

- **Potential Power** (ds0): Half-sine bell dynamically fitted between the first and last production bucket above 0.5% of capacity. Only shown on single-day views when enabled in settings.
- **Curtailment Limit** (ds2): `capacity × (setpointPct / 100)`. Drawn as an orange dashed line with red fill down to the exported line.
- **Curtailment Markers** (ds3): Orange dots placed at the start and end of each continuous curtailment event.
- **Setpoint Line** (ds4): The same limit value as ds2 but rendered as a **stepped** (`stepped: 'before'`) amber line — this makes setpoint transitions visually precise and matches the V4 aesthetic.

---

## 5) Calculations
- `Curtailment Ceiling = Capacity × (Setpoint% / 100)` when setpoint < 99.5%.
- `Loss per bucket = max(0, Capacity − Ceiling) × bucketHours` (curtailed buckets only).
- Setpoint uses **step-hold interpolation** with a **30-day lookback** before `startTs` (handles irregular setpoint update cadence).
- **Auto-capacity scaling** [F6]: If the maximum measured power exceeds the configured capacity, capacity is auto-scaled to `ceil(maxData × 1.1 / 100) × 100` to prevent chart clipping.

---

## 6) Summary Bar
The summary bar below the chart shows (when data is available):
- Data source status: `Live` or `Simulated`
- **Total Loss** (kWh / MWh + % of potential) — day views only
- **Curtailed Loss** (kWh / MWh ± error margin + %)
- **Hours curtailed**
- **Exported energy** total

---

## 7) Performance
- Power data uses **server-side aggregation** (`agg=AVG`) to minimise payload.
- Setpoint data fetched separately with raw values (`agg=NONE`) and 30-day lookback.
- Capacity attribute, power telemetry, and setpoint telemetry fetched **in parallel** [F6].
- A **250 ms debounce** prevents redundant re-fetches when ThingsBoard fires `onDataUpdated` multiple times for multi-key datasources [F6].
- Each telemetry key is individually URL-encoded before joining, preventing encoding errors with special characters [F6].

---

## 8) Entity Resolution [F6]
V5 adopts V4's robust entity resolution:
1. Iterates all configured datasources (not just `datasources[0]`).
2. Falls back to `stateController.getStateParams().SelectedAsset` for state-driven dashboards where the entity is passed via navigation state.

---

## 9) Changes vs V3

| Feature | V3 | V5 |
|---|---|---|
| Full-day view (no clip to now) | ✗ Clipped | ✔ Fixed [F1] |
| Date navigation | ✗ None | ✔ ◀ Prev / label / Next ▶ [F2] |
| Calendar picker | ✗ None | ✔ Custom overlay [F3] |
| Curtailed-day highlighting | ✗ None | ✔ Amber background + dot [F3] |
| Stepped setpoint line | ✗ None | ✔ ds4 amber stepped [F4] |
| Timeframe dropdown | ✔ | ✔ Preserved [F5] |
| Entity resolution robustness | Single datasource | Multi-datasource + stateController [F6] |
| Debounce on fetch | ✗ None | ✔ 250 ms [F6] |
| `onDataUpdated` hook | ✗ Not implemented | ✔ Implemented [F6] |
| Per-key URL encoding | ✗ Single encode | ✔ Per-key `encodeURIComponent` [F6] |
| Auto-capacity scaling | ✗ None | ✔ If data exceeds capacity [F6] |
