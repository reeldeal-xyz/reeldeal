# Architecture

This describes the current source architecture. The [ADRs](adrs/README.md) record
the Astro/FastAPI/Postgres target, open compatibility decisions, and the code/issue
evidence behind each choice. A target decision does not imply a completed migration.

Pipeline status after #84: `pipeline/` is a Python/FastAPI scaffold with stubbed
domain routes. The diagram's pipeline-to-signed-Trigger segment describes the
target risk-index handoff shape (schemas, `Trigger.tempC` and ReliefPool now
merged under #55); the Python service implementing it remains pending under
#64/#79.

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

## Database

PostgreSQL 16 + PostGIS 3.7 (Railway, interim; db/README.md §9 plans an EC2 move under #106). Spec:
db/README.md (issues #103-#110). ADR 0004 records the ownership principle (one writable schema owner,
consumers reference rather than copy); db/README.md is the current source of truth for schema/table
names.

| Schema | Owns | Tooling | Status |
|---|---|---|---|
| `geo` | Reference geometry: plots, sea areas (stations/coast/mask are #104, not yet built) | dbmate (`db/migrations/`) | Interim bootstrap only: `geo.plots` (15 synthetic points, `synthetic=true`) + `geo.sea_areas` (karakuwa-east, kesennuma-bay), no real MSIL polygons yet (D2) |
| `risk` | Pipeline time-series (indices, observations) | dbmate | Not built (#105) |
| `app` | `slot_requests`, `wallet_links`, `plot_wallets` | Drizzle (`web/drizzle/`) | Live; replaces the old JSON-file payout directory/slot-request store |

`app.plot_wallets.plot_id` is a real foreign key to `geo.plots.plot_code` (ADR 0004: app references
canonical geometry, never copies it) — added by hand in `web/drizzle/0000_exotic_magma.sql` since
Drizzle only owns/diffs `app` (see `web/drizzle.config.ts`'s `schemaFilter`).

Both `web/src/lib/payout-directory.ts` and `web/src/lib/slot-request-store.ts` use the database when
`DATABASE_URL` is set and fall back to the original JSON-file/in-memory store when it isn't (tests,
local dev without a DB) — same public function signatures either way.
`web/src/lib/plots.ts`'s new `getPlots()` reads `geo.plots` server-side under the same fallback; the
existing static `DEMO_PLOTS` constant is unchanged (client components still import it directly). ENS
stays the source of truth for season-slot ownership regardless of where the demo plot list comes from.

Migrate, in order (the `app` migration's FK needs `geo.plots` to already exist):

```sh
bun run db:migrate:geo              # dbmate-style geo bootstrap (interim seed in db/interim/, runner db/scripts/migrate.ts; Jay's #114 dbmate migrations in db/migrations/ supersede it)
bun run --filter web db:migrate     # drizzle-orm/bun-sql migrator, web/drizzle/
# or both, in order:
bun run db:migrate
```

`bun run --filter web db:generate` regenerates `web/drizzle/*.sql` from `web/src/db/schema.ts` after an
`app` schema change (re-apply the hand-added FK statement at the top of the new migration file if one
lands — see that file's header comment). `bun run db:cross-check-plots` reads `ReliefPool.plots(label)`
for the 15 demo labels (cheap `eth_call`s, no gas) as an informational check against `geo.plots`.
