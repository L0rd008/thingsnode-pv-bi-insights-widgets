# ESG KPI Card - Quick Read and Setup

## 0) What this means in a PV plant
- This card visualizes one ESG metric (carbon, water, waste, renewable share, or custom).
- In PV reporting, these KPIs communicate environmental co-benefits beyond energy generation.

## 1) Modes and default behavior
| Mode (`cardMode`) | Default unit | Default warning | Default critical | Notes |
|---|---|---:|---:|---|
| `carbon` | `tCO2` | 500 | 100 | Auto-scale to `ktCO2` above 1000 |
| `water` | `kL` | 200 | 50 | Auto-scale to `ML` above 1000 |
| `waste` | `t` | 50 | 10 | Auto-scale to `kt` above 1000 |
| `renewable` | `%` | 60 | 30 | Delta is disabled by code |
| `custom` | empty | none | none | Use manual settings for unit/thresholds |

## 2) Calculations performed
1. Reads `DS[0]` as primary value.
2. Applies divider:
   - `baseVal = DS0 / divider`
3. Unit scaling (if `autoScale=true` and mode has scale table):
   - Carbon: `tCO2 -> ktCO2`
   - Water: `kL -> ML`
   - Waste: `t -> kt`
4. Value formatting with `decimals`.
5. Optional delta (except renewable):
   - Requires `DS[1]` target.
   - Computes `%` difference vs target and shows arrow.
6. Optional status badge:
   - Uses `thresholdWarning` / `thresholdCritical` from settings if set,
   - otherwise mode defaults above.
   - `thresholdInvert` flips logic when lower values are better.

## 3) Telemetry requirements and datasource order
- Required:
  - `DS[0]`: metric value (numeric)
- Optional:
  - `DS[1]`: target value for delta comparison
- Additional datasources are ignored.
- Order matters because code uses fixed indices.

Per mode telemetry expectation:
- `carbon`: avoided CO2 quantity
- `water`: saved water quantity
- `waste`: diverted waste quantity
- `renewable`: renewable share percentage
- `custom`: any numeric ESG metric

## 4) Units (input vs output)
- Input unit is user-defined by telemetry + `divider` choice.
- Output unit:
  - mode default or `unit` override
  - may auto-scale to larger unit
- Delta output is always `%`.

Implementation note:
- Delta is calculated using scaled display values, not raw base values.
- If target and actual can fall into different scale buckets, keep `autoScale` off for more reliable delta math.

## 5) ThingsBoard setup checklist
1. Add widget as `Latest values`.
2. Set `cardMode`.
3. Map `DS0` metric value.
4. Optionally map `DS1` target value for delta.
5. Configure `divider`, `unit`, thresholds, and `thresholdInvert` as needed.

## 6) Example telemetry
Carbon mode example:

```json
{
  "ts": 1774051200000,
  "values": {
    "co2_avoided_tonnes": 1280,
    "co2_target_tonnes": 1200
  }
}
```

Renewable share example:

```json
{
  "ts": 1774051200000,
  "values": {
    "renewable_share_pct": 67.4
  }
}
```
