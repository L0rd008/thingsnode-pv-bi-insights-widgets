# Portfolio Site Status Map

## Overview

Displays power-plant locations on a Leaflet map inside a ThingsBoard dashboard widget.

The widget is driven by dashboard state:
- `SelectedAsset` is the clicked entity
- `SelectedBranchRoot` is the resolved branch container for shared hierarchies

The widget does not hardcode asset names, IDs, or hierarchy depths. It resolves branch scope dynamically through ThingsBoard relations and entity role attributes.

---

## Core principle: attribute-based role detection

Hierarchy roles are determined in this order:

1. Read `isPlant` / `isPlantAgg` from `SERVER_SCOPE`
2. If either flag is missing, fall back to `SHARED_SCOPE`
3. If both flags are still absent, fall back to `targetAssetProfiles` matching

Authoritative role flags:

| Attribute | Meaning |
|---|---|
| `isPlantAgg = true` | Aggregation / branch container |
| `isPlant = true` | Renderable plant |

Precedence rules:

| Condition | Result |
|---|---|
| `isPlantAgg=true` and `isPlant=true` | Treated as aggregation, warning logged |
| `isPlantAgg=true` | Aggregation |
| `isPlant=true` | Plant |
| Neither flag present | Legacy profile fallback |
| Flags present but both false | Non-plant container / other |

This is what keeps assets such as `Windforce Overview`, `Akbar Brothers`, `Mona Plastic`, and `Hirdaramani` from being misclassified as plants just because they use the `SolarPlant` profile.

---

## Rendering rules by selection

| What is selected | What gets mapped |
|---|---|
| Aggregation container (`isPlantAgg=true`) | All descendant plants under that aggregation |
| Plant (`isPlant=true`) | Plants under its nearest aggregation ancestor |
| Descendant below a plant | Find the nearest plant ancestor, then map plants under that plant's nearest aggregation ancestor |
| Other container without aggregation flag | Its descendant plants when present; otherwise upward fallback via nearest plant ancestor |

Nested aggregations are always traversal containers, not markers.

---

## Resolution algorithm

```text
1. Read SelectedAsset from the datasource.
2. Optionally read SelectedBranchRoot from dashboard state.
3. Resolve the selected entity as ASSET/DEVICE and attach role info.
4. If SelectedBranchRoot exists:
   - resolve it
   - if it has descendant plants, use it as the render root
   - otherwise continue with normal selected-entity resolution
5. If the selected entity is a plant:
   - search upward for the nearest ancestor with isPlantAgg=true
   - if exactly one aggregation ancestor is found, use it
   - otherwise render only the selected plant
6. If the selected entity is not a plant:
   - search downward for descendant plants
   - if found, render them under the selected node
   - otherwise search upward for the nearest plant ancestor
   - then search upward again for that plant's nearest aggregation ancestor
7. Walk downward through Contains relations from the chosen branch root.
8. Treat isPlantAgg nodes as containers, isPlant nodes as plants, and everything
   else as traversal-only nodes.
9. Fetch telemetry / attributes for the resolved plants and render markers.
```

---

## ThingsBoard setup

### Datasource

Configure one datasource:

| Setting | Value |
|---|---|
| Alias type | Entity from Dashboard State |
| State entity parameter | `SelectedAsset` |
| Data keys | Any one key such as `name` |

The widget only needs the selected entity ID from datasource metadata. All traversal and telemetry lookup happen through REST API calls.

### Dashboard state

Expected state parameters:

```js
SelectedAsset
```

Standard ThingsBoard selected entity parameter.

```js
SelectedBranchRoot = {
  id: string,
  entityType: 'ASSET' | 'DEVICE',
  name?: string
}
```

Used to disambiguate shared branches.

Recommended `SelectedBranchRoot` rules:

| User click | `SelectedAsset` | `SelectedBranchRoot` |
|---|---|---|
| Aggregation container | Clicked node | Same clicked node |
| Plant | Clicked plant | Nearest ancestor with `isPlantAgg=true` |
| Descendant below plant | Clicked descendant | Nearest ancestor with `isPlantAgg=true` above the deepest plant in that path |

In this repo, `test_v2_hierarchy` now follows those rules automatically.

---

## Required hierarchy relations

All hierarchy edges must use outbound `Contains` relations:

```text
Parent --Contains--> Child
```

The widget traverses both directions:
- `/api/relations` for children
- `/api/relations/info` for parents

Supported relation targets:
- `ASSET`
- `DEVICE`

Other ThingsBoard entity types are ignored unless the widget is extended.

---

## Role attribute scopes

Role flags may live in either:
- `SERVER_SCOPE`
- `SHARED_SCOPE`

The widget checks `SERVER_SCOPE` first, then fills missing flags from `SHARED_SCOPE`.

Accepted truthy / falsy values include:
- `true`, `false`
- `1`, `0`
- `yes`, `no`
- `on`, `off`

---

## Required plant data

Plant markers are built from latest telemetry first, then `SERVER_SCOPE` attributes, then `SHARED_SCOPE` attributes. The key names below are exact and case-sensitive.

| Data | Accepted keys |
|---|---|
| Latitude | `latitude` |
| Longitude | `longitude` |
| Capacity | `Capacity` |
| Display name | `name` |
| Status | `status` |
| Risk-at-Risk (LKR) | `rar_lkr` |
| Capacity factor status | `cf_status` |

`Capacity` is interpreted as kW. Plants with valid `latitude` and `longitude` still render even when `Capacity` is missing; they use the smallest marker and show `Capacity: N/A`.

---

## Widget settings

| Setting ID | Default | Description |
|---|---|---|
| `widgetTitle` | `Portfolio Site Locations` | Title shown in the header |
| `capacityUnit` | `MW` | Deprecated. Source `Capacity` is always interpreted as kW and this setting is ignored at runtime |
| `targetAssetProfiles` | `SolarPlant` | Legacy fallback profile list used only when `isPlant` and `isPlantAgg` are both absent |
| `strictDuckTyping` | `false` | Deprecated. The widget no longer drops plants just because `Capacity` is missing |
| `debugMode` | `false` | Enables detailed branch-resolution and role logs |

---

## Example behavior

Example hierarchy:

```text
Windforce Plants              (isPlantAgg=true)
|-- SCADA Power Plants        (isPlantAgg=true)
|   |-- KSP_Plant             (isPlant=true)
|   `-- ...
`-- Windforce Overview        (isPlantAgg=true)
    |-- Akbar Brothers        (isPlantAgg=true)
    |   `-- Aerosense         (isPlant=true)
    |-- Mona Plastic          (isPlantAgg=true)
    `-- Hirdaramani           (isPlantAgg=true)
```

Expected outcomes:

| Selected entity | Rendered scope |
|---|---|
| `SCADA Power Plants` | Its descendant plants only |
| `KSP_Plant` | `SCADA Power Plants` branch |
| `Windforce Overview` | Its descendant plants only |
| `Akbar Brothers` | Its descendant plants only |
| `Aerosense` | `Akbar Brothers` branch |
| Block / inverter / weather station below a plant | The nearest aggregation branch above that plant |

---

## Runtime API calls

On each selection refresh the widget may call:

1. `GET /api/asset/{id}` or `GET /api/device/{id}` to resolve the selected entity
2. `GET /api/asset/{id}` or `GET /api/device/{id}` to resolve `SelectedBranchRoot`
3. `GET /api/plugins/telemetry/{ENTITY_TYPE}/{id}/values/attributes/SERVER_SCOPE?keys=isPlant,isPlantAgg`
4. `GET /api/plugins/telemetry/{ENTITY_TYPE}/{id}/values/attributes/SHARED_SCOPE?keys=isPlant,isPlantAgg`
5. `GET /api/relations?fromId=...&fromType=...&relationType=Contains` for descendant traversal
6. `GET /api/relations/info?toId=...&toType=...&relationType=Contains` for upward fallback traversal
7. `GET /api/plugins/telemetry/{ENTITY_TYPE}/{id}/values/timeseries?keys=...` for plant telemetry
8. `GET /api/plugins/telemetry/{ENTITY_TYPE}/{id}/values/attributes/SERVER_SCOPE?keys=...` for telemetry attribute fallback

---

## Debug logging

With `debugMode=true`, console logs include:
- resolved role info per selected / traversed entity
- explicit notice when profile fallback was used
- branch-root validation results
- exact branch root chosen for rendering
- descendant plant counts
- empty / ambiguous fallback reasons
- `render_markers_error` when marker rendering throws (non-fatal, markers are preserved)

Log prefix:

```text
[PortfolioMap][render-*]
```

---

## Error handling

### Telemetry fetch vs rendering errors

The widget separates telemetry fetch failures from rendering errors. If the telemetry fetch succeeds but `renderMarkers` throws (for example due to Angular change detection), the already-rendered markers are preserved and a `render_markers_error` warning is logged. Only a genuine telemetry fetch failure triggers an empty state.

### Angular detectChanges

Calls to `self.ctx.detectChanges()` are wrapped in try-catch. If Angular change detection fails, a non-fatal warning is logged but the rendered map state is not cleared.

### Tree-walk pruning at plant level

The tree walker stops descending as soon as it encounters a `isPlant=true` entity. Because plants never contain other plants in the hierarchy (only aggregation nodes contain plants), continuing below a plant would traverse blocks, inverters, weather stations, and other sub-plant devices — each requiring 2–3 API calls for entity resolution and role detection — without finding any additional plants.

This pruning reduces the total number of API calls from several hundred to roughly the count of plants plus aggregation containers, which typically completes in under two seconds for the full portfolio.

### Parallel role-flag resolution

Role flags (`isPlant`, `isPlantAgg`) are resolved by fetching `SERVER_SCOPE` and `SHARED_SCOPE` attributes in parallel. `SERVER_SCOPE` values take precedence when both scopes contain a flag.

### Render timing

When `debugMode=true`, the `render_summary` log includes a `timing` object with:

| Field | Description |
|---|---|
| `treeResolutionMs` | Time from render start to beginning of telemetry fetch (tree walk + entity resolution) |
| `telemetryFetchMs` | Time spent fetching telemetry / attributes for all resolved plants |
| `totalMs` | End-to-end time from render start to marker rendering |

---

## Notes

- No hierarchy names or entity IDs are hardcoded in the widget logic.
- The widget supports mixed `ASSET` / `DEVICE` hierarchies.
- `SelectedBranchRoot` is strongly recommended whenever the same plant can appear under more than one aggregation branch.
- If an entity has valid `latitude` and `longitude`, it renders even when `Capacity` is missing.
- Plants without `latitude` and `longitude` are silently dropped during rendering and counted as `droppedMissingLocation` in the render summary log.
