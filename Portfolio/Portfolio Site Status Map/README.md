# Portfolio Site Status Map - Quick Read and Setup

## 0) What this means in a PV portfolio
- Geospatial health view of all sites with marker size dynamically tracking plant scale and color tracking health status.
- Designed with an ultra-legible, high-contrast dark blue map theme with white lettering for maximum visibility.
- Highly useful for operations centers to spot geographical risk patterns instantly.

## 1) Calculations and rendering logic
For each site mapped from the dashboard:
1. Coordinates are extracted via `latitude`/`lat` and `longitude`/`lon`.
2. Marker size dynamically compares plant scale based on `Plant Total Capacity`:
   - Normalized into MW internally (based on UI Setting unit W/kW/MW)
   - `>=50` MW -> large dot
   - `>=10` MW -> medium dot
   - else -> small dot
3. Marker color is determined by the `status` telemetry:
   - `healthy` -> green
   - `warning` -> amber
   - `fault` -> red
4. Tooltip dynamically parses:
   - Site name (via `plant_name` attribute, defaults to Entity Name)
   - Capacity + Base Unit suffix
   - Operational Status
   - Extra metrics: `rar_lkr` shown as million LKR, and `cf_status` dynamically colored.
5. Floating dynamic stats bar tracks overall counts per status category.

## 2) Entity Mapping and Telemetry Requirements
The widget connects directly to individual Assets rather than expecting a pre-compiled JSON payload. This is done by adding a Data Source tied to an **Entity Alias** (e.g. "Entity Group" or "Assets by type") so the map fetches data for all underlying plants simultaneously.

**Required Mapping Keys (Attributes):**
- `latitude` or `lat` (number)
- `longitude` or `lon` (number)
- `Plant Total Capacity` or `capacity` (number)

**Optional Telemetry / Attributes:**
- `plant_name` or `name` (string - custom label)
- `status` (`healthy`/`warning`/`fault`)
- `rar_lkr` (number - Revenue at risk)
- `cf_status` (string - capacity factor status)

*Note: You can map either the exact database Key Name or edit its UI visual Label to match, the widget will detect both.*

## 3) Units (Input vs Output)
- Capacity units are now **fully configurable** in the widget's "Settings" tab (e.g., `W`, `kW`, `MW`). The map dynamically converts the raw attribute to `MW` internally solely for dot scaling, but will display your chosen raw unit dynamically in the Tooltips and Legends.
- Revenue-at-Risk `rar` is hardcoded to be processed into `M LKR` (assumes raw feed is in LKR).

## 4) ThingsBoard setup checklist
1. Map an Entity Alias that captures multiple assets (Avoid single-asset alias).
2. Add the widget to the dashboard as `Latest values`.
3. In Data Sources, select your multi-asset Alias.
4. Add all matching Data Keys (`lat`, `lon`, `Plant Total Capacity`, `status`, etc.).
5. Under the *Settings* tab, set your `Capacity Unit (W, kW, MW)`.
6. Ensure your assets have coordinates populated and `status` values standardized.
