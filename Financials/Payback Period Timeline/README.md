# Payback Period Timeline - Quick Read and Setup

## 0) What this means in a PV plant
- This card shows how quickly CAPEX is recovered from project cash flows.
- Two metrics can be shown:
  - Simple Payback
  - Discounted Payback
- In PV finance:
  - lower payback years generally means faster capital recovery and lower investor exposure.

Important:
- This widget does not compute payback from cashflow streams.
- It only displays payback values provided by telemetry.

## 1) Display modes
| Mode | Trigger | Behavior |
|---|---|---|
| Simple only | `DS[0]` present, `DS[1]` missing/invalid | Shows simple marker only |
| Simple + Discounted | `DS[0]` and valid `DS[1]` | Shows both markers |
| No data | `DS[0]` missing | Placeholder values |

## 2) Calculations performed
1. Reads:
   - `simple = DS[0]`
   - `discounted = DS[1]` (optional)
2. Converts values to timeline positions:
   - `pctSimple = min(simple / maxYears * 100, 100)`
   - `pctDiscounted = min(discounted / maxYears * 100, 100)`
3. Timeline fill width follows simple payback marker.
4. Discounted marker is hidden if missing/invalid.
5. Axis labels are generated from `0` to `maxYears`:
   - step `1` (default)
   - step `2` if `maxYears > 10`
   - step `5` if `maxYears > 20`

## 3) Telemetry requirements and datasource order
- Required:
  - `DS[0]`: simple payback numeric
- Optional:
  - `DS[1]`: discounted payback numeric
- Additional datasources are ignored.
- Order matters because code uses fixed indices.

## 4) Units (input vs output)
- Input unit should match `unit` setting (default `Years`).
- Output text is formatted as:
  - `value.toFixed(decimals) + unit`
- If you prefer months, send month values and set `unit = Months`.

## 5) ThingsBoard setup checklist
1. Add widget as `Latest values`.
2. Map `DS0` simple payback.
3. Optionally map `DS1` discounted payback.
4. Set `maxYears` to match project horizon scale.
5. Set unit and decimals.

## 6) Example telemetry
```json
{
  "ts": 1774051200000,
  "values": {
    "simple_payback_years": 6.4,
    "discounted_payback_years": 8.1
  }
}
```

With `maxYears=10`:
- simple marker at `64%`
- discounted marker at `81%`
