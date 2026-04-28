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
| `insurance` | unchanged latest-value fallback | LKR |
| `rangeSelector` | writes `LossAttributionRange` dashboard state | compact selector |

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

## Fallback Behavior

When computed mode cannot run:

- `grid`, `curtail`, and `revenue` fall back to `DS[0]`.
- `insurance` always uses `DS[0]`.
- Severity thresholds and formatting remain compatible with the older widget.
