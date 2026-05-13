# Forecast vs Actual Energy (V1) — Quick Read and Setup

> **v2.0 — Updated 2026-05-13**  
> P75 has been replaced by **P95** throughout. Window extended to **12 months (365 days)**. Forecast telemetry is now generated automatically by `pvalue_job.py` in Pvlib-Service.

---

## 0) What this means in a PV plant

This widget compares plant **actual daily energy** against three probabilistic forecast bands derived from 19 years of ERA5 physics simulation (2005–2023).

| Band | Meaning | Risk interpretation |
|---|---|---|
| `P50` | Median — 50% of historical years exceeded this | Benchmark / expected case |
| `P90` | Only 10% of historical years fell *below* this | Conservative / warning threshold |
| `P95` | Only 5% of historical years fell *below* this | Worst-case / critical threshold |

Risk state (bottom-right badge):
- `actual ≥ P50` → **ON TRACK** (green)
- `P90 ≤ actual < P50` → **WARNING** (amber)
- `actual < P90` → **CRITICAL** (red, pulsing)

---

## 1) Runtime modes

| Mode | Trigger | What happens |
|---|---|---|
| `live` | `forecast_p50_daily` + actual telemetry both present (> 2 points) | Real P50/P90/P95 lines from pvalue_job telemetry |
| `derived` | Actual exists but daily forecast telemetry missing; annual attributes exist | Flat daily lines derived from `p50_energy`, `p90_energy`, `p95_energy` attributes |
| `simulated` | No telemetry and no attributes | Seasonal simulation so the chart renders visibly |
| `nodata` | No datasource entity | Empty state |

---

## 2) Telemetry keys (primary — live mode)

All written by **`pvalue_job.py`** (Pvlib-Service). Unit: **MWh/day**. Timestamp: local midnight of each calendar day.

| Setting ID | Default key | Written by | Cadence |
|---|---|---|---|
| `forecastP50Key` | `forecast_p50_daily` | pvalue_job.py | Annual batch (365 rows/year) |
| `forecastP90Key` | `forecast_p90_daily` | pvalue_job.py | Annual batch (365 rows/year) |
| `forecastP95Key` | `forecast_p95_daily` | pvalue_job.py | Annual batch (365 rows/year) |
| `actualEnergyKey` | `total_generation` | Plant meter / SCADA | Daily |
| `pvlibExpectedKey` | `total_generation_expected_kwh` | Pvlib-Service daily rollup | Daily (kWh — auto-converted to MWh for display) |

> **Unit note:** `forecast_p*_daily` keys are in **MWh** and are used directly.  
> `total_generation_expected_kwh` is in **kWh** and is divided by 1000 for display.

---

## 3) Attribute keys (derived mode fallback)

If daily forecast telemetry is not yet in TB, the widget falls back to annual `SERVER_SCOPE` attributes to generate a flat daily baseline.

| Setting ID | Default attribute | Unit | Written by |
|---|---|---|---|
| `p50AttributeKey` | `p50_energy` | kWh (annual) | pvalue_job.py |
| `p90AttributeKey` | `p90_energy` | kWh (annual) | pvalue_job.py |
| `p95AttributeKey` | `p95_energy` | kWh (annual) | pvalue_job.py |

Fallback ratios used when attributes are missing:
- `P90 = P50 × 0.976`
- `P95 = P50 × 0.924`

Daily derived formula: `daily_MWh = annual_kWh / 365 / 1000`

---

## 4) ThingsBoard datasource setup

This widget uses **only datasources[0]** for entity identification. It fetches all telemetry via direct REST, not from the TB datasource subscription.

**Minimum setup:**
1. Widget type: **Latest Values**
2. Add exactly **one datasource** — the plant asset (type `ASSET`)
3. The datasource key does not matter (the widget ignores subscription data entirely in live mode)

**Recommended TB datasource config:**

```
Datasource 0:  Plant Asset  →  key: total_generation   (just to establish the entity)
```

---

## 5) Settings reference

| Setting | Default | Notes |
|---|---|---|
| `widgetTitle` | `FORECAST vs. ACTUAL ENERGY (12-MONTH MWh)` | Header text |
| `windowDays` | `365` | Rolling window. 365 = full year view |
| `actualEnergyKey` | `total_generation` | Daily actual energy key (MWh) |
| `forecastP50Key` | `forecast_p50_daily` | P50 daily forecast key (MWh) |
| `forecastP90Key` | `forecast_p90_daily` | P90 daily forecast key (MWh) |
| `forecastP95Key` | `forecast_p95_daily` | P95 daily forecast key (MWh) |
| `p50AttributeKey` | `p50_energy` | Annual P50 attribute (kWh) for derived fallback |
| `p90AttributeKey` | `p90_energy` | Annual P90 attribute (kWh) for derived fallback |
| `p95AttributeKey` | `p95_energy` | Annual P95 attribute (kWh) for derived fallback |
| `pvlibExpectedKey` | `total_generation_expected_kwh` | Daily physics expected (kWh, green dotted line). Leave blank to hide |
| `baseDailyEnergy` | `4110` | Fallback kWh/day for simulation mode |
| `showConfidenceBand` | `true` | Shade between P50 and P95 |
| `decimals` | `1` | Decimal places in tooltip/axis |
| `unitLabel` | `MWh` | Display unit label |

---

## 6) Generating the forecast telemetry

Run the one-shot backfill on Pvlib-Service to populate all plants:

```bash
# Single plant smoke test
curl -X POST "http://localhost:8004/admin/run-pvalues-plant?asset_id=<ASSET_UUID>"

# Full fleet backfill
curl -X POST "http://localhost:8004/admin/run-pvalues" --max-time 600
```

The annual cron runs automatically on **Jan 1 at 03:00 Asia/Colombo** when `PVALUE_JOB_ENABLED=true` in `.env`.

---

## 7) Example telemetry payload

Daily timeseries written to TB (one row per day, unit: MWh):

```json
{
  "forecast_p50_daily": 61.78,
  "forecast_p90_daily": 60.30,
  "forecast_p95_daily": 57.13
}
```

Annual SERVER_SCOPE attributes:

```json
{
  "p50_energy": 22552363.8,
  "p90_energy": 22009095.4,
  "p95_energy": 20852304.9,
  "pvalue_model_version": "pvalue-monthly-v1",
  "pvalue_updated_at": "2026-05-12T10:43:39Z"
}
```
