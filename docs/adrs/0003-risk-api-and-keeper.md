# 0003: Separate risk indices from payout decisions

Status: Proposed. Interface and signer responsibilities remain gated by #55.

## Context

Main's TypeScript pipeline computes and signs triggers; the keeper consumes signed
feeds. The planned Python/FastAPI service publishes observed index values instead.

## Decision

Jay owns ingestion, risk computation, and producer schemas. The app validates risk
responses at runtime, applies the agreed versioned rules, constructs the supported
Trigger, and coordinates signing/settlement. Keep provider analysis out of browsers.
Export Python OpenAPI and fixtures in #79; generate TypeScript consumers in #55.

## Consequences

Generated types alone do not validate JSON. Resolve field aliases, units, nullability,
time boundaries, evidence hashes, and signer ownership before integration. Preserve
the deployed signing format until a coordinated replacement is agreed. Unavailable
or advisory data cannot satisfy the proposed operational signing gate.

## Evidence

[Current pipeline signer](../../pipeline/src/sign.ts),
[current keeper feed consumer](../../web/src/lib/keeper/feed-client.ts),
[#55](https://github.com/reeldeal-xyz/reeldeal/issues/55),
[#60](https://github.com/reeldeal-xyz/reeldeal/issues/60),
[#64](https://github.com/reeldeal-xyz/reeldeal/issues/64),
[#79](https://github.com/reeldeal-xyz/reeldeal/issues/79),
[#82](https://github.com/reeldeal-xyz/reeldeal/issues/82).
