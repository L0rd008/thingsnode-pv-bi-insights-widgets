# Forecast Deviation Card (FDI) — Quick Read and Setup

> **v4.0 — Updated 2026-05-13**  
> **3-instance dashboard pattern**: configure separate P50, P90, and P95 instances via `forecastDailyKey` setting.  
> **actualDailyKey** corrected to `total_generation` (real meter). **Timezone fix**: month-start computed in Asia/Colombo so day-1 data is always found.  
> **Day-1 grace state**: shows expected forecast with FDI=0% instead of blank placeholder when no actual data yet exists.

---

## 0) What this means in a PV plant

FDI (Forecast Deviation Index) measures how far actual generation is from a P-value forecast:

```
FDI (%) = (Actual − Forecast) / Forecast × 100
```

| FDI | Meaning |
|---|---|
| Positive | Plant is outperforming forecast |
| Near zero | On track |
| Negative (> −5%) | Minor deviation — monitor |
| Negative (< −10%) | Critical — investigate curtailment, soiling, fault |

---

## 1) 3-Instance Dashboard Pattern

Use **three copies** of this widget on the same dashboard, each configured for a different P-value:

| Instance | `cardTitle` | `forecastDailyKey` | `footerText` |
|---|---|---|---|
| FDI vs P50 | `FDI vs P50 (%)` | `forecast_p50_daily` | `Deviation from Median Expectation` |
| FDI vs P90 | `FDI vs P90 (%)` | `forecast_p90_daily` | `Deviation from P90 Exceedance` |
| FDI vs P95 | `FDI vs P95 (%)` | `forecast_p95_daily` | `Deviation from P95 Exceedance` |

P50 = median year. P90 = only 10% of historical years were worse. P95 = only 5% were worse.  
A plant **below P95** is in extreme underperformance — investigate immediately.

---

## 2) Runtime modes

| Mode | `fdiMode` setting | Trigger | What it computes |
|---|---|---|---|
| `mtd` | `"mtd"` (**default**) | Always runs first | Fetches `forecastDailyKey` + `actualDailyKey` from month-start to now, sums both, computes cumulative FDI% |
| `live` | `"live"` | `DS[0]` and `DS[1]` both valid | Single latest-value ratio: `DS[0]=forecast`, `DS[1]=actual` |
| `derived` | `"derived"` | `DS[0]` valid + `p50_energy` attribute exists | `DS[0]=actual`, P50 derived from annual attribute |
| `manual` | any | `enableManualOverride=true` | Uses `manualDeviation` value, ignores all data |

---

## 3) MTD mode — how it works

MTD gives an always-current month-to-date picture:

```
Month-to-date FDI% = (Σ actual_kwh[day 1 → today]  −  Σ forecast_kwh[day 1 → today])
                     / Σ forecast_kwh[day 1 → today] × 100
```

The widget fetches via REST:
- `forecastDailyKey` (MWh → converted ×1000 to kWh internally)
- `actualDailyKey` (kWh, default `total_generation` — **real meter**)

from `startTs = 1st of current month 00:00 Asia/Colombo` to `now`.

**Timezone**: month-start is computed using UTC+5:30 offset explicitly, so the pvalue_job's midnight-stamped rows are always found regardless of browser timezone.

**Day-1 grace state**: if `actRows.length === 0` (no meter data yet today), displays FDI=0% with forecast context rather than a blank placeholder.

> If `forecastDailyKey` has no data (pvalue_job not run yet), falls back to `showPlaceholder()`.

---

## 4) Telemetry keys

All P-value daily forecast telemetry is written by **`pvalue_job.py`** (pvalue-daily-v2 algorithm).

| Setting ID | Default key | Source | Unit |
|---|---|---|---|
| `forecastDailyKey` | `forecast_p50_daily` | pvalue_job.py | MWh/day |
| `actualDailyKey` | `total_generation` | Real meter | kWh/day |
| `forecastKey` *(live mode only)* | `forecast_p50_daily` | DS[0] subscription | MWh |
| `actualKey` *(live mode only)* | `total_generation` | DS[1] subscription | MWh |
| `p50AttributeKey` *(derived mode only)* | `p50_energy` | pvalue_job.py SERVER_SCOPE | kWh (annual) |

> **MTD mode does not use DS[0]/DS[1] at all.** It fetches directly via REST using the plant entity from `datasources[0]`.

---

## 5) ThingsBoard datasource setup

**MTD mode (recommended):**
1. Widget type: **Latest Values**
2. Add one datasource: the plant asset
3. The datasource key is irrelevant — it just establishes the entity ID
4. Set `fdiMode = "mtd"` in widget settings (this is the default)

**Live mode (point-in-time):**
1. Add two datasources to the same entity:
   - DS[0]: `forecast_p50_daily` (or p90/p95 key)
   - DS[1]: `total_generation` (actual meter)
2. Set `fdiMode = "live"`

---

## 6) Settings reference

| Setting | Default | Notes |
|---|---|---|
| `cardTitle` | `FDI vs P50 (%)` | Header text — change per instance |
| `fdiMode` | `"mtd"` | `"mtd"` / `"live"` / `"derived"` |
| `forecastDailyKey` | `forecast_p50_daily` | **Primary**: set to P50/P90/P95 key per instance |
| `forecastP50DailyKey` | `forecast_p50_daily` | Legacy fallback if `forecastDailyKey` not set |
| `actualDailyKey` | `actual_daily_energy_kwh` | Pre-computed daily kWh from `daily_job.py`. Override to a real meter key if available. |
| `actualPartialKey` | `active_power` | Realtime kW key for today's partial via agg=SUM (result ÷ 60 = kWh). |
| `forecastKey` | `forecast_p50_daily` | Forecast key for live mode DS[0] |
| `actualKey` | `total_generation` | Actual key for live mode DS[1] |
| `p50AttributeKey` | `p50_energy` | Annual P50 attribute for derived mode |
| `warningThreshold` | `-5` | Minor deviation threshold (%) |
| `criticalThreshold` | `-10` | Critical deviation threshold (%) |
| `unitLabel` | `MWh` | Unit shown in context values |
| `decimals` | `1` | Decimal places |
| `footerText` | `Deviation from Median Expectation` | Footer label — change per instance |
| `enableManualOverride` | `false` | Override with fixed `manualDeviation` % |
| `invertLogic` | `false` | Flip green/red (for revenue contexts) |

---

## 7) Generating the P-value daily telemetry

The `forecast_p*_daily` keys are written by `pvalue_job.py` (pvalue-daily-v2). Run once per plant:

```bash
# Smoke test — single plant
curl -X POST "http://localhost:8004/admin/run-pvalues-plant?asset_id=<ASSET_UUID>"

# Full fleet
curl -X POST "http://localhost:8004/admin/run-pvalues" --max-time 600
```

Confirm data in TB:
- Navigate to plant asset → **Latest Telemetry**
- Look for `forecast_p50_daily`, `forecast_p90_daily`, `forecast_p95_daily`
- 365 rows timestamped at midnight Asia/Colombo for each day of the current year
- Each day has a **unique** value (not flat within month — pvalue-daily-v2)

---

## 8) Example

```json
{
  "forecast_p50_daily": 61.78,
  "forecast_p90_daily": 60.28,
  "forecast_p95_daily": 57.11,
  "total_generation": 58420
}
```

MTD calculation (day 12 of month, 11 days complete):
```
P50 instance:  Σ P50 = 11 × 61.78 MWh = 679.6 MWh = 679,580 kWh
               Σ Actual = 658,200 kWh
               FDI_P50 = (658200 − 679580) / 679580 × 100 = −3.1%  →  ON TRACK

P90 instance:  Σ P90 = 11 × 60.28 = 663.1 MWh = 663,080 kWh
               FDI_P90 = (658200 − 663080) / 663080 × 100 = −0.7%  →  ABOVE P90 ✓

P95 instance:  Σ P95 = 11 × 57.11 = 628.2 MWh = 628,210 kWh
               FDI_P95 = (658200 − 628210) / 628210 × 100 = +4.8%  →  WELL ABOVE P95 ✓
```

---

## 9) v4.0 migration note

If you have an existing FDI instance configured against v2.x:

1. Set `forecastDailyKey` to `forecast_p50_daily` (or `forecast_p90_daily` / `forecast_p95_daily` per instance).
2. Set `actualDailyKey` to `actual_daily_energy_kwh` (or a real meter daily kWh key if available).
3. The legacy `forecastMtdKey` and `actualEnergyKey` settings are now ignored — they remain in `settings.json` for 90 days so existing dashboard configurations do not error on load, but they have no effect on widget behaviour.
4. No data is lost. The `forecast_p*_mtd` telemetry keys continue to exist in ThingsBoard and will be retired after the 90-day deprecation window (re-evaluate in plan v2).
