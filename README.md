# MAGICBIT Widgets

Custom ThingsBoard widgets for solar portfolio monitoring, risk analytics, financial KPIs, and operational compliance.

## Purpose

- Keep reusable custom widget source code in one project.
- Version widget updates cleanly over time.
- Support dashboard assembly across portfolio, plant, and device views.

## Repository Structure

Each widget is stored in its own folder. Most folders use this file pattern:

- `.html`: widget template
- `.css`: styling and theme tokens
- `.js`: widget logic (ThingsBoard lifecycle + data mapping)
- `settings.json`: widget settings schema for ThingsBoard

Some folders also include:

- `resources.txt`: external script/style resource declarations
- `test_harness.html`: local widget preview harness
- exported widget JSON files

Important: many source files are intentionally named exactly `.js`, `.html`, and `.css` (leading dot).

## Widget Folders

- Action Button
- Capacity Factor Compliance
- Carbon Credit Revenue Card
- Curtailment vs Potential Power
- Debt Service Panel
- Degradation Adjusted Yield Index
- DIVERSIFICATION ANALYSIS (CORRELATION MATRIX)
- DSCR Status Card
- ESG KPI Card
- Expected vs Actual Revenue
- Finance KPI Card
- Forecast Deviation Card (FDI)
- Forecast vs Actual Energy
- Grid Outage Timeline
- Insurance Claimable Events Summary
- Investment Returns Panel
- LCOE vs TARIFF Card
- Lifetime ESG Summary Card
- Loss Attribution
- MULTI-SITE ENERGY CONTRIBUTION
- Page Header
- Payback Period Timeline
- Portfolio Compliance Summary Table
- Portfolio Intelligence Card
- Portfolio Site Status Map
- Project Navigation Bar
- Revenue-at-Risk Breakdown Widget
- Risk Summary Panel Widget
- Title Card
- Universal Energy KPI Card

## Using a Widget in ThingsBoard

1. Create a custom widget in ThingsBoard PE.
2. Paste the folder's `.html`, `.css`, and `.js` into the editor.
3. If available, paste `settings.json` into widget settings schema.
4. If available, register libraries from `resources.txt`.
5. Validate behavior using the folder's `test_harness.html` where provided.

## Tooling

- `generate_all_widgets.py`: generates a consolidated `All Widgets.txt` snapshot for selected widgets.
- `pyrightconfig.json`: static analysis config for Python tooling.

## Security and Sharing

This repo is configured to avoid committing sensitive local context and credentials. Review `.gitignore` before sharing publicly.
