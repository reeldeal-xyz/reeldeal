# Architecture

Donor-funded relief fund for Kesennuma aquaculture farmers. Pays JPYC on Sepolia to the owner of a plot's season slot on ENSv2 when public ocean data crosses a species threshold. Farmers use a LINE LIFF app; World ID caps payouts per real person.

```
NASA MUR SST (ERDDAP) ─┐
Futatsune buoy CSV     ─┼─> pipeline (Jay) ─> signed Trigger ─┐
Toxin bans (transcribed)┘                                     v
ENSv2 Sepolia: karakuwa.umi.eth ─> p1213-NNN ─> 2026 slot ─> ReliefPool (JPYC) ─> farmer wallet (LIFF)
World ID (IDKit 4.3) ─> server verify ─> HumanRegistry (level 1 Selfie Check, level 2 My Number Card/passport/Orb)
MultiBaas (Curvegrid) indexes events ─> webhook ─> LINE Messaging API push
```

| Layer | Choice |
|---|---|
| Chain | Ethereum Sepolia (chainId 11155111) |
| Money | JPYC `0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29`, 18 decimals, faucet faucet.jpyc.co.jp |
| Names | ENSv2 Sepolia: `umi.eth` parent, `karakuwa` branch registry/resolver, 15 per-plot registries, expiring (2027-03-31) non-transferable "2026" season slots — see `docs/INTERFACE.md`'s ENS layout section |
| Identity | World IDKit 4.3: `selfieCheck` (level 1, 3 units), `mnc` / `passport` / `proofOfHuman` (level 2, 12 units), verified server-side |
| Farmer UI | LINE LIFF + LINE Login; Messaging API push on Paid / Held |
| Indexing | Curvegrid MultiBaas webhooks |
| Prizes | ENS Best Use of ENSv2, World Best Use of IDKit, Curvegrid Best RWA Tokenization |

Tier amounts (demo, admin-settable): scallop tier 1 ¥20,000/unit, tier 2 +¥30,000; hoya tier 1 ¥20,000; toxin ¥10,000. Pro-rata fixed at attestation.
