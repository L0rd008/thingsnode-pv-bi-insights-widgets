# Lifetime ESG Summary Card - Quick Read and Setup

## 0) What this means in a PV plant
- This card converts lifetime energy into three long-term impact KPIs:
  - CO2 avoided
  - Equivalent homes powered
  - Years since commissioning
- It is used for sustainability reporting and stakeholder communication.

## 1) Calculations performed
Given `rawEnergy = DS[0]`:
1. Apply divider:
   - `energy = rawEnergy / divider`
2. CO2 avoided:
   - `co2 = energy * co2Factor` (default factor in `tCO2 per kWh`)
   - auto-scale to `ktCO2` if `|co2| >= 1000`, otherwise `tCO2`
3. Homes equivalent:
   - `homes = energy / homeFactor`
4. Years since commissioning:
   - If `staticYears` is numeric, use it directly.
   - Else calculate from `startDate` to current date.

## 2) Modes / branches
| Branch | Trigger | Behavior |
|---|---|---|
| Static years mode | `staticYears` is set | Uses fixed years value |
| Dynamic years mode | `staticYears` empty/NaN | Computes years from `startDate` |
| No-data energy branch | Missing/invalid `DS[0]` | Energy treated as `0`, derived metrics become zeroed |

## 3) Telemetry requirements and datasource order
- Required:
  - `DS[0]`: lifetime energy numeric value
- Additional datasources are ignored by current logic.
- Order matters because code uses `data[0]` only.

## 4) Units (input vs output)
- Input energy unit should align with configured factors:
  - default `co2Factor=0.0007` assumes `energy` in kWh.
  - default `homeFactor=1330` also assumes kWh baseline.
- Output units:
  - CO2: `tCO2` or `ktCO2`
  - Homes: `homes`
  - Time: `years`

## 5) ThingsBoard setup checklist
1. Add widget as `Latest values`.
2. Map `DS0` to cumulative/lifetime energy key.
3. Confirm energy unit basis and set `divider`, `co2Factor`, `homeFactor` accordingly.
4. Choose static years or dynamic years via `startDate`.

## 6) Example telemetry
```json
{
  "ts": 1774051200000,
  "values": {
    "lifetime_energy_kwh": 185000000
  }
}
```

With defaults:
- `co2 = 185000000 * 0.0007 = 129500 tCO2` -> displayed as `129.5 ktCO2`
- `homes = 185000000 / 1330 = 139098 homes`
