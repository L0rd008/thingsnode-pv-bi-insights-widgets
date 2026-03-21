# LCOE vs TARIFF Card - Quick Read and Setup

## 0) What this means in a PV plant
- This card compares generation cost (`LCOE`) against selling price (`PPA Tariff`).
- In PV project finance this is a direct unit-economics signal:
  - `Tariff > LCOE` means positive gross margin per kWh
  - `Tariff < LCOE` means loss per kWh

## 1) States (mode-like outcomes)
| State | Condition | Meaning |
|---|---|---|
| `PROFITABLE` | `margin > 0` and `marginPct > warningThreshold` | Healthy margin buffer |
| `MARGINAL` | `margin > 0` and `marginPct <= warningThreshold` | Positive but thin margin |
| `BREAK-EVEN` | `margin == 0` | No unit margin |
| `LOSS` | `margin < 0` | Cost exceeds selling price |

Where:
- `margin = tariff - lcoe`
- `marginPct = (margin / tariff) * 100` (0 if tariff is 0)

## 2) Calculations performed
1. Reads:
   - `lcoe = DS[0]`
   - `tariff = DS[1]`
2. Computes:
   - `margin = tariff - lcoe`
   - `marginPct = (margin / tariff) * 100` (safe zero handling)
   - `ratio = lcoe / tariff` (safe zero handling)
3. Updates:
   - Status badge from rules above
   - Delta arrow and absolute margin text
   - Bar widths based on relative magnitude
   - Ratio mini-bar and `ratio : 1` text

## 3) Telemetry requirements and datasource order
- Required:
  - `DS[0]`: LCOE numeric
  - `DS[1]`: Tariff numeric
- Additional datasources are ignored.
- Order is mandatory because code is index-based.

## 4) Units (input vs output)
- Input units must match:
  - Example: both in `LKR / kWh`
- Output format:
  - `currency + value + unit`
  - Example default: `LKR 28.50 / kWh`
- Decimals controlled by `decimals`.

## 5) ThingsBoard setup checklist
1. Add widget as `Latest values`.
2. Set datasource order: `DS0=LCOE`, `DS1=Tariff`.
3. Configure `currency`, `unit`, and `warningThreshold`.
4. Optional: set custom sub-labels and tooltip text.

## 6) Example telemetry
```json
{
  "ts": 1774051200000,
  "values": {
    "lcoe_lkr_per_kwh": 24.30,
    "ppa_tariff_lkr_per_kwh": 32.50
  }
}
```

From this example:
- `margin = 32.50 - 24.30 = 8.20 LKR/kWh`
- `marginPct = 25.2%`
- Status is typically `PROFITABLE` (default warning threshold is 10%).
