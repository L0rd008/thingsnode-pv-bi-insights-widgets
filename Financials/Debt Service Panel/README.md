# Debt Service Panel - Quick Read and Setup

## 0) What this means in a PV plant
- This card tracks debt-servicing health for a project/SPV.
- Core concept:
  - `DSCR` (Debt Service Coverage Ratio) shows ability to service debt from project cash flow.
  - Lenders usually require DSCR to stay above a covenant threshold.
- In operations, this is a financing-risk early warning KPI.

## 1) States
| State | Rule |
|---|---|
| `COMPLIANT` | `current_dscr >= covenant_min` |
| `BREACH` | `current_dscr < covenant_min` |

## 2) Calculations performed
1. Reads:
   - `DS[0]` -> current DSCR
   - `DS[1]` -> minimum covenant DSCR
   - `DS[2]` -> annual debt service (optional)
2. Fallbacks:
   - invalid DSCR -> `0`
   - invalid covenant -> `1.30`
   - missing debt service -> `0`
3. Compliance:
   - `isCompliant = dscr >= covenant`
4. Annual debt service formatting:
   - optional auto-scale to `K/M/B`
   - prefixed with `currency`

## 3) Telemetry requirements and datasource order
- Minimum required:
  - `DS[0]`: current DSCR numeric
  - `DS[1]`: covenant minimum numeric
- Optional:
  - `DS[2]`: annual debt service numeric
- Additional datasources are ignored.
- Order matters because code is fixed to index positions.

## 4) Units (input vs output)
- DSCR and covenant are unitless ratios.
- Annual debt service is monetary.
- Output:
  - DSCR and covenant with `dscrDecimals`
  - Debt service as `currency + value (+K/M/B if enabled)`

## 5) ThingsBoard setup checklist
1. Add widget as `Latest values`.
2. Map datasource order as DS0 DSCR, DS1 covenant, DS2 debt service.
3. Set `currency`, decimal settings, and `autoScale`.
4. Validate covenant telemetry is present and numeric to avoid fallback to 1.30.

## 6) Example telemetry
```json
{
  "ts": 1774051200000,
  "values": {
    "current_dscr": 1.42,
    "minimum_dscr_covenant": 1.30,
    "annual_debt_service_lkr": 185000000
  }
}
```

Interpretation:
- `1.42 >= 1.30` -> `COMPLIANT`
- Debt service displayed as scaled monetary amount depending on settings.
