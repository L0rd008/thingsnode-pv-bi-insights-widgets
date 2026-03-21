# Investment Returns Panel - Quick Read and Setup

## 0) What this means in a PV plant
- This panel summarizes three investor-facing return KPIs in one view.
- Default labels are:
  - Card 1: IRR
  - Card 2: NPV
  - Card 3: ROE
- In PV portfolio reviews, this is used to quickly assess bankability and return quality.

Important:
- The widget does not compute IRR/NPV/ROE formulas from cashflow data.
- It displays latest telemetry values and applies formatting/status logic.

## 1) States
| State | Trigger |
|---|---|
| `HEALTHY` | No negative displayed values |
| `NEEDS ATTENTION` | At least one displayed value is negative |
| Placeholder | Fewer than 3 datasource series |

## 2) Calculations performed
For each card `i = 1..3`:
1. Read `raw_i = DS[i-1]`.
2. Apply divider if configured:
   - `val_i = raw_i / c{i}_divider`
3. Format with auto K/M/B scaling using `c{i}_decimals`.
4. Build display string:
   - `c{i}_prefix + formatted + c{i}_suffix`
5. Color:
   - positive value -> positive class
   - negative value -> negative class

Panel status:
- If any card value is negative -> `NEEDS ATTENTION` (critical)
- Else -> `HEALTHY` (good)

## 3) Telemetry requirements and datasource order
- Required:
  - `DS[0]` -> card 1 metric
  - `DS[1]` -> card 2 metric
  - `DS[2]` -> card 3 metric
- If fewer than 3 series are present, widget shows placeholders.
- Additional datasources beyond index 2 are ignored.

Recommended mapping in PV finance:
- `DS0`: project IRR (%)
- `DS1`: project NPV (currency)
- `DS2`: ROE (%)

## 4) Units (input vs output)
- Per-card unit handling is fully configurable:
  - `prefix`, `suffix`, `divider`, `decimals`
- Auto-scale adds K/M/B after divider conversion.
- Keep divider/prefix/suffix consistent with telemetry basis.

Examples:
- NPV raw in LKR with divider `1,000,000`, prefix `LKR `, suffix `M`
- IRR raw in percent points with suffix `%`

## 5) ThingsBoard setup checklist
1. Add widget as `Latest values`.
2. Configure datasource order to match card mapping.
3. Configure each card formatting (`c1_*`, `c2_*`, `c3_*`).
4. Verify units and divider so displayed values match finance reports.

## 6) Example telemetry
```json
{
  "ts": 1774051200000,
  "values": {
    "project_irr_pct": 12.4,
    "project_npv_lkr": 38500000,
    "project_roe_pct": 14.8
  }
}
```

Example settings alignment:
- Card 1: suffix `%`, divider `1`
- Card 2: prefix `LKR `, suffix `M`, divider `1000000`
- Card 3: suffix `%`, divider `1`
