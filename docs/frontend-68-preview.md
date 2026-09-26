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
Forecast previews retain missing/loading/unavailable reading states even when
a stale numerical value is present. Observed provenance is suppressed in
advisory mode until a reviewed forecast source component can label its times.

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
bun run --cwd frontend test
bun run frontend:build
bun run storybook:build
```

The focused tests exercise missing bytes/deployment/replay season, malformed
temperature, contradictory match flags, advisory context and independent
pending payment state. Storybook play checks cover the source disclosure and
refusal to show a match for advisory/incomplete records.

Browser review passed the Matching play assertions and the final AdvisoryOnly
play assertions at 390px, with no observed provenance or payment record shown
for the forecast. IncompleteEvidence at 320px displayed the unavailable result
and readable wrapped values. These checks do not establish live verification;
the remaining story variants and 1440px view still need visual review.

Inline styles preserve this organism's CSS in static Storybook; no new shared
CSS import is required.

After merging main at `e3bc4f31c8cb51809fccc3e9175918714c9176ce` (including
the #94 marketplace and #95 farmer previews), the standard frontend suite passes
21 tests / 104 assertions and frontend typecheck reports zero diagnostics across
64 files. Contracts pass all 113 tests. Root typecheck still stops in `web/`
with TS2688 for the implicit ambient `minimatch` type library; shared, pipeline
and frontend checks pass. The combined Application/Documentation scopes and
Astro ADR remain accurate, and their review hashes were regenerated.
