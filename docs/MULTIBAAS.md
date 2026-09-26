# Curvegrid MultiBaas (issue #23)

Reel Deal uses Curvegrid MultiBaas to index ReliefPool/HumanRegistry/JPYC contract events on Sepolia and push
`Paid`/`Held` payouts to farmers over LINE via an authenticated webhook, in place of a keeper-side event
poller.

## How it's used

- **Contracts & addresses**: ReliefPool and HumanRegistry are linked as MultiBaas contracts (ABI uploaded
  from `packages/shared/src/abi/`); JPYC is linked against MultiBaas's built-in `erc20interface` contract
  (every MultiBaas deployment ships one — no need to upload a redundant ERC20 ABI).
- **Event indexing**: linking each contract to its address with a `startingBlock` turns on MultiBaas's
  event indexer for it, so `Donated`, `Attested`, `Paid`, `Held` (ReliefPool) get indexed and become
  queryable.
- **Webhook**: a MultiBaas webhook (`event.emitted` subscription) is registered against
  `POST /api/multibaas/webhook` (`web/src/app/api/multibaas/webhook/route.ts`). It verifies the
  HMAC-SHA256 signature MultiBaas sends on every delivery, then routes:
  - `Paid` / `Held` → the LINE push helper (`web/src/lib/line.ts`, issue #14 — stubbed here so #23 can
    land independently and merge trivially once #14 lands).
  - `Donated` / `Attested` → logged for now; the donor-ledger dashboard reads indexed events directly.
- **Dashboard**: `GET /api/multibaas/events` (`web/src/app/api/multibaas/events/route.ts`) queries
  MultiBaas's `GET /events` for the donor ledger, and returns `{ configured: false, events: [] }`
  gracefully whenever `MULTIBAAS_URL`/`MULTIBAAS_API_KEY` aren't set (e.g. before this issue's setup step
  has run, or on a machine without the deployment's credentials).

## Signature scheme

MultiBaas signs every webhook delivery and sends the signature and timestamp as headers:

- `X-MultiBaas-Signature`: hex-encoded `HMAC-SHA256(secret, rawRequestBody + decimalTimestampString)`
- `X-MultiBaas-Timestamp`: the same timestamp, as a decimal-seconds string, fed into the HMAC after the body

Verification (`web/src/lib/multibaas.ts#verifyMultiBaasSignature`) recomputes that HMAC with
`MULTIBAAS_WEBHOOK_SECRET` and compares it to the received signature in constant time. The docs page only
publishes Go pseudocode for *generating* the signature, not a numeric worked example or a verification
snippet — the unit tests include a signature vector derived from that documented algorithm, plus one
computed independently in the test itself, so a regression in either the implementation or our reading of
the algorithm would fail both.

Payload shape: MultiBaas POSTs a JSON **array** of `{ id, event: "event.emitted" | "transaction.included",
data }` items; for `event.emitted`, `data.event.name` is the Solidity event name and `data.event.inputs` is
an array of `{ name, value, type, hashed }` — see the fixtures in
`web/src/app/api/multibaas/webhook/route.test.ts` for a full example.

## Doc sources used

No single MultiBaas doc page covers all of this, so it's assembled from several, all read directly for
this issue (not from memory):

- <https://docs.curvegrid.com/multibaas/webhooks/> — signature scheme, `event.emitted` payload, webhook
  UI setup, subscribable event types (`transaction.included`, `event.emitted`)
- <https://docs.curvegrid.com/multibaas/event-indexing/> — what "sync events" / event indexing means
- <https://docs.curvegrid.com/multibaas/manage-contracts/> — linking an address to a contract
- <https://github.com/curvegrid/multibaas-sdk-typescript> — the TypeScript SDK repo; its
  openapi-generator-derived `docs/*.md` files gave the exact REST paths/request/response bodies used by
  `scripts/multibaas-setup.ts` and `web/src/lib/multibaas.ts` (`AddressesApi`, `ContractsApi`,
  `WebhooksApi`, `EventsApi`, and the `AddressAlias` / `BaseContract` / `LinkAddressContractRequest` /
  `BaseWebhookEndpoint` / `WebhookEndpoint` / `Event` models)
- Confirmed read-only against the live (pre-#16) MultiBaas deployment on 2026-09-26: chain status
  (`chainID: 11155111`, Sepolia), the response envelope shape (`{status, message, result}`), and that
  `GET /contracts` already lists a built-in `erc20interface` contract on every deployment.

## Setup (do this after #16 deploys ReliefPool/HumanRegistry)

1. In the MultiBaas console (already created — see the team for `MULTIBAAS_URL`), confirm the
   Administrators-group API key in the root `.env` as `MULTIBAAS_API_KEY`.
2. Update `packages/shared/src/addresses.ts` `DEPLOYED.ReliefPool` / `DEPLOYED.HumanRegistry` with the
   addresses #16 deployed (or export `RELIEF_POOL_ADDRESS` / `HUMAN_REGISTRY_ADDRESS` env overrides).
3. Dry-run the setup script first — it only performs read-only `GET`s and prints the plan:
   ```
   bun run multibaas:setup
   ```
4. Once the plan looks right, apply it:
   ```
   bun run multibaas:setup -- --apply
   ```
   This links ReliefPool/HumanRegistry/JPYC as MultiBaas contracts/addresses, uploads the ReliefPool and
   HumanRegistry ABIs from `packages/shared/src/abi/`, turns on event indexing (`MULTIBAAS_STARTING_BLOCK`,
   default `latest`), and registers the webhook against
   `https://web-production-746aa.up.railway.app/api/multibaas/webhook`.
5. The script prints a MultiBaas-generated webhook secret **once**, at registration time. Set it as
   `MULTIBAAS_WEBHOOK_SECRET` in the deployment's environment (Railway) and in the root `.env` for local
   testing — MultiBaas does not show it again (re-running the script skips an already-registered webhook
   rather than rotating the secret).
6. Re-run `bun run multibaas:setup` (dry run) to confirm everything now shows `=` (already set up) instead
   of `+` (would create/link/register).

### Test steps

- Unit tests (mocked `fetch`, no live MultiBaas needed): `bun run --filter web test`
- End-to-end, once the webhook is registered: trigger a `Paid` event on Sepolia (e.g. via the keeper,
  issue #17) and confirm a LINE message reaches a real phone (issue #14) — this is issue #23's "done when".
- Manual webhook smoke test without a real contract event: `POST` a hand-built `event.emitted` payload to
  `/api/multibaas/webhook` with a correctly computed `X-MultiBaas-Signature`/`X-MultiBaas-Timestamp` pair
  (see `sign()` in `web/src/app/api/multibaas/webhook/route.test.ts`) and confirm a `200` with
  `{ ok: true, processed: 1 }`.

## MultiBaas feedback

_(placeholder — fill in after using MultiBaas end-to-end for the Curvegrid RWA Tokenization track
write-up: what worked well, any friction in the console/API/docs, anything we'd ask Curvegrid to change.)_
