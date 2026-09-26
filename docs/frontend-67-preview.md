# Farmer relief status preview (#67)

This slice composes the existing FarmCard, TransactionRow, ProvenanceDetails and
UI atoms into one farmer status screen. It is available in Storybook under
**ReelDeal → 03 Organisms → Farmer Relief**. No route is replaced, and the
existing `/liff` app keeps ownership of real accounts and actions.

## Source and represented states

Reviewed PR #31 at `2db9aeeb3b1b669b19e9ec20cd299d630d09b0ae`, particularly
`liff-app.tsx`, `lib/liff/status.ts`, `lib/liff/claim.ts` and `held-reasons.ts`.
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

Local checks: frontend typecheck, Astro build, four existing frontend tests and
113 contract tests passed. Static Storybook initially generated all nineteen farmer
stories with the inline CSS and React hydration references. It retains the
documented Astro adapter transport-disconnect diagnostic during cleanup.
Whole-repository typecheck encountered TS2688 in `web/` from ambient
`/Users/ericmanganaro/node_modules/@types/minimatch` outside this repository;
this is home-directory type contamination, not an established source failure.
Shared, pipeline and frontend checks pass. Browser
visual inspection and play execution remain required for this slice.

The component inlines its own prefixed CSS so it also survives static Astro
Storybook rendering. It uses existing eggshell surfaces and tokens; no shared
styles or molecules are changed.

## Remaining integration gates

- #59 supplies reviewed domain fixtures and Farm/Plot relationships; the example
  farm and selected `p1213-001` here do not establish a mapping.
- #63 supplies the reviewed server action boundary; #69 supplies authoritative
  donor/relief state. These previews consume neither yet.
- PR #31 remains the source for real LIFF session, QR/plot selection, World
  binding, slot requests and claim behavior; port and verify those when ready.
- Real status must be event/season-specific, preserve exact JPYC base units and
  use the correct confirmed transaction receipt. Do not promote a request or
  the original Held transaction into payment evidence.
- Donor, holder and co-op migration; LINE delivery; real-phone and World
  acceptance; server authorization; and deployed parity remain outside this
  preview. This slice does not complete #67.
