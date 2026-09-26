# World ID level 2 debrief (issue #25)

Fill this in after the live My Number Card run. Goal per #25: "Show the card farmers already
carry as the strong credential." Done when `Upgraded` lands on Sepolia with schema 9310, or this
debrief says why not.

## Run

- Date / location:
- Tester (World App account, not personal identity):
- Device (phone model, World App version):
- Credential attempted: My Number Card (schema 9310) / passport (9303) / Orb Proof of Human (1) — circle one
- Wallet address bound:
- On-chain result: `Upgraded` tx hash / failure reason:

## Timing

- Time from opening the verify flow to World App opening:
- Time from World App opening to proof completion (MNC scan, passport NFC read, etc.):
- Time from proof completion to `Upgraded` on Sepolia:
- Total time to first success:

## Friction log

Pull outcomes from server logs (`scope:"world-id"` JSON lines from `web/src/lib/world/log.ts`,
outcome one of `success | cancelled | rejected | duplicate | error`). For each non-success
attempt during the session, note:

| # | outcome | reason | what the tester saw | what we'd change |
|---|---------|--------|----------------------|-------------------|
|   |         |        |                      |                   |

Cap per #25: 3 attempts -> 12 (retries against the sybil/attempt cap, if one applies at the
app/action level — note whether the cap is app-side, World-side, or not enforced yet).

## Missing docs / API friction

- Anything in docs.world.org that was unclear, missing, or wrong for this flow:
- Anything about `any(mnc(), passport(), proofOfHuman())` constraint behavior that surprised us:
- NFC Credential constraint (a user can hold only one NFC credential at a time — MNC, passport,
  eID are alternatives, never combined with `all()`): did this show up in testing?

## One improvement

The single highest-leverage change for the next integrator (SDK, docs, or our own code):

## Verdict

- [ ] `Upgraded` observed on Sepolia with schema 9310 (or 9303/1) for a real tester
- [ ] Debrief explains why not, if it didn't happen
