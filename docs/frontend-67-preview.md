# Farmer relief status preview (#67)

This slice composes the existing FarmCard, TransactionRow, ProvenanceDetails and
UI atoms into one farmer status screen. It is available in Storybook under
**ReelDeal → 03 Organisms → Farmer Relief**. No route is replaced, and the
existing `/liff` app keeps ownership of real accounts and actions.

## Source and represented states

Initially reviewed PR #31 at `2db9aeeb3b1b669b19e9ec20cd299d630d09b0ae`,
particularly `liff-app.tsx`, `lib/liff/status.ts`, `lib/liff/claim.ts` and
`held-reasons.ts`. Its LIFF implementation is now merged into main at
`79315344b596900f4f10988421534867e82c09cb` and included in this branch.
The Astro route and action migration remains pending.
The five Held reason labels also match `ReliefPool.sol` at this branch's base
`08c96cb`:

| State | Preview behavior |
| --- | --- |
| Level 0 / Level 1 / Level 2 | Identity remains distinct from slot ownership and relief eligibility. |
| No payout recorded | Shows no amount or inferred eligibility. |
| Slot request pending | A request does not imply an issued slot or payment approval. |
| Paid | Explicitly synthetic confirmed-payment state; no fabricated explorer link. |
| Held: UNVERIFIED | Verification preview; a verified fixture can preview a claim request. |
| Held: NO_FARMER | Explains missing registration; no recipient or claim action. |
| Held: PLOT_EXPIRED | Explains expired slot; directs the farmer to the co-op. |
| Held: CAP | Explains the event unit cap; no claim action. |
| Held: ZONE_MISMATCH | Explains zone/species enrollment mismatch; no recipient or claim action. |
| Claim window elapsed | Represents Swept: no currently held balance or claim action. |
| Expired/revoked slot | Keeps registration status separate from a payout outcome. |
| Unavailable | Unknown identity is not rendered as unverified; no amount is inferred. |
| Identity cancellation | Local interaction leaves verification and Held state unchanged. |

`CLAIM_WINDOW_ELAPSED` is PR #31's client-side label for Swept, not a sixth
on-chain Held reason. A pending claim remains Held until evidence confirms
payment. The fixture amount is an example allocation, not an amount decoded
from a Held event.

The PR #31 farmer flow uses an in-app wallet and relayed claims. It does not
contain a connect-wallet or farmer transaction-signing step, so this slice
previews **identity-check cancellation** instead of inventing wallet cancellation.
The React demo controls run locally; no World, LINE, wallet, API or RPC clients
are imported. They neither grant verified status nor mark a payment Paid.

## Validation

Run `bun run frontend:check`, `bun run frontend:build`, and
`bun run storybook:build`. Twenty-three named stories cover the states above,
including a historical identity hold with a currently expired/revoked slot,
missing wallet or unknown identity. The claim demo is only available with a
currently issued slot, verified identity and nonzero valid wallet. This is a
display guard, not a replacement for the contract's eligibility checks.
`CancelIdentityCheck` and `ClaimRequestStaysHeld` include browser play assertions
that wait for hydration. Story building alone does not execute those assertions.
Inspect at 320, 390 and 1440 pixels. Check keyboard focus, cancellation, natural
scrolling, the provenance disclosure and the absence of a claim button for
non-UNVERIFIED reasons.

Local checks include frontend typecheck, Astro build and the standard frontend
tests, including five claim-preview guard tests. The initial contract check
passed all 113 tests. Static Storybook contains the farmer stories, inline CSS
and React hydration references; it retains the documented Astro adapter
transport-disconnect diagnostic during cleanup.
Whole-repository typecheck encountered TS2688 in `web/` from ambient
`/Users/ericmanganaro/node_modules/@types/minimatch` outside this repository;
this is home-directory type contamination, not an established source failure.
Shared, pipeline and frontend checks pass. Root's browser validation at 320px
passed `CancelIdentityCheck` and `ClaimRequestStaysHeld`, and confirmed that
`VerifiedHeldExpiredSlot` shows its explanation with no claim action. Broader
390/1440px inspection and the remaining states still need browser acceptance.

After merging main at `f5d2b11bf131db0497a8dfbc31f1283ac457416c` (including
#94's marketplace preview), frontend checks pass for 60 files and the standard
frontend suite passes 15 tests / 78 assertions. Contract tests pass 113 tests;
Dotdog tests pass 2 tests / 32 assertions. The whole-repository typecheck still
has the ambient `web/` minimatch limitation described above. Reviewed the
combined marketplace and farmer source against the Application/Documentation
specs and ADR 0002: their descriptions remain accurate, so only the reviewed
hashes are refreshed. These totals include the marketplace and shared display
tests; they do not establish production acceptance for #67.

The component inlines its own prefixed CSS so it also survives static Astro
Storybook rendering. It uses existing eggshell surfaces and tokens; no shared
styles or molecules are changed.

## Remaining integration gates

- #59 supplies reviewed domain fixtures and Farm/Plot relationships; the example
  farm and selected `p1213-001` here do not establish a mapping.
- #63 supplies the reviewed server action boundary; #69 supplies authoritative
  donor/relief state. These previews consume neither yet.
- The merged PR #31 implementation in `web/` supplies LIFF session, QR/plot
  selection, World binding, slot requests and claim behavior. Port and verify
  those in Astro when the server/domain boundaries are ready.
- Real status must be event/season-specific, preserve exact JPYC base units and
  use the correct confirmed transaction receipt. Do not promote a request or
  the original Held transaction into payment evidence.
- Donor, holder and co-op migration; LINE delivery; real-phone and World
  acceptance; server authorization; and deployed parity remain outside this
  preview. This slice does not complete #67.
