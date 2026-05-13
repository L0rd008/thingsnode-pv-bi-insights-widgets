# Forecast Deviation Card (FDI) — Quick Read and Setup

> **v3.0 — Updated 2026-05-13**  
> Added **MTD (month-to-date) mode** — the recommended default. FDI is now computed by summing actual daily energy vs cumulative daily P50 from the 1st of the current month to today.

---

## 0) What this means in a PV plant

FDI (Forecast Deviation Index) measures how far actual generation is from the P50 median forecast:

```
FDI (%) = (Actual − Forecast) / Forecast × 100
```

| FDI | Meaning |
|---|---|
| Positive | Plant is outperforming median expectation |
| Near zero | On track |
| Negative (> −5%) | Minor deviation — monitor |
| Negative (< −10%) | Critical — investigate curtailment, soiling, fault |

---

## 1) Runtime modes

| Mode | `fdiMode` setting | Trigger | What it computes |
|---|---|---|---|
| `mtd` | `"mtd"` (**default**) | Always runs first when `fdiMode=mtd` | Fetches daily `forecast_p50_daily` + `actual` from month-start to today, sums both, computes cumulative FDI% |
| `live` | `"live"` | `DS[0]` and `DS[1]` both valid | Single latest-value ratio: `DS[0]=forecast`, `DS[1]=actual` |
| `derived` | `"derived"` | `DS[0]` valid + `p50_energy` attribute exists | `DS[0]=actual`, P50 derived from annual attribute (`p50Annual / 365 / 1000`) |
| `manual` | any | `enableManualOverride=true` | Uses `manualDeviation` value, ignores all data |

---

## 2) MTD mode — how it works

MTD is the recommended mode for an always-current month-to-date picture:

```
Month-to-date FDI% = (Σ actual_kwh[day 1 → today]  −  Σ p50_kwh[day 1 → today])
                     / Σ p50_kwh[day 1 → today] × 100
```

The widget fetches via REST:
- `forecast_p50_daily` (MWh → converted ×1000 to kWh internally)
- `actualDailyKey` (kWh, default `total_generation_expected_kwh`)

from `startTs = 1st of current month 00:00 local` to `now`.

> If `forecast_p50_daily` has no data yet (pvalue_job not run), falls back to `showPlaceholder()`.

---

## 3) Telemetry keys

All P50 daily forecast telemetry is written by **`pvalue_job.py`** in Pvlib-Service.

| Setting ID | Default key | Source | Unit |
|---|---|---|---|
| `forecastP50DailyKey` | `forecast_p50_daily` | pvalue_job.py | MWh/day |
| `actualDailyKey` | `total_generation_expected_kwh` | Pvlib-Service daily rollup | kWh/day |
| `forecastKey` *(live mode only)* | `forecast_p50_daily` | DS[0] subscription | MWh |
| `actualKey` *(live mode only)* | `total_generation` | DS[1] subscription | MWh |
| `p50AttributeKey` *(derived mode only)* | `p50_energy` | pvalue_job.py SERVER_SCOPE | kWh (annual) |

> **MTD mode does not use DS[0]/DS[1] at all.** It fetches directly via REST using the plant entity from `datasources[0]`.

---

## 4) ThingsBoard datasource setup

**MTD mode (recommended):**
1. Widget type: **Latest Values**
2. Add one datasource: the plant asset
3. The datasource key is irrelevant — just establishes entity ID
4. Set `fdiMode = "mtd"` in widget settings (this is the default)

**Live mode (point-in-time):**
1. Add two datasources to the same entity:
   - DS[0]: `forecast_p50_daily`
   - DS[1]: `total_generation` (actual)
2. Set `fdiMode = "live"`

---

## 5) Settings reference

| Setting | Default | Notes |
|---|---|---|
| `cardTitle` | `FDI vs P50 (%)` | Header text |
| `fdiMode` | `"mtd"` | `"mtd"` / `"live"` / `"derived"` |
| `forecastP50DailyKey` | `forecast_p50_daily` | Daily P50 key for MTD sum (MWh) |
| `actualDailyKey` | `total_generation_expected_kwh` | Daily actual key for MTD sum (kWh) |
| `forecastKey` | `forecast_p50_daily` | Forecast key for live mode DS[0] |
| `actualKey` | `total_generation` | Actual key for live mode DS[1] |
| `p50AttributeKey` | `p50_energy` | Annual P50 attribute for derived mode |
| `warningThreshold` | `-5` | Minor deviation threshold (%) |
| `criticalThreshold` | `-10` | Critical deviation threshold (%) |
| `unitLabel` | `MWh` | Unit shown in context values |
| `decimals` | `1` | Decimal places |
| `footerText` | `Deviation from Median Expectation` | Footer label |
| `enableManualOverride` | `false` | Override with fixed `manualDeviation` % |
| `invertLogic` | `false` | Flip green/red (for revenue, where positive deviation is bad) |

---

## 6) Generating the P50 daily telemetry

The `forecast_p50_daily` key must exist in TB before MTD mode shows live data.

```bash
# Run pvalue_job for a single plant (smoke test)
curl -X POST "http://localhost:8004/admin/run-pvalues-plant?asset_id=<ASSET_UUID>"

# Full fleet
curl -X POST "http://localhost:8004/admin/run-pvalues" --max-time 600
```

Confirm data exists in TB:
- Navigate to the plant asset → **Latest Telemetry**
- Look for `forecast_p50_daily` with 365 rows timestamped at midnight for each day of the current year

---

## 7) Example telemetry

```json
{
  "forecast_p50_daily": 61.78,
  "total_generation_expected_kwh": 58420
}
```

MTD calculation (e.g. day 12 of month, 11 days complete):
```
Σ P50 = 11 × 61.78 MWh = 679.6 MWh = 679,580 kWh
Σ Actual = 658,200 kWh
FDI_MTD = (658200 − 679580) / 679580 × 100 = −3.1%  →  ON TRACK (within −5% threshold)
```
