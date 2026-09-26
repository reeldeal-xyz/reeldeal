# Frontend #66 marketplace preview

This branch adds a frontend-only slice of [#66](https://github.com/ss251/reeldeal/issues/66). It does not complete checkout or replace `/shop`.

## What is implemented

- A hydrated React controller around the existing Astro `MarketCard` components. Search accepts Japanese, English and full-width Latin text; species and availability filters combine. EN/日本語 preserves the current filters and updates controls, sample state labels, details, card actions and image descriptions.
- Native local lot details, an empty result state, and explicit loading/unavailable states with a button to restore sample inventory. No request is made by that recovery button.
- The eggshell canvas fills the viewport, including short states and desktop margins. Opening lot details expands that item across the grid so mobile copy has the full available width.
- Six saved checkout states: before approval, wallet rejection, submitted, confirmed, failed and unavailable. They compose `Amount`, `ContributionSplit`, `Status` and `Button`. Actions are disabled; every state is labelled synthetic.
- A backwards-compatible optional `labels` prop on `MarketCard`. Existing consumers retain their English defaults.
- Fourteen organism stories: eight discovery stories including two interaction checks, and six checkout stories.

All values and allocations are local presentation fixtures. The 10% contribution is an example, not a configured contribution policy. Submitted and confirmed remain separate, and no transaction hash or fabricated live receipt is displayed.

Before approval and after wallet rejection, the contribution is labelled **Proposed split**. Only the submitted example uses **Pending**; **Paid** is reserved for the synthetic confirmed state. Checkout stories assert that approval/rejection do not display payment-status badges.

## Source reuse

Inspected source [PR #37](https://github.com/superposition/reeldeal/pull/37) at `8218163160924ac78cb5a967988b5439336a392a`, plus the current source checkout's market components. Reused its bilingual browsing vocabulary, NFKC search normalization and species/availability filtering approach. The actual existing `MarketCard` remains in use.

The source PR's six seafood portraits and dockside hero are not ported. Cards continue to use the current labelled illustration. Submitted-photo precedence still needs a reviewed listing adapter and an image-capable card interface.

## Verification

- `bun install --frozen-lockfile`: passed, lockfile unchanged.
- `bun run --cwd frontend check`: passed after merging main, 54 files, zero errors/warnings/hints.
- `bun run --cwd frontend test`: passed after merging main, 10 tests / 55 assertions. Includes `scripts/marketplace-filter.test.ts`; its 2 tests / 8 assertions cover bilingual/full-width matching, combined filters, empty matches and unchanged fixtures.
- `bun run --cwd frontend build`: passed.
- `bun run --cwd frontend build-storybook`: passed. It still logs the existing Astro renderer `transport was disconnected` message and a large-chunk warning.
- Inspected generated `astro-prerendered-stories.json`: inline marketplace styles are present; discovery includes the React hydration island and placeholder image; Japanese initial markup includes translated preview/action/alt text.
- Storybook interaction checks wait for hydration, then exercise search, locale preservation, empty results, filter reset, species plus availability, local detail disclosure and unavailable-state recovery. At 390px, `InteractiveFilters` passed with readable expanded Japanese details and visible keyboard focus; `RecoverSamples` passed. At 320px, `BeforeApproval` and `WalletRejected` passed their `Proposed split` assertions. At 1440px, final inspection confirmed an eggshell background across the viewport, no blue edge, and a readable short unavailable state.

Combined integration review with the #67/#68 previews also passed 17 tests / 94 assertions, a 63-file frontend check, Astro build, built-server smoke checks and Storybook build. These combined counts include the other preview slices.

Reviewed the Dotdog `Application` and `Documentation` observed scopes and ADR 0002 against this source diff. Their definitions remain accurate: these are Astro/Storybook previews, legacy routes still redirect to `web/`, and app-core/production service migration remains pending. No spec or ADR prose change was needed; only those two review baselines are refreshed for this branch.

## Review in Storybook

At 320/390/1440px inspect `Marketplace Discovery / English`, `Japanese`, `Empty Search`, and the six `Marketplace Checkout` states. Run `Interactive Filters` and `Recover Samples`; check keyboard focus, visible imagery, no horizontal overflow, and readable split amounts. New styles use inline, uniquely prefixed rules because this static Astro adapter can omit extracted component CSS.

## Remaining gates

The #61 molecule foundation is on main through #89. Reviewed domain fixtures still depend on #59, and backend prerequisites #62/#65 remain external. This preview adds no API endpoint, authentication, reservation, quote signing, wallet access, approval, transaction submission, reconciliation or persistent pending-order recovery.

This branch merged main at `79315344b596900f4f10988421534867e82c09cb`, including #89, #91's JPYC base-unit display helper, and the LIFF flows from #31. The combined Application/Documentation review baselines were regenerated after reviewing those existing `web/` flows alongside the marketplace previews. Preview amounts remain human-readable decimal strings; a later chain adapter must use the helper when converting raw 18-decimal token amounts. The draft PR targets main.

Real checkout still needs server-owned exact quotes and inventory reservations, matching receipt/router/pool-event confirmation, duplicate/reload recovery, rejected/expired/tampered quote handling and competing-buyer verification. Japanese checkout copy, source portraits, production discovery/detail routes and live data integration remain outside this slice. Keep #66 open.

## Catalogue compatibility follow-up

After #94–#96 merged, this follow-up prepares the marketplace for the six-species catalogue in [PR #93](https://github.com/reeldeal-xyz/reeldeal/pull/93), reviewed at `2fb0722f9469b65f8cffe2a67381ea7c2b4748bc`. It adds no artwork or image resolver. Names use species keys and synthetic availability uses lot IDs, so reordering or extending `previewLots` cannot attach another lot's metadata. Unconfigured lot IDs show **Availability not specified**, including the three incoming samples. Unrecognized species retain their supplied name and remain searchable.

`MarketCard` receives the original lot unchanged; its optional `labels.species` supplies the existing bilingual heading separately. Preserve this display-label support and the optional `labels.imageAlt` override when integrating #93's image markup. Both locales now describe a seafood illustration without claiming it is a silhouette or landing photograph. Species options are unique, and story reset/recovery checks use the actual catalogue size.

The follow-up merges main `3ffccec2f2db8c6a6d93d68f0a608378539d742e`, including #84's Python pipeline and workspace changes. Frozen install passes with the lockfile unchanged. Frontend tests pass (23 tests / 119 assertions), including expanded/reversed catalogue, unknown species, missing availability and canonical-lot preservation. The frontend phase of the workspace typecheck passes (64 files, no errors/warnings/hints); shared passes too. The root command still fails in legacy `web/` with TS2688 for the missing `minimatch` type definition; the Python pipeline is no longer a Bun typecheck workspace. `contracts:test` reports 113 passing tests; networked fork execution was not enabled. Astro build and built-server smoke checks pass. This follow-up changes no contract, shared schema, route or styling.

Storybook builds with the existing transport/chunk diagnostics. Generated markup verifies unchanged bilingual headings, hydration, inline canvas styles and truthful EN/JA illustration alt text across the eight discovery stories. Browser interactions still need the root review for this follow-up. Dotdog tests (2 tests / 32 assertions) and script typecheck pass. A clean detached checkout of main `3ffccec` reproduces stale Pipeline, Tooling and Documentation baselines after #84; these failures are inherited from main.

A separate source/spec review verified the Python scaffold and deployment workflow before refreshing their baselines. This follow-up also corrects the stale README, architecture/interface status notes and ADR 0003/0007 descriptions: the scaffold and CD workflow are merged, the keeper still expects legacy signed feeds, and risk-index integration and successful deployment remain unverified. The daily pipeline build job remains planned. Application, Pipeline, Tooling and Documentation review hashes are refreshed after that review; no pipeline implementation or deployment configuration changes.
