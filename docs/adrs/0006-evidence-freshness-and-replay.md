# 0006: Keep evidence provenance, freshness, and replay explicit

Status: Proposed operational contract. Pinned inputs exist; enforcement work remains.

## Context

Main includes 2026 buoy/MUR comparison CSVs, Miyagi toxin sources, approximate zone
geometry, and a keeper fallback when signed feeds fail. These are not interchangeable
with current observations, a 2022–2025 replay archive, or verified JAXA regressions.

## Decision

Carry source/product, exact input hash, observation/retrieval times, units, spatial
support or sensor depth, quality, and gaps through the producer/consumer boundary.
Distinguish current observations, historical observed replay, advisory output, and
synthetic fixtures. Use one agreed evaluator for HMI and keeper. Operational failures
must not silently fall back to demo signing; simulation must not call signing/settlement.

## Consequences

Agree freshness and missing-data semantics in #55/#77 rather than inventing one TTL.
Keep data season, rule/source revision, chain event identity, and payout season
distinct. Viewing a historical year must not add unrelated 2026 restrictions.
Real heat integration needs #36/#77 evidence; successful HTTP or health checks are insufficient.

## Evidence

[Buoy/MUR manifest](../../pipeline/data/buoy/sources.json),
[toxin manifest](../../pipeline/data/toxin/sources.json),
[current keeper fallback](../../web/src/lib/keeper/run.ts),
[#36](https://github.com/reeldeal-xyz/reeldeal/issues/36),
[#60](https://github.com/reeldeal-xyz/reeldeal/issues/60),
[#64](https://github.com/reeldeal-xyz/reeldeal/issues/64),
[#68](https://github.com/reeldeal-xyz/reeldeal/issues/68),
[#47](https://github.com/reeldeal-xyz/reeldeal/issues/47).
