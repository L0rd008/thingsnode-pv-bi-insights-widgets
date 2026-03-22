# ThingsNode SCADA BI Insights Widgets

Custom ThingsBoard widgets for PV plant BI dashboards (asset owner and investor use cases).

## Project Layout

The repo is grouped by dashboard domain:

- `Energy & Yield`
- `Forecasts & Risk`
- `Financials`
- `ESG & Carbon`
- `Grid & Losses`
- `Portfolio`
- `Utility`

Most widget folders use this file pattern:

- `.html`: widget template
- `.css`: styling
- `.js`: widget logic (TB lifecycle + telemetry mapping + calculations)
- `settings.json` (optional): widget settings schema
- `resources.txt` (optional): external libraries
- `README.md` (when documented): quick setup + telemetry contract + domain context

Note: many source files are intentionally named `.js`, `.html`, `.css` (leading dot).

## Widget Setup Guides (README Index)

These are the current handover docs for new developers.

### Energy & Yield

- `Energy & Yield/Degradation Adjusted Yield Index/README.md`
- `Energy & Yield/Universal Energy KPI Card/Best/README.md`

### Forecasts & Risk

- `Forecasts & Risk/Forecast vs Actual Energy/V1 TB Latest Values Widget/README.md`
- `Forecasts & Risk/Forecast Deviation Card (FDI)/README.md`
- `Forecasts & Risk/Expected vs Actual Revenue/README.md`
- `Forecasts & Risk/Risk Summary Panel Widget/README.md`
- `Forecasts & Risk/Revenue-at-Risk Breakdown Widget/README.md`

### Financials

- `Financials/Finance KPI Card/README.md`
- `Financials/LCOE vs TARIFF Card/README.md`
- `Financials/Debt Service Panel/README.md`
- `Financials/Payback Period Timeline/README.md`
- `Financials/Investment Returns Panel/README.md`
- `Financials/DSCR Status Card/README.md`

### ESG & Carbon

- `ESG & Carbon/ESG KPI Card/README.md`
- `ESG & Carbon/Carbon Credit Revenue Card/README.md`
- `ESG & Carbon/Lifetime ESG Summary Card/README.md`

### Grid & Losses

- `Grid & Losses/Loss Attribution/README.md`
- `Grid & Losses/Capacity Factor Compliance/README.md`
- `Grid & Losses/Curtailment vs Potential Power/V3 TB Latest Values Widget/README.md`
- `Grid & Losses/Curtailment vs Potential Power/V2 TB Time Series Widget/README.md`
- `Grid & Losses/Curtailment vs Potential Power/V1 TB Latest Values Widget/README.md`
- `Grid & Losses/Insurance Claimable Events Summary/README.md`
- `Grid & Losses/Grid Outage Timeline/README.md`

### Portfolio

- `Portfolio/Portfolio Intelligence Card/README.md`
- `Portfolio/Portfolio Site Status Map/README.md`
- `Portfolio/MULTI-SITE ENERGY CONTRIBUTION/README.md`
- `Portfolio/DIVERSIFICATION ANALYSIS (CORRELATION MATRIX)/README.md`
- `Portfolio/Portfolio Compliance Summary Table/README.md`

## Standard TB Import Flow

1. Open the target widget folder (or version subfolder).
2. Create a ThingsBoard custom widget with the correct widget type.
3. Paste `.html`, `.css`, `.js` into TB widget editor.
4. Add `settings.json` and `resources.txt` if present.
5. Configure datasources and telemetry keys exactly as documented in that widget's `README.md`.
6. Validate with the example telemetry from the same `README.md`.

## Contributor Rules

- If widget calculations or telemetry keys change, update that widget's `README.md` in the same commit.
- Preserve datasource ordering assumptions documented per widget.
- Keep units explicit (`kW`, `kWh`, `%`, `LKR`, etc.) in code and docs.

## Tooling

- `generate_all_widgets.py`: builds consolidated widget exports into `All Widgets.txt`.
- `pyrightconfig.json`: Python static analysis config.
