# Finance KPI Card - Quick Read and Setup

## 0) What this means in a PV plant
- This is a generic finance KPI card for one primary metric plus optional comparison.
- Typical PV uses:
  - Revenue vs target
  - OPEX vs budget
  - EBITDA vs plan
  - Cost per kWh vs baseline
- The widget does not calculate finance models; it formats and classifies incoming telemetry.

## 1) Operating modes and states
| Mode/state | Trigger in code | Behavior |
|---|---|---|
| Base value mode | `DS[0]` exists | Shows formatted main KPI value |
| Delta mode | `DS[1]` exists and `>0` | Shows `%` delta vs comparator |
| Severity mode | `severityMedium` and `severityHigh` configured | Status badge = LOW/MODERATE/HIGH based on `DS[0]` |
| No-data mode | Missing/invalid `DS[0]` | Shows placeholders |

## 2) Calculations performed
1. Main value:
   - `raw = DS[0]`
   - `display = raw / divider`
2. Formatting:
   - If `enableAutoScale=true`: auto K/M/B suffix, static `mainUnit` is hidden
   - Else: fixed decimal formatting with `mainUnit`
3. Delta (if comparator exists):
   - `comp = DS[1]`
   - `pct = (raw - comp) / comp * 100`
   - Arrow: up if `pct>=0`, down otherwise
   - Color logic:
     - normal: positive is good
     - `invertDelta=true`: positive is treated as bad
4. Severity:
   - compare raw `DS[0]` against thresholds:
     - `< severityMedium` -> `LOW`
     - `>= severityMedium` and `< severityHigh` -> `MODERATE`
     - `>= severityHigh` -> `HIGH`

## 3) Telemetry requirements and datasource order
- Required:
  - `DS[0]`: primary KPI numeric value
- Optional:
  - `DS[1]`: comparator/target numeric value (for delta)
- Additional datasources are ignored by current logic.
- Order matters:
  - first datasource/key must be primary KPI
  - second datasource/key should be comparator if delta is needed

## 4) Units (input vs output)
- Input:
  - Any numeric finance metric unit (LKR, USD, millions, etc.)
  - If using delta, `DS[0]` and `DS[1]` must be on same basis
- Output:
  - Prefix: `currencySym`
  - Value: scaled by `divider`, optionally auto K/M/B
  - Suffix: `mainUnit` (hidden when auto-scale is enabled)
  - Delta: `%`

## 5) ThingsBoard setup checklist
1. Add widget as `Latest values`.
2. Map `DS[0]` to the main KPI key.
3. Map `DS[1]` to target/reference key if you need delta.
4. Set `divider`, `currencySym`, `mainUnit`, and decimals.
5. Configure `invertDelta` for metrics where lower is better (example: cost KPI).
6. Configure severity thresholds only if you want LOW/MODERATE/HIGH badge behavior.

## 6) Example telemetry
Example (revenue KPI):

```json
{
  "ts": 1774051200000,
  "values": {
    "monthly_revenue_lkr": 238000000,
    "monthly_revenue_target_lkr": 250000000
  }
}
```

Recommended settings for this example:
- `currencySym = LKR`
- `divider = 1000000`
- `mainUnit = M`
