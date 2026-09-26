# Frontend #66 marketplace preview

This branch adds a frontend-only slice of [#66](https://github.com/ss251/reeldeal/issues/66). It does not complete checkout or replace `/shop`.

## What is implemented

- A hydrated React controller around the existing Astro `MarketCard` components. Search accepts Japanese, English and full-width Latin text; species and availability filters combine. EN/日本語 preserves the current filters and updates controls, sample state labels, details, card actions and image descriptions.
- Native local lot details, an empty result state, and explicit loading/unavailable states with a button to restore sample inventory. No request is made by that recovery button.
- Six saved checkout states: before approval, wallet rejection, submitted, confirmed, failed and unavailable. They compose `Amount`, `ContributionSplit`, `Status` and `Button`. Actions are disabled; every state is labelled synthetic.
- A backwards-compatible optional `labels` prop on `MarketCard`. Existing consumers retain their English defaults.
- Fourteen organism stories: eight discovery stories including two interaction checks, and six checkout stories.

All values and allocations are local presentation fixtures. The 10% contribution is an example, not a configured contribution policy. Submitted and confirmed remain separate, and no transaction hash or fabricated live receipt is displayed.

## Source reuse

Inspected source [PR #37](https://github.com/superposition/reeldeal/pull/37) at `8218163160924ac78cb5a967988b5439336a392a`, plus the current source checkout's market components. Reused its bilingual browsing vocabulary, NFKC search normalization and species/availability filtering approach. The actual existing `MarketCard` remains in use.

The source PR's six seafood portraits and dockside hero are not ported. Cards continue to use the current labelled illustration. Submitted-photo precedence still needs a reviewed listing adapter and an image-capable card interface.

## Verification

- `bun install --frozen-lockfile`: passed, lockfile unchanged.
- `bun run --cwd frontend check`: passed, 53 files, zero errors/warnings/hints.
- `bun test frontend/src/components/organisms/marketplace/filter.test.ts`: 2 passed, 8 assertions. Covers bilingual/full-width matching, combined filters, empty matches and unchanged fixtures.
- `bun run --cwd frontend build`: passed.
- `bun run --cwd frontend build-storybook`: passed. It still logs the existing Astro renderer `transport was disconnected` message and a large-chunk warning.
- Inspected generated `astro-prerendered-stories.json`: inline marketplace styles are present; discovery includes the React hydration island and placeholder image; Japanese initial markup includes translated preview/action/alt text.
- Storybook interaction checks wait for hydration, then exercise search, locale preservation, empty results, filter reset, species plus availability, local detail disclosure and unavailable-state recovery. These checks were authored and bundled here; browser execution and visual acceptance remain for root review.

## Review in Storybook

At 320/390/1440px inspect `Marketplace Discovery / English`, `Japanese`, `Empty Search`, and the six `Marketplace Checkout` states. Run `Interactive Filters` and `Recover Samples`; check keyboard focus, visible imagery, no horizontal overflow, and readable split amounts. New styles use inline, uniquely prefixed rules because this static Astro adapter can omit extracted component CSS.

## Remaining gates

#59/#61 reviewed domain fixtures and the backend prerequisites #62/#65 remain external. This preview adds no API endpoint, authentication, reservation, quote signing, wallet access, approval, transaction submission, reconciliation or persistent pending-order recovery.

Real checkout still needs server-owned exact quotes and inventory reservations, matching receipt/router/pool-event confirmation, duplicate/reload recovery, rejected/expired/tampered quote handling and competing-buyer verification. Japanese checkout copy, source portraits, production discovery/detail routes and live data integration remain outside this slice. Keep #66 open.
