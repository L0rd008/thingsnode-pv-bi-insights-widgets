# Curtailment vs Potential Power (V3) - Quick Read and Setup

## 0) What this means in a PV plant
- This widget visualizes the gap between:
  - Theoretical Potential generation (what the plant could produce under optimal clear-sky conditions)
  - Exported generation (what was actually exported)
- The red envelope specifically highlights the energy/power curtailed due to explicit grid export limits or dispatch constraints.

## 1) Runtime modes
| Mode | Trigger | Behavior |
|---|---|---|
| `live` | Valid actual telemetry & setpoint telemetry found for today (>5 points) | Analyzes events utilizing fallback keys and renders accurate curtailment bounds |
| `simulated` | telemetry missing/fetch fail | Generates synthetic potential/export curves with simulated dispatch events |
| `nodata` | no datasource/entity | Empty chart + NO DATA badge |

## 2) Calculations performed
Live pipeline:
1. Calls telemetry API for the configured `capacity` attribute (`Plant Total Capacity`), `Actual Power Keys`, and `Setpoint Keys`.
2. Telemetry Keys support **Comma-Separated Fallback** prioritization (e.g. `setpoint_active_power, curtailment_limit, power_limit`). The first key to return data is used.
3. Maps values into 96 buckets (15-minute intervals).
4. Treats the **Setpoint %** as an event-driven Step-Function. For time $T$, the active constraint is the latest received setpoint state with timestamp $\le T$. If no data exists before $T$ on a given day, it falls back safely to `100%` allowed.
5. Employs a smooth sinusoidal Potential Curve mapped accurately against the fetched Total Plant Capacity (converted iteratively between `MW`/`kW`).
6. Curtailment calculation rule:
   - `Allowed Power = Capacity * (Setpoint % / 100)`
   - Plant drops below allowed limits ONLY IF setpoint $\lt 100\%$ and Potential $\gt$ Allowed Power.
   - The graphic dynamically constructs a unique Curtailment Envelope dataset, preventing "clouds" from rendering incorrectly as "curtailment" when the grid hasn't issued a hold command.

Tooltip energy summary:
- Integrates curtailed power into missing energy (15-min integrals):
  - `energy = sum(power * 0.25h)`
- Automatically scales presentation to `MWh` dynamically.
- Includes a configurable Theoretical Error Margin `± X%` approximation since the calculated bounds rely on theoretical clear-sky metrics without irradiance parsing.

## 3) Telemetry requirements and datasource structure
- Required datasource:
  - `datasources[0]` must be the plant entity
- Settings Form mappings require at a minimum:
  - Capacity Attribute Key (default `Plant Total Capacity`) with specified Unit conversion.
  - Active Power (e.g. `active_power`)
  - Setpoint Percentage limit (e.g. `setpoint_active_power`)

## 4) Units (input vs output)
- `unitLabel` controls displayed power unit (default `kW`).
- The internal `capacityUnit` scales attribute variables properly (e.g., handles an incoming attribute of `1.2 MW` scaled properly to `1200 kW`).

## 5) ThingsBoard setup checklist
1. Add widget as `Latest values`.
2. Set first datasource to the entity tracking active power and limits.
3. Configure settings to match fallback telemetry keys explicitly across the portfolio.
4. Customize `Theoretical Margin %` depending on historical statistical deviation expected.

## 6) Reference Data
Event-driven setpoints sample:
```
Timestamp                  ; setpoint_active_power
2026-03-13 15:46:33        ; 40
2026-03-13 15:56:58        ; 10
2026-03-13 16:02:38        ; 100
```
*(Remains valid until the next event)*
