# SaleRouter (issue #65 / SP-11)

Atomic marketplace checkout: one transaction pulls the quoted JPYC total from the buyer, pays the
seller their share, and contributes the relief share to `ReliefPool.donate`. All three legs succeed
together or the whole call reverts -- `SaleRouter` never holds JPYC across transactions.

Contract: `contracts/src/SaleRouter.sol` (+ `contracts/src/interfaces/ISaleRouter.sol`). ABI:
`packages/shared/src/abi/SaleRouter.ts`. Not yet deployed -- see "Deploying" below.

## Flow

1. The app (Eric/Justin's marketplace backend) builds an order and signs a `Quote` server-side with
   the `quoteSigner` key (see "Who signs quotes" below).
2. The buyer's wallet calls `JPYC.approve(router, quote.total)`.
3. The buyer's wallet calls `router.checkout(quote, signature)`.
4. `checkout` verifies the signature, replay/double-sale guards and relief-rate config, then:
   - pulls `quote.total` JPYC from the buyer into the router,
   - pays `quote.seller` their share,
   - (if the relief share rounds to something nonzero) approves and calls
     `ReliefPool.donate(reliefAmount, "sale:<orderId>")`,
   - emits `Checkout(orderId, listingId, buyer, seller, total, sellerAmount, reliefAmount, reliefBps)`.
5. To correlate a checkout with the pool's own accounting, match the `Checkout` event's `orderId`
   against `ReliefPool`'s `Donated(from, amount, memo)` event where `from == address(router)` and
   `memo == "sale:" + orderId` (0x-prefixed, lowercase, 32-byte hex -- exactly `orderId` as a `Hex`
   string).

## Quote fields (`ISaleRouter.Quote` / `packages/shared/src/quote.ts` `Quote`)

| Field | Type | Notes |
|---|---|---|
| `orderId` | `bytes32` | App-level order id. Unique per order -- reused `orderId` reverts `OrderAlreadyUsed`. |
| `listingId` | `bytes32` | The single-inventory listing being sold. Already-sold `listingId` reverts `ListingAlreadySold`, even with a fresh `orderId`/`nonce`. |
| `buyer` | `address` | Must equal `msg.sender` of `checkout`, or it reverts `WrongBuyer`. |
| `seller` | `address` | Paid `sellerAmount` directly. |
| `total` | `uint256` | JPYC, 18 decimals. Pulled from `buyer` in full. |
| `reliefBps` | `uint16` | Contribution rate, snapshotted into the quote at signing time. Router enforces `reliefBps <= maxReliefBps` (its own admin-configured ceiling) and refuses to operate at all if `maxReliefBps` has never been configured (`ReliefBpsNotConfigured`). |
| `nonce` | `uint256` | Per-buyer anti-replay nonce (`usedNonces[buyer][nonce]`), independent of `orderId`/`listingId`. |
| `expiry` | `uint64` | Unix seconds; `block.timestamp > expiry` reverts `QuoteExpired`. |

The router address, JPYC token, ReliefPool and chain id are **not** quote fields -- they're bound by
the EIP-712 domain (`verifyingContract`, `chainId`) and SaleRouter's constructor immutables, so a
quote signed for one router/pool/chain can never verify against another.

## EIP-712 domain and typehash

```
domain: { name: "SaleRouter", version: "1", chainId: 11155111, verifyingContract: <router address> }
Quote(bytes32 orderId,bytes32 listingId,address buyer,address seller,uint256 total,uint16 reliefBps,uint256 nonce,uint64 expiry)
```

`packages/shared/src/quote.ts` exports `QUOTE_EIP712_TYPES` and `saleRouterEip712Domain(verifyingContract)`
with the exact same shape -- keep both sides in sync if the Quote struct ever changes (and update
`contracts/src/interfaces/ISaleRouter.sol`'s NatSpec pointer, same convention as `Trigger`/`trigger.ts`).

## Rounding rule (defined once)

`reliefAmount = floor(total * reliefBps / 10_000)`; `sellerAmount = total - reliefAmount`. Relief
always rounds **down**; the seller always gets the exact remainder, so `sellerAmount + reliefAmount
== total` holds by construction (not by a separate on-chain check). A very small `total` can floor
`reliefAmount` to `0` even with `reliefBps > 0` -- `ReliefPool.donate` reverts on a zero amount, so
`checkout` simply skips the donate call in that case (no `Donated` event for that sale's relief leg);
it does not fail the sale.

## Who signs quotes

`quoteSigner` is a single EOA address configured on the router (`setQuoteSigner`, admin-only). It
**must** be a server-side-only key -- never shipped to a client, mobile app or browser. The deploy
script defaults it to the same `COOP_SIGNER` role `ReliefPool`'s 2-of-3 Trigger set already uses
(`vm.addr(COOP_SIGNER_PRIVATE_KEY)`), so the existing coop signer infrastructure can double as the
marketplace's quote signer unless a distinct key is configured via `QUOTE_SIGNER`. Signing itself
happens off-chain, in the app backend that builds the order (Eric/Justin's side) -- see
`signSaleQuote()` below.

## Viem snippet (server: sign; client: approve + checkout)

```ts
import { createWalletClient, erc20Abi, http, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import {
  JPYC,
  SaleRouterAbi,
  signSaleQuote,
  type Quote,
} from '@repo/shared';

// --- Server-side: sign the quote (quoteSigner key never leaves the server) ---
const quoteSignerAccount = privateKeyToAccount(process.env.QUOTE_SIGNER_PRIVATE_KEY as `0x${string}`);
const quoteSignerClient = createWalletClient({ account: quoteSignerAccount, chain: sepolia, transport: http() });

const routerAddress = '0x...'; // SaleRouter, once deployed -- see packages/shared/src/addresses.ts
const quote: Quote = {
  orderId: '0x...',
  listingId: '0x...',
  buyer: '0xBuyerAddress',
  seller: '0xSellerAddress',
  total: parseUnits('20000', 18), // JPYC, 18 decimals -- never assume 6
  reliefBps: 500, // 5%, must be <= the router's configured maxReliefBps
  nonce: 1n,
  expiry: BigInt(Math.floor(Date.now() / 1000) + 15 * 60), // 15 minutes
};
const signature = await signSaleQuote(quoteSignerClient, quoteSignerAccount, routerAddress, quote);
// Hand { quote, signature } to the buyer's client.

// --- Client-side: buyer approves JPYC, then checks out ---
const buyerClient = createWalletClient({ account: buyerAccount, chain: sepolia, transport: http() });

await buyerClient.writeContract({
  address: JPYC,
  abi: erc20Abi, // JpycAbi is a hand-picked minimal ABI without `approve`; viem's standard erc20Abi has it
  functionName: 'approve',
  args: [routerAddress, quote.total],
});

await buyerClient.writeContract({
  address: routerAddress,
  abi: SaleRouterAbi,
  functionName: 'checkout',
  args: [quote, signature],
});
```

## Deploying

```
forge script contracts/script/DeploySaleRouter.s.sol --sig "run()" --root contracts \
  --rpc-url $SEPOLIA_RPC_URL --broadcast
```

Required env: `DEPLOYER_PRIVATE_KEY`. Optional: `QUOTE_SIGNER` (address; defaults to
`vm.addr(COOP_SIGNER_PRIVATE_KEY)`), `COOP_SIGNER_PRIVATE_KEY` (only needed to derive that default),
`MAX_RELIEF_BPS` (default `1000`, i.e. 10%). This has **not** been broadcast yet -- once it is, record
the address (and the `quoteSigner`/`maxReliefBps` actually used) in `packages/shared/src/addresses.ts`'s
`DEPLOYED`.

The fork dry run (never broadcasts; forks Sepolia and runs one real `checkout` against the live JPYC
and ReliefPool v2 already deployed there) has been verified end to end:

```
forge script contracts/script/DeploySaleRouter.s.sol --sig "dryRun()" --root contracts \
  --fork-url $SEPOLIA_RPC_URL -vv
```

## Explicitly skipped (time-boxed for the freeze)

- **EIP-3009/2612 permit path** (single-transaction checkout without a separate `approve`). JPYC's
  proxy doesn't expose `DOMAIN_SEPARATOR()`/`eip712Domain()` (see
  `packages/shared/src/addresses.ts`'s `JPYC_EIP712_DOMAIN` comment for the live-verified hardcoded
  domain), which would have made a permit path meaningfully more fragile to get right under the
  deadline than a plain `approve` + `checkout` two-step. The two-step flow above is what's shipped;
  a permit path is a reasonable follow-up, not a blocker.
- **TS<->Solidity EIP-712 digest cross-check test** (the `Trigger`/`ReliefPoolEip712Vector.t.sol`
  pattern, applied to `Quote`). `QUOTE_EIP712_TYPES` in `packages/shared/src/quote.ts` and
  `QUOTE_TYPEHASH` in `contracts/src/SaleRouter.sol` were written field-for-field from the same spec
  and exercised together by the fork dry run above (which signs with `vm.sign` in Solidity against a
  digest that must match what a real off-chain signer would produce), but a dedicated fixture test
  pinning a hardcoded digest (like `ReliefPoolEip712Vector.t.sol`) was not added -- worth adding before
  this ships beyond the demo.
