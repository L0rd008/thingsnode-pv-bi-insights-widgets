# Grid Outage Event Summary - Quick Read and Setup

## 0) What this means in a PV plant
- This widget tracks and summarizes individual grid outages, identifying the resulting financial loss per event.
- It seamlessly scales to support both purely operational tracking and optional financial/insurance claim workflows (with its toggleable status column).

## 1) Data model and calculations
Expected input is a JSON array where each event has:
- `date`
- `eventType`
- `energyLost`
- `amount`
- `status` (Optional. Approved/Pending/Rejected or similar text. Only required if `showStatusColumn` is true).

Processing logic:
1. Parse event array from the telemetry key defined in `settings`.
2. Total financial loss calculates:
   - For claim workflows (Status enabled): sum of approved + pending (rejected excluded).
   - For pure operational tracking (Status disabled): sum of all events.
3. Rendering adapts dynamically, causing fields to horizontally expand to absorb the extra space if Status tracking is turned off.

## 2) Telemetry requirements
- Required:
  - `DS[0]`: JSON array of outages/events.
- By default, the widget looks for `grid_outage_data`, but this can be changed in settings under `Attribute Key Name`.

## 3) Units (input vs output)
- `energyLost` displayed with `energyUnit` (default `MWh`).
- Financial loss / `amount` displayed with `currencySym` (default `LKR`).
- No numeric conversion/scaling is applied by code.

## 4) ThingsBoard setup checklist
1. Add widget as `Latest values`.
2. Map your telemetry key to contain a JSON array payload.
3. Select whether to show/hide the **Status Column** in the Settings tab.
4. Set your `currencySym` and `energyUnit`.
5. Disable `enableDemoData` in production.
