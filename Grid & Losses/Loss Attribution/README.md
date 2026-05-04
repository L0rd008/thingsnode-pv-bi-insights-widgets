# Loss Attribution - Quick Read and Setup

## What It Does

This widget has two jobs:

- In `grid`, `curtail`, and `revenue` modes it can compute the selected range directly from plant telemetry: `active_power`, `potential_power`, setpoint, capacity, and tariff.
- In `rangeSelector` mode it becomes a compact shared time-range control for every Loss Attribution card on the dashboard.

The original latest-value behavior remains the fallback. If telemetry, entity context, or tariff is missing, the widget reads `DS[0]` exactly like the older card.

## Modes

| Mode | Computed value | Display |
|---|---|---|
| `grid` | `sum(max(potential_power - active_power, 0))` | MWh |
| `curtail` | `sum(max(potential_power - max(curtailment ceiling, active_power), 0))` when setpoint `< 99.5` | MWh |
| `revenue` | grid gross loss kWh times `tariff_rate_lkr` | LKR |
| `curtailRevenue` | curtailment loss kWh times `tariff_rate_lkr` | LKR |
| `insurance` | unchanged latest-value fallback | LKR |
| `rangeSelector` | writes `LossAttributionRange` dashboard state | compact selector |

## Datasources and Order

The computed modes use the datasource entity, not the datasource value, as the plant context. Put the plant asset alias first as `DS[0]`; the widget then fetches telemetry and attributes from that entity by key. If `DS[0]` is not available, the widget falls back to dashboard `SelectedAsset`. If computed data still cannot be resolved, it falls back to the original latest-value behavior and reads `DS[0]` value data.

| Mode | Datasource order | Required data |
|---|---|---|
| `grid` | `DS[0]`: plant asset datasource. Any key can be used as the ThingsBoard placeholder key. | Telemetry keys from `actualPowerKeys` and `potentialPowerKeys`; defaults are `active_power` and `potential_power`. |
| `curtail` | `DS[0]`: plant asset datasource. Any key can be used as the ThingsBoard placeholder key. | `active_power`, `potential_power`, one of the setpoint keys, and plant capacity from `plantCapacityKey`; defaults are `setpoint_active_power, curtailment_limit, power_limit` and `Capacity`. |
| `revenue` | `DS[0]`: plant asset datasource. Any key can be used as the ThingsBoard placeholder key. | `active_power`, `potential_power`, and plant tariff attribute `tariff_rate_lkr`. Tariff is read from `SERVER_SCOPE` first, then `SHARED_SCOPE`. |
| `insurance` | `DS[0]`: latest-value datasource for the claimable/manual insurance loss value. | The widget uses the `DS[0]` numeric value directly. Computed telemetry, potential power, and tariff are not used. |
| `rangeSelector` | No datasource is required for day, month, year, or custom ranges. Optional `DS[0]`: plant asset datasource. | The optional plant datasource lets Lifetime read `lifetimeStartAttributeKey`, default `commissioning_date`. Without it, Lifetime uses `lifetimeStartDate`, default `2020-10-01`. |

Recommended widget instances:

| Instance | `cardMode` | Datasource setup |
|---|---|---|
| Range selector | `rangeSelector` | No datasource required, or plant asset alias as `DS[0]` for Lifetime start lookup. |
| Grid loss card | `grid` | Plant asset alias as `DS[0]`; keep an old latest-value loss key here if you want fallback to show that value. |
| Curtailment loss card | `curtail` | Plant asset alias as `DS[0]`; capacity must be available through the configured capacity attribute/key. |
| Revenue loss card | `revenue` | Plant asset alias as `DS[0]`; add `tariff_rate_lkr` to the plant asset. |
| Insurance card | `insurance` | Claimable insurance loss latest-value datasource as `DS[0]`. |

## Shared Range State

The selector writes this dashboard state parameter:

```json
{
  "mode": "day | month | year | lifetime | custom",
  "startTs": 1774972800000,
  "endTs": 1777651199999,
  "label": "Current Month",
  "updatedAt": 1774972800000
}
```

Normal cards read `LossAttributionRange`; if it is missing, they default to current month-to-date.

## Comparison Delta

The small footer delta compares normalized loss rate:

```text
lossRate = lossKWh / potentialEnergyKWh
```

Lower loss rate is green, higher loss rate is red, and near-equal values are gray.

- Current day/month/year compares to the previous day/month/year.
- Past day/month/year compares to the current day/month/year.
- Custom range compares to the immediately preceding equal-length range.
- Lifetime does not show a delta.

## Query Behavior

Power and potential telemetry use the same safe query rule as the V5 chart: `AVG` is used when the selected bucket count is 720 or less, and larger ranges fall back to raw chunked reads with client-side bucketing. Setpoint telemetry is fetched raw with a 30-day lookback for step-hold behavior.

## ThingsBoard Setup

1. Add one copied Loss Attribution instance and set `cardMode = rangeSelector`.
2. Keep the normal card instances as `grid`, `curtail`, `revenue`, and `insurance`.
3. Use a plant asset datasource, or rely on dashboard `SelectedAsset`.
4. Add the plant attribute `tariff_rate_lkr` in LKR/kWh for revenue mode.
5. Confirm these settings match plant telemetry:
   - `actualPowerKeys`: `active_power`
   - `potentialPowerKeys`: `potential_power`
   - `setpointKeys`: `setpoint_active_power, curtailment_limit, power_limit`
   - `plantCapacityKey`: `Capacity`

## Server-side Aggregation (Fast Path)

The widget supports a pre-computed fast path powered by the **Pvlib loss-rollup job** (`app/services/loss_rollup_job.py`). When enabled, the widget reads daily aggregate keys and lifetime attributes from ThingsBoard instead of downloading minute-cadence data and integrating in the browser. This eliminates dashboard hangs on year and lifetime ranges.

### How it works

The Pvlib-Service computes and writes the following keys once per day (00:10 local time):

- **Daily timeseries keys** (one record per plant per calendar day, timestamped at local midnight): `loss_grid_daily_kwh`, `loss_curtail_daily_kwh`, `loss_revenue_daily_lkr`, `loss_curtail_revenue_daily_lkr`, `potential_energy_daily_kwh`, `exported_energy_daily_kwh`.
- **Lifetime SERVER_SCOPE attributes** (cumulative since commissioning): `loss_grid_lifetime_kwh`, `loss_curtail_lifetime_kwh`, `loss_revenue_lifetime_lkr`, `loss_curtail_revenue_lifetime_lkr`, `potential_energy_lifetime_kwh`, `exported_energy_lifetime_kwh`.

For month/year ranges the widget reads ~30/365 daily rows and sums them in the browser — fast compared to 44 000+ minute rows. For lifetime it reads a single attribute value.

### The `useNewLossKeys` setting

| Value | Behaviour |
|---|---|
| `auto` (default) | Use precomputed keys when available. If the keys are absent (plant not yet rolled up) fall back silently to the legacy per-minute path. Today's current-day range always uses per-minute data regardless of this setting. |
| `force` | Always use precomputed keys. If they are absent, render `--` placeholders (no fallback). |
| `off` | Always use the legacy per-minute compute path. |

### Fallback chain

1. Precomputed daily/lifetime keys (fast) — if `useNewLossKeys` ≠ `"off"`.
2. Per-minute timeseries fetch + client-side integration (legacy) — on any failure or when keys are absent in `auto` mode.
3. `DS[0]` latest-value fallback — if telemetry fetch fails entirely.

### Enabling server-side aggregation

1. Deploy Pvlib-Service with `LOSS_ROLLUP_ENABLED=true` in `.env`.
2. Run a backfill for the desired plant: `POST /admin/run-loss-rollup?start=YYYY-MM-DD&end=YYYY-MM-DD`.
3. Verify: `GET /admin/loss-status?asset_id=<uuid>` shows non-sentinel values.
4. The widget will automatically pick up the new keys on the next render.

The Pvlib-Service admin endpoints:
- `POST /admin/run-loss-rollup` — compute/backfill daily keys for a date range.
- `POST /admin/recompute-lifetime` — recompute lifetime attributes from full history.
- `GET /admin/loss-status?asset_id=<uuid>` — inspect latest daily values and lifetime attributes.

## Fallback Behavior

When computed mode cannot run:

- `grid`, `curtail`, `revenue`, and `curtailRevenue` fall back to `DS[0]`.
- `insurance` always uses `DS[0]`.
- Severity thresholds and formatting remain compatible with the older widget.
