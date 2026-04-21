# Curtailment vs Potential Power - TIMESERIES V5

V5 is the Timeseries-widget evolution of V3. It keeps the V3-style timeframe and interval controls, adds calendar-based day navigation, and models potential power internally when no external potential-power series exists.

Do not confuse this with V4, which is a Latest Values widget.

## 1) Setup Checklist
1. Add the widget as a **Time Series** widget.
2. In the widget Datasources menu:
   - Type: **Entity**
   - Entity Alias: select the plant
   - Data keys: add at least one key such as `active_power` to satisfy ThingsBoard's UI requirement
3. Save the dashboard.
4. As Tenant Admin, open the widget gear icon and configure:
   - `Actual Power Keys`, for example `active_power, power_v3`
   - `Setpoint Keys`, for example `setpoint_active_power, curtailment_limit`
   - `Capacity Attribute Key`, default `Capacity`
   - `Capacity Unit`, default `kW`
   - `Display Unit`, `kW` or `MW`

## 2) User Roles
- Customer Users / Customer Admins: see the timeframe dropdown, interval dropdown, and date navigation bar.
- Tenant Admins: also see the settings gear for telemetry keys, capacity settings, display unit, loss margin, and potential-line display settings.

## 3) Display Behaviour

### Timeframe Windows
| Option | Window | Auto Bucket Size |
|---|---|---|
| Today | 5:00 AM -> 7:00 PM | 5 min |
| Yesterday | 5:00 AM -> 7:00 PM | 5 min |
| Day Before | 5:00 AM -> 7:00 PM | 5 min |
| This Week | Monday 00:00 -> Sunday 23:59 | 15 min |
| Previous Week | Full Monday -> Sunday | 15 min |
| This Month | 1st 00:00 -> now | 1 hr |

- Day views always show the full 5 AM -> 7 PM frame.
- `this_week` shows the full current week even before the week is complete; future buckets remain `null` until real data arrives.
- `this_month` remains clamped to the current time.

### Interval Override Dropdown
| Timeframe group | Auto | Available overrides |
|---|---|---|
| Day | 5 min | 1 min, 5 min, 10 min, 15 min, 30 min |
| Week | 15 min | 5 min, 15 min, 30 min, 1 hr, 2 hr, 4 hr |
| Month | 1 hr | 15 min, 30 min, 1 hr, 2 hr, 4 hr, 6 hr, 12 hr |

- Auto uses the timeframe default bucket size.
- Unsafe overrides that would exceed 5,000 plotted points are rejected and fall back to Auto.

### Date Navigation
- `Prev` and `Next` move one day backward or forward in day mode.
- Clicking the date label opens the custom calendar popup.
- Future dates cannot be selected.
- Calendar days with daylight curtailment events are highlighted in amber.

## 4) Dataset Layout
| # | Name | Visual | Notes |
|---|---|---|---|
| 0 | Potential Power | White dashed line | Day views only, optional display |
| 1 | Exported Power | Cyan solid line | Always shown |
| 2 | Curtailment Limit | Orange dashed line | Drawn when setpoint < 99.5% |
| 3 | Curtailment Loss Fill | Internal fill dataset | Fills red between potential and ceiling |
| 4 | Curtailment Markers | Orange dots | Start and end of curtailment events |
| 5 | Setpoint Limit | Amber dashed stepped line | Holds the current setpoint-derived limit |

## 5) Calculations
- `Curtailment Ceiling = Capacity * (Setpoint% / 100)` when setpoint < 99.5%.
- `Total Loss per bucket = max(Potential - Exported, 0) * bucketHours`.
- `Curtailed Loss per bucket = max(Potential - Curtailment Ceiling, 0) * bucketHours`.
- Actual power is allowed to exceed the modeled potential curve. Losses are clamped at zero instead of forcing the model upward.
- Setpoint uses step-hold interpolation with a 30-day lookback before `startTs`.
- If measured export exceeds configured capacity, the widget auto-scales capacity upward to avoid chart clipping.

## 6) Query Strategy
V5 uses a shared safe query-selection rule for power-series requests:

| Scenario | Intervals | Query mode |
|---|---:|---|
| Day @ 1 min | 840 | `agg=NONE` |
| Day @ 5 min | 168 | `agg=AVG` |
| Day @ 10 min | 84 | `agg=AVG` |
| Day @ 15 min | 56 | `agg=AVG` |
| Week @ 5 min | 2016 | `agg=NONE` |
| Week @ 15 min | 672 | `agg=AVG` |
| Month @ 15 min | 2880 | `agg=NONE` |
| Month @ 1 hr | 720 | `agg=AVG` |

- Power-series queries use `agg=AVG` only when the requested interval count is `<= 720`.
- When the interval count exceeds 720, the widget fetches raw telemetry with `agg=NONE` and performs client-side bucketing.
- The live-today sunset-proxy history request uses the same rule, so 1-minute day views do not trigger the `Incorrect TsKvQuery` interval error.

## 7) Summary Bar
The summary bar can show:
- Live or Simulated status
- Total Loss, with percent of potential
- Curtailed Loss, with margin and percent of potential
- Hours curtailed
- Exported energy

For non-day views, the widget does not model potential and instead reports that the potential model is unavailable for that view.

## 8) Performance and Data Fetching
- Capacity attribute, power telemetry, setpoint telemetry, and live-day sunset-proxy history are fetched in parallel when needed.
- Each telemetry key is URL-encoded individually before query assembly.
- `onDataUpdated` is debounced by 250 ms to avoid redundant fetch bursts.
- Setpoint telemetry is fetched raw with a 30-day lookback so step-hold interpolation remains accurate.

## 9) Entity Resolution
V5 resolves the target entity by:
1. Scanning all configured datasources for the first valid entity ID and type.
2. Falling back to `stateController.getStateParams().SelectedAsset` when dashboards pass the entity through navigation state.
