# DSCR Status Card - Quick Read and Setup

## 0) What this means in a PV project
- DSCR (Debt Service Coverage Ratio) indicates whether project cash flow can service debt obligations.
- In PV project finance, lenders typically enforce a minimum DSCR covenant.
- This card is a compliance indicator:
  - `DSCR >= covenant` -> compliant
  - `DSCR < covenant` -> breach risk

## 1) Modes / branches
| Mode | Trigger | Behavior |
|---|---|---|
| Manual override | `enableManualOverride=true` | Uses `manualDSCR` and `manualLimit`, ignores telemetry |
| Live mode | `enableManualOverride=false` and valid `DS[0]`,`DS[1]` | Uses telemetry values |
| Placeholder | Missing/invalid required data in live mode | Shows `--` state |

## 2) Calculations performed
1. Inputs:
   - `val` = DSCR value
   - `limit` = covenant minimum
2. Compliance rule:
   - `isCompliant = (val >= limit)`
3. Status text:
   - compliant -> `passText` (default `COMPLIANT`)
   - breach -> `failText` (default `BREACH`)
4. Footer:
   - `covLabel` + `limit` formatted with `decimals` and `x` suffix
5. Dynamic tooltip (if no override):
   - `DSCR`, `Limit`, status, and signed difference `(val-limit)`

## 3) Telemetry requirements and datasource order
- Required in live mode:
  - `DS[0]`: DSCR numeric value
  - `DS[1]`: covenant limit numeric value
- Additional datasources are ignored.
- Order is mandatory because code uses fixed index positions.

## 4) Units (input vs output)
- DSCR is unitless ratio.
- Output formatting:
  - Main value: `val.toFixed(decimals)`
  - Unit label: `x`
  - Covenant footer: `limit.toFixed(decimals) + 'x'`

## 5) ThingsBoard setup checklist
1. Add widget as `Latest values`.
2. Map first datasource key to DSCR value.
3. Map second datasource key to covenant threshold.
4. Set `decimals`, `passText`, `failText`, and labels.
5. Use manual override only for demo/testing.

## 6) Example telemetry
```json
{
  "ts": 1774310400000,
  "values": {
    "current_dscr": 1.34,
    "min_covenant_dscr": 1.20
  }
}
```

Interpretation:
- `1.34 >= 1.20` -> `COMPLIANT`.
