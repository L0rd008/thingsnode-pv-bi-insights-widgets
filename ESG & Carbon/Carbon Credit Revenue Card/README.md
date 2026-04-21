# Carbon Credit Revenue Card - Quick Read and Setup

## 0) What this means in a PV plant
- This card estimates carbon-credit revenue from a base environmental quantity (typically avoided emissions or qualifying generation).
- It provides:
  - Annual credit revenue estimate
  - Lifetime potential value estimate
  - Optional delta vs target and status badge

## 1) Calculation logic
Given `raw = DS[0]`:
1. Apply divider:
   - `baseVal = raw / divider`
2. Annual estimate:
   - `annualRevenue = baseVal * annualFactor`
3. Lifetime estimate:
   - `lifetimePotential = baseVal * lifetimeFactor`
4. Format values with optional K/M/B auto-scaling.
5. Progress bar fill:
   - Represents how much of the lifetime budget one annual period consumes.
   - `visualPct = clamp((annualFactor / lifetimeFactor) * 100, 3, 100)`
   - This is purely settings-driven (the raw telemetry value cancels out of the ratio).

## 2) Optional comparison and status
- Delta mode (`showDelta=true`):
  - Requires `DS[1]` target base value.
  - Computes annual target using same factors:
    - `targetAnnual = (DS1/divider) * annualFactor`
  - Delta displayed as `%` with up/down arrow.
- Status mode (`showStatus=true`):
  - Uses `annualRevenue` against thresholds:
    - `< thresholdCritical` -> Critical
    - `< thresholdWarning` -> Warning
    - else On Track

## 3) Telemetry requirements and datasource order
- Required:
  - `DS[0]`: base input quantity (numeric)
- Optional:
  - `DS[1]`: target base input quantity (numeric) for delta
- Additional datasources are ignored.
- Order matters due index-based logic.

## 4) Units (input vs output)
- Input:
  - Any numeric base quantity consistent with your `annualFactor` and `lifetimeFactor`.
- Output:
  - Main value: scaled annual revenue number, currency shown separately in unit label.
  - Bar value: scaled lifetime value plus currency text.
  - Delta: `%`

Practical modeling note:
- `annualFactor` and `lifetimeFactor` encode project-specific assumptions (credit yield, price, crediting horizon).
- Keep those factors documented with finance/compliance teams.

## 5) ThingsBoard setup checklist
1. Add widget as `Latest values`.
2. Map `DS0` to base carbon-credit driver value.
3. Optionally map `DS1` target value.
4. Configure `annualFactor`, `lifetimeFactor`, `divider`, and `currency`.
5. Configure thresholds if status badge is required.

## 6) Example telemetry
```json
{
  "ts": 1774051200000,
  "values": {
    "eligible_carbon_base": 4200,
    "eligible_carbon_target": 4000
  }
}
```

With defaults (`annualFactor=15`, `lifetimeFactor=350`):
- `annualRevenue = 4200 * 15 = 63000`
- `lifetimePotential = 4200 * 350 = 1470000`
