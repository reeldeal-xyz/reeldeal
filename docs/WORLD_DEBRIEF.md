# World ID debrief (issue #25)

Live run on 2026-09-26 during ETHGlobal Tokyo, inside the Reel Deal LIFF app on a real phone, against the
production World ID app `app_1fd3fa02dfc9da8cbf93e8bc82f50856` (RP `rp_eaf4611c2f9dc0d7`) and HumanRegistry
`0xc713c174b33B071f7Bf6dC571E3dd7BfB441D4F8` on Sepolia.

## Run

- **Date / location:** 2026-09-26, ~17:15–17:30 JST, ETHGlobal Tokyo venue.
- **Tester:** a team member's own World App account.
- **Device:** iPhone, World App (production), opened from the LINE in-app browser (LIFF).
- **Credentials used:**
  - **Level 1:** Selfie Check (schema **11**). Action `bind-payout-wallet`.
  - **Level 2:** World ID **Orb / Proof of Human** (schema **1**). Action `upgrade-level-2`, which accepts
    `any(mnc(), passport(), proofOfHuman())`. The tester is not a Japanese resident, so there was no
    My Number Card; World App presented the strongest credential the tester holds.
- **Wallet:** `0x1aEDC8476f15BdF1Ac742544c58Be3a187eEAB51`.
- **On-chain result:**
  - `Bound` (schema 11):
    [`0x4fa9bbc2…c4b1`](https://sepolia.etherscan.io/tx/0x4fa9bbc2cbee92f9005cf357390278ea7ce0ac8d4e89938546e3c522cdf9c4b1)
  - `Upgraded` (schema 1):
    [`0x9e81e69a…b093`](https://sepolia.etherscan.io/tx/0x9e81e69abaf042acfa28c4b69399bab6941e23015a96b20ca31920d312bcb093)
  - `HumanRegistry.levelOf(wallet) == 2`, so the unit cap rose from 3 to 12.
  - The same wallet was then paid 10,000 JPYC by ReliefPool for the Karakuwa scallop restriction event
    (see `docs/SUBMISSION.md`).

## Timing (approximate, from server logs)

- **Verify tap → World App opens:** a few seconds (deep link from the LIFF browser).
- **Selfie Check in World App:** about 1–2 minutes, including one cancelled first attempt.
- **Proof → `Bound` on Sepolia:** about 10 s. The server does the v4 verify, then the binder transaction.
- **Level-2 upgrade:** about 1 minute end to end.
- **Total time to the first successful level-1 bind:** about 2 minutes.

## Friction log

Outcomes from the `scope:"world-id"` server log lines (`web/src/lib/world/log.ts`):

| # | outcome | reason | what the tester saw | what we changed |
|---|---------|--------|---------------------|-----------------|
| 1 | cancelled | `verification_rejected` | Backed out of the first Selfie Check prompt in World App | Nothing needed. The app showed a clear retry message. |
| 2 | success (on-chain) | level 1, schema 11 | Returned to LINE, but the page still said "not verified" | See the next two rows. |
| 2a | (client) | HTTP 499: the LIFF page reloaded on the way back from World App and dropped the verify response | Status unchanged | #101: the server links wallet ↔ LINE inside `/api/world/verify`, so the client doesn't need the response |
| 2b | (client) | The level was read before the bind transaction was mined | Level 0 shown | #101: the app re-reads `levelOf` every 3 s for up to about 45 s after verifying |
| 2c | (identity) | Opening LIFF in another browser context minted a second on-device wallet, so the verified wallet and the plot owner diverged | Wrong wallet shown | #101: the server pins one wallet per LINE user and returns it on each session |
| 3 | success | level 2, schema 1 (Orb) | The button said "My Number Card", but an Orb credential verified | #113: relabelled to 「レベル2:マイナンバーカード・パスポート・World ID(Orb)」 / "Level 2: My Number Card, passport or World ID (Orb)", and the badge shows which credential verified |

**Attempt caps:** the one-verification-per-person limit per action is enforced by World (nullifier per
action) and by our HumanRegistry (`NullifierAlreadyBound` / `WalletAlreadyBound`). There's no separate
attempt counter in the app. Cancelled attempts cost nothing.

## Missing docs / API friction

- **Returning from World App to an in-app browser:** in LINE's in-app browser (LIFF), coming back from
  World App reloads the page. Anything that relies on the client receiving the verify response is fragile.
  The docs' IDKit examples assume the page survives. A note recommending server-side completion (or
  session-based polling) for embedded browsers would have saved us the 499 debugging.
- **`any(mnc(), passport(), proofOfHuman())`:** this does exactly what it says, which surprised us from a
  product-copy point of view. An action labelled for My Number Card will accept an Orb credential. That's
  correct behaviour, but integrators need to label the level by assurance, not by document.
- **NFC credential constraint:** not hit in testing (no MNC or passport on the tester's device). We only
  combine NFC credentials with `any()`, never `all()`, as the docs require.
- **v4 migration:** stale v2/v3 examples online are a real trap. Pinning `^4.x` and following the official
  skill avoided it.

## One improvement

For **embedded browsers (LINE LIFF, Telegram, WeChat)**: let the RP's backend receive the completed proof
directly (a webhook, or a server-side poll keyed on the request), so the client page reloading mid-flow
doesn't matter. We effectively built that ourselves in #101.

## Verdict

- [x] `Upgraded` observed on Sepolia for a real tester, with **schema 1** (Orb / Proof of Human)
- [x] My Number Card (schema 9310) specifically wasn't run, because the tester holds no MNC. The level-2
      action accepts it, and the flow is identical. The remaining step is for a tester with an
      MNC-enrolled World App to repeat the upgrade.
