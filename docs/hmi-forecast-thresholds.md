# HMI forecast and species thresholds (#161)

## Observation rules

The Thresholds shelf reads the same generated `RULES` / `RULES_VERSION` as the application, from canonical `pipeline/data/ref/species.json`. The values are unchanged: scallop tier 1 is daily SST >=25°C on 14 days, tier 2 is >=26°C on 12 days; sea pineapple (`hoya`) is >=24°C on 30 days. The inclusive counting window is July 1–September 30. These are provisional relief rules, not biological lethal limits or safe operating recommendations. Scallop's separate BANWEEKS rule requires four consecutive official restriction weeks, not weather or chlorophyll imagery.

An unavailable species-profile service no longer hides configured rules. A different live rule version/value disables progress until reconciled. Only validated observed SST for the selected plot, geometry and season is counted. Missing, duplicate, unordered, future or mismatched readings are not zero exposure. The shelf reports observed/elapsed days, missingness and the last actual observation. Weather forecasts never enter these counters or the attestation/payment flow.

## Current forecast

`GET /api/weather/forecast?latitude=38.88419&longitude=141.636787` serves 72 hourly forecast points for the selected plot in Japan. Forecast time is current, regardless of the selected historical HMI season. Forecast fetching starts when the shelf opens, not when the map loads. Changing plots replaces and cancels the old request. Refresh retries; explicitly stale data retains its original retrieval timestamp.

The server uses Open-Meteo's JMA weather endpoint and marine best-match endpoint. Weather includes air temperature, precipitation, wind speed/direction and weather code; marine includes sea-surface temperature, significant wave height and period. Daily cards and six-hourly rows preserve missing values. These are numerical-model forecasts, not instrument observations, harbour measurements or navigation safety clearance.

Runtime validation covers units, array length/order, retrieval-window alignment, source attribution and returned grid distance. Fixed upstream hosts prevent caller-selected destinations. API keys are never returned to the browser. Requested coordinates and actual weather/marine grid coordinates are separate, and the distance to each grid is displayed. `fetchedAt` means retrieval time; the API does not supply a model-initialization timestamp here.

A process-local reader coalesces requests, caches successful/partial responses for 15 minutes, permits at most eight in-flight locations, and applies per-minute/hour/day budgets. Failed refreshes may use an explicitly stale snapshot for up to three hours; no fabricated fallback exists. These are per-process safeguards, not a distributed commercial quota manager.

## Deployment and sources

`OPEN_METEO_API_KEY` is optional and server-only. With a commercial subscription key, requests use customer API hosts. Without one, the public Open-Meteo service is restricted to non-commercial use; it is appropriate for the noncommercial demo/testing mode, not a blanket commercial-production licence. Commercial rollout requires an account/key and provider-budget review.

Official documentation:
- https://open-meteo.com/en/docs/jma-api
- https://open-meteo.com/en/docs/marine-weather-api
- https://open-meteo.com/en/pricing
- https://open-meteo.com/en/terms

## Geometry-dependent heat caches

Heat build output now uses the authoritative plot inventory and stores a private `_geometry_sha256` fingerprint in cached plot files. It is stripped before returning the existing public `HeatRiskResponse`. Cached output without a matching exact normalized geometry fingerprint, plot summary or season is rejected and recomputed from already-built local layers. No satellite downloads occur in that request. A writable output volume caches the repaired result atomically; a read-only volume still returns the computation without caching. Normal heat build jobs refresh the seasonal files when layers change.

This closes the specific bug where the map showed the migrated fishery-right polygon while heat data still described the old synthetic seed disc. Regression tests include equal-area/equal-centroid but different shapes, legacy files without a fingerprint, corrupted/wrong-identity files and reuse after repair.

## Verification

Unit tests cover provider failures/nulls, stale expiry, key redaction, cache/coalescing/budgets, input/source validation and both species' thresholds. Built smoke rejects invalid forecast coordinates without calling a provider. Chromium and WebKit were exercised at 390 and 1440 pixels, in English and Japanese, with real weather/marine responses for scallop and hoya selections; simulated fetch failure clears values and Refresh recovers. Storybook previews deliberately do not fetch operational forecasts.

The broader release audit #152 remains open. This work does not complete privileged API authorization, fresh wallet/LINE end-to-end tests or commercial deployment prerequisites.

### Operational request bounds

The current single-process guard permits 30 location refreshes per minute, 1,000 per hour and 4,000 per day, with two provider requests per refresh and at most 256 cached locations. Saturated requests return unavailable rather than bypassing the quota. The browser bounds normalized forecast JSON to 128 KiB and only permits the two known provider documentation URLs for attribution links. All-null source products cannot be presented as an available forecast. Source timestamps are UNIX seconds; JST is a presentation timezone, not an extra offset applied to the timestamp.
