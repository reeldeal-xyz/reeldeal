# Event evidence preview (#68)

This slice adds a Storybook organism that composes the existing measurement,
source disclosure, transaction and badge components. It leaves `/map`,
`/verify/[eventId]`, the legacy verifier and all service clients unchanged.

## What reviewers can inspect

Seven synthetic stories cover matching, mismatched, unavailable, historical
observed replay, advisory-only, incomplete evidence and wrong-deployment states.
Every state retains a visible fixture notice. Payment state is separate from
the evidence result; a match does not mark the example transfer Paid.

The comparison rows show exact input bytes, SHA-256 input hash, index/unit,
threshold/unit, fire date/Unix timestamp, start/end window, rule/version,
observation season, payout season, chain ID, deployment address and ABI version.
Long values wrap at phone widths. The existing provenance disclosure is the
only interaction; there are no wallet, signing, settlement, API or LINE calls.

## Boundary and remaining integration

`EventVerificationPreview` is a frontend display type, not the #59 API contract.
Comparison results are supplied explicitly by local fixtures. Dummy hashes,
event IDs and deployment addresses are not actual chain records. The component
does not hash bytes, recompute indices, compare rules or query a chain.

The display gate refuses a matching state if required context, input values,
comparison results, a finite temperature reading or source metadata are absent.
It also rejects a supplied match when its canonical display values differ;
equal display text alone never creates a match. Advisory mode cannot show a
matching result. The gate is not domain validation;
the reviewed #60/#64 verifier and adapter must supply validated records.

The current legacy `resolve-event.ts` returns the first match across replay
years, while `VerifyClient` considers its CSV hash and fire date for success.
This preview therefore exposes the observation season separately and requires
all comparison slots. It does not resolve that ambiguity or fix the production
verification algorithm. The exact contract deployment/ABI and `tempC` handoff
remain external integration gates.

MapLibre, actual polygons, layer/time synchronization, toxin restriction/lift
dates, real pinned artifact verification, and the production route migration
remain open under #68. Do not close that issue on this preview alone.

## Verification

```sh
bun run frontend:check
bun test frontend/src/components/organisms/event-verification
bun run frontend:build
bun run storybook:build
```

The focused tests exercise missing bytes/deployment/replay season, malformed
temperature, contradictory match flags, advisory context and independent pending payment state. Storybook
play checks cover the source disclosure and refusal to show a match for
advisory/incomplete records. A browser run is still needed to execute those
play checks and inspect 320/390/1440px layouts. Inline styles preserve this
organism's CSS in static Storybook; no new shared CSS import is required.
