# Data sources, licences and attribution

| Provider | Product used | Licence / terms | What S.A.T.U.R.N. does with it |
|---|---|---|---|
| **NASA GIBS** (Global Imagery Browse Services) | WMTS layers such as `MODIS_Terra_CorrectedReflectance_TrueColor`, `VIIRS_SNPP_CorrectedReflectance_TrueColor` | NASA EOSDIS data are freely available; imagery courtesy NASA GIBS (acknowledgement required) | Parses GetCapabilities, validates dates, builds tile URLs, renders tiles on the globe |
| **OpenStreetMap Nominatim** | Geocoding / reverse geocoding / polygons | OSM data © OpenStreetMap contributors, **ODbL 1.0**; Nominatim usage policy | Location resolution with a descriptive User-Agent, ≤1 request/s, 24 h cache, attribution shown |
| **NASA EONET** | Natural event tracker v3 | NASA open data | Normalised event schema, source links kept |
| **NASA FIRMS** | Area CSV API (VIIRS/MODIS NRT) | Requires a personal `MAP_KEY`; NASA FIRMS terms | Thermal-anomaly detections for the visible bbox only; labelled as anomalies, never as confirmed wildfires |
| Base texture | generated procedurally in the browser | — | Labelled "BASE TEXTURE — NOT SATELLITE OBSERVATION" |
| Vertex AI | Google Gen AI SDK (function calling) | Google Cloud terms (ADC credentials) | Planning + tool calls only; no imagery sent |

## Required acknowledgements (shown in the UI)

> Imagery courtesy NASA Global Imagery Browse Services (GIBS) / NASA EOSDIS. We acknowledge the use
> of imagery provided by services from NASA's GIBS.

> © OpenStreetMap contributors — data licensed under the Open Database License (ODbL).

## Freshness semantics

| Badge | Meaning |
|---|---|
| `RECENT OBSERVATION` | daily composite ≤ 3 days old, or a live geocoding/event lookup |
| `HISTORICAL` | composite older than 3 days |
| `FORECAST` | reserved for a future forecast connector (none configured) |
| `STALE` | provider responded but the record exceeds its expected refresh window |
| `UNAVAILABLE` | provider not configured (e.g. FIRMS without a key) or failed |

## Things S.A.T.U.R.N. deliberately does NOT claim

* Images are **daily composites**, not single satellite passes and never "live".
* Cloud cover can hide the surface on true-colour days.
* GIBS has roughly one day of ingest lag; a date that is too recent is rejected with an explicit
  message naming the latest available composite.
* Swipe/split comparisons show two real dates; **no change measurement** is performed.
* The dotted world map, network lines, rings and sweep animation are **decorative**.
