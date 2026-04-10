# Curtailment vs Potential Power - TIMESERIES VERSION (V5)

This is the Timeseries wrapper for the Curtailment algorithm.

## 1) Setup Checklist
1. Add widget as **Time Series**.
2. Go to the widget Datasources menu:
   - Type: **Entity**
   - Entity Alias: Select your plant
   - Data keys: Add any key (e.g., `active_power`) just to satisfy ThingsBoard's UI constraints.
3. Save the dashboard.
4. (Tenant Admin) Click the gear icon inside the widget header to map your telemetry keys:
   - `Actual Power Keys` (e.g. `active_power, power_v3`)
   - `Setpoint Keys` (e.g. `setpoint_active_power, curtailment_limit`)
   - `Capacity Attribute Key` (default: `Capacity`, assumed kW by default)

## 2) User Roles
- **Customer Users / Customer Admins**: See two dropdown buttons (Timeframe, Display Unit) for day-to-day use. No access to advanced settings.
- **Tenant Admins**: See the gear icon for full settings (data keys, capacity config, display options, show/hide potential curve).

## 3) Display Behavior
- **Day views** (Today, Yesterday, Day Before): Chart shows **5:00 AM to 7:00 PM** with **5-minute interval** buckets.
- **Week views** (This Week, Previous Week): Full day (00:00-23:59) with **15-minute interval** buckets.
- **Month view** (This Month): Full day with **60-minute interval** buckets.

## 4) Datasets
- **Potential Power** (optional dashed white line): Half-sine bell fitted to production hours. Toggle on/off in admin settings.
- **Exported Power** (solid cyan line, filled to zero): Actual measured power.
- **Curtailment Limit** (orange dashed line): Visible when setpoint < 100%. Shows the grid-imposed cap.
- **Curtailment Loss** (red shaded area): Gap between the curtailment limit and exported power.
- **Curtailment Markers** (orange dots): Mark the start and end of each curtailment event.

## 5) Calculations
- `Curtailment Ceiling = Capacity * (Setpoint% / 100)` when setpoint < 100%
- `Loss per bucket = max(0, Capacity - Ceiling) * bucketHours`
- Setpoint uses step-hold interpolation with 30-day lookback (handles irregular updates).

## 6) Performance
- Power data uses **server-side aggregation** (TB `agg=AVG`) to minimize payload size.
- Setpoint data fetched separately with raw values (small dataset, needs lookback).
- Capacity attribute, power telemetry, and setpoint telemetry are fetched **in parallel**.
