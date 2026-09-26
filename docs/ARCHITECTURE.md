# Architecture

This describes the current source architecture. The [ADRs](adrs/README.md) record
the Astro/FastAPI/Postgres target, open compatibility decisions, and the code/issue
evidence behind each choice. A target decision does not imply a completed migration.

Donor-funded relief fund for aquaculture farmers across coastal Japan (demo: Kesennuma / Karakuwa). Pays JPYC on Sepolia to the owner of a plot's season slot on ENSv2 when a public ocean risk index crosses a species threshold. Farmers use a LINE LIFF app; World ID caps payouts per real person.

```
JAXA Earth API (SST, chl-a)      ─┐              ┌─ heat  (climate change) ─┐
Copernicus (physics, waves)      ─┼─> pipeline ──┼─ hab   (algal blooms)   ─┼─> index values + sha256 ─┐
JMA tide/track, 貝毒/赤潮 bulletins ─┘  (Jay,      └─ storm (surge, waves)    ─┘   (FastAPI, :8787)       │
                                       national)                                                          v
                                            keeper (app): RULES thresholds ─> signed Trigger ─> ReliefPool
ENSv2 Sepolia: karakuwa.<parent>.eth ─> p1213-017 ─> 2026 slot ─> ReliefPool (JPYC) ─> farmer wallet (LIFF)
World ID (IDKit 4.3) ─> server verify ─> HumanRegistry (level 1 Selfie Check, level 2 My Number Card/passport/Orb)
MultiBaas (Curvegrid) indexes events ─> webhook ─> LINE Messaging API push
```

| Layer | Choice |
|---|---|
| Chain | Ethereum Sepolia (chainId 11155111) |
| Money | JPYC `0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29`, 18 decimals, faucet faucet.jpyc.co.jp |
| Names | ENSv2 Sepolia: `umi.eth` parent, `karakuwa` branch registry/resolver, 15 per-plot registries, expiring (2027-03-31) non-transferable "2026" season slots — see `docs/INTERFACE.md`'s ENS layout section |
| Identity | World IDKit 4.3: `selfieCheck` (level 1, 3 units), `mnc` / `passport` / `proofOfHuman` (level 2, 12 units), verified server-side |
| Risk data | `pipeline/` (Python 3.12, FastAPI, xarray; AWS for storage and training). National coverage, three hazard modules, index values only. Spec: `pipeline/README.md` |
| Payout rules | `packages/shared/src/rules.ts` + ReliefPool: thresholds, tiers and windows live app-side and on chain, never in the pipeline |
| Farmer UI | LINE LIFF + LINE Login; Messaging API push on Paid / Held |
| Indexing | Curvegrid MultiBaas webhooks |
| Prizes | ENS Best Use of ENSv2, World Best Use of IDKit, Curvegrid Best RWA Tokenization |

Tier amounts (demo, admin-settable): scallop tier 1 ¥20,000/unit, tier 2 +¥30,000; hoya tier 1 ¥20,000; toxin ¥10,000. Pro-rata fixed at attestation.
