# Interface contract: pipeline (Jay) ↔ app (Sailesh)

Frozen at kickoff. Change it only by PR touching `packages/shared/src/feed.ts` + this file, reviewed by both owners.
Types and zod schemas live in `@repo/shared` (`packages/shared/src`). Everything below is validated with those schemas.

## Identifiers

| Kind | Labels | On-chain |
|---|---|---|
| Zone | `karakuwa-east`, `kesennuma-bay` | `keccak256(label)` |
| Species | `scallop`, `hoya`, `oyster` | `keccak256(label)` |
| Peril | `HEAT24`, `HEAT25`, `HEAT26`, `BANWEEKS` | `keccak256(label)` |
| Season | `"2026"` (fiscal year, 1 Apr to 31 Mar) | string |
| Event | `eventIdOf(zone, species, peril, tier, season)` | `keccak256(abi.encode(...))` |

## Files (pipeline writes to `pipeline/out/`)

| File | Schema | Content |
|---|---|---|
| `series-<zone>-<season>.json` | `SeriesFile` | Daily SST at the zone's reference point, with source URL and sha256 of the pinned CSV |
| `indices-<zone>-<season>.json` | `IndicesFile` | Per day: cumulative `heat24/25/26` inside the rule window, `banWeeks` per species |
| `triggers-<zone>-<season>.json` | `TriggersFile` | Every rule that fired: label, fire date, the `Trigger` struct (bigints as strings) and signatures |
| `buoy-<YYYY-MM>.json` | `BuoyFile` | Futatsune buoy readings for the month, and the offset versus satellite |

Seasons for the replay: `2022`, `2023`, `2024`, `2025` (July to September data), all paying the `"2026"` season slots.

## ENS layout (issues #7/#10/#11)

Parent name is **`umi.eth`** (checked available on ENSv2 Sepolia 2026-09-26 via
`ETHRegistrar.isAvailable("umi")`; `getRegisterPrice` returned base+premium 640000005 — MockUSDC has 6
decimals, so ~640.000005 MockUSDC, a free-mint testnet token, so real cost is zero). Override via env
`PARENT_LABEL` if it's ever re-registered under a different label.

```
umi.eth                                          <- parent, ETHRegistrar (commit/reveal, MockUSDC)
  karakuwa.umi.eth                               <- branch: UserRegistry + PermissionedResolver (issue #7)
    p1213-NNN.karakuwa.umi.eth (x15)             <- plot: owned by the licence holder, roleBitmap 0,
    │                                                registry = a dedicated per-plot UserRegistry,
    │                                                resolver = the shared karakuwa branch resolver
    └── "2026" (season slot)                     <- owned by the farmer, roleBitmap 0, expiry
                                                     2027-03-31T23:59:59Z, registered on the plot's own
                                                     per-plot registry (not on karakuwa's)
```

15 plots (`docs/ARCHITECTURE.md`'s "p1213-017" was illustrative; the deployed set is
`p1213-001`..`p1213-015`), zone `karakuwa-east` for all, species per issue #16's counts:

| Plots | Species |
|---|---|
| `p1213-001`..`p1213-008` (8) | scallop |
| `p1213-009`..`p1213-012` (4) | hoya |
| `p1213-013`..`p1213-015` (3) | oyster |

Text records on the karakuwa branch resolver, keyed by each plot's full DNS-encoded name (one resolver
instance holds records for every plot — `PermissionedResolver` keys records by name/node, and role scoping
for `setText` is by key only, not by name): `zone`, `species` (science key, scoped by issue #7's
`grantSetterRoles` — that grant already covers every plot, not just karakuwa itself), `area`, `unit`
(deployer/admin only).

**Roles** (`RegistryRolesLib`/`PermissionedResolverLib`, ensdomains/contracts-v2 @
`71a3b7339dbc55ab47667abdfe8303bac4f4c24e`):
- Plot's licence holder holds `ROLE_REGISTRAR | ROLE_UNREGISTER | ROLE_RENEW` (plain bits, no `_ADMIN`
  variants) on `ROOT_RESOURCE` of **their own plot's registry** — enough to `register`/`unregister`/`renew`
  a season slot directly, never to re-delegate those rights.
- Season slots are issued with `roleBitmap 0`: the farmer never holds `ROLE_CAN_TRANSFER_ADMIN`, so any
  transfer of the slot token reverts (`TransferDisallowed`, or `TransferUnsafeUntilRegistryIsEmancipated` for
  the standard `safeTransferFrom` path — the plot registry is never "emancipated" while the holder keeps
  `ROLE_UNREGISTER` at root). Non-transferable by construction, not convention.
- Expiring: ENSv2's own per-registration `expiry`. `findOwner`/`getSubregistry`/`getResolver` all zero out
  once elapsed; `EnsSlotResolver` (issue #11) reads `getState(labelhash).latestOwner`/`.expiry` instead of
  `findOwner`, specifically so an *expired* slot (`REASON_PLOT_EXPIRED`) stays distinguishable from a
  *never-assigned* one (`REASON_NO_FARMER`) — `findOwner` alone collapses both to zero.

**For issues #19/#20** (holder/co-op screens) — the functions and where their ABIs come from:
- Issue slot: `IUserRegistryWrite.register(label, farmer, address(0), address(0), 0, expiry)` on the plot's
  own per-plot registry (`karakuwaRegistry.getSubregistry(plotLabel)` finds it). Same shape as
  `contracts/script/ens/EnsV2.sol`'s `IUserRegistryWrite` — no new ABI needed, that interface already has
  `register`.
- Revoke: `IUserRegistryWrite.unregister(anyId)` on the plot registry, `anyId = uint256(keccak256(bytes(label)))`
  (a labelhash — see `contracts/script/ens/EnsV2.sol`'s doc comment on `anyId`).
- Science key edits `zone`/`species`: `IPermissionedResolverWrite.setText(dnsEncodedName, "zone"|"species", value)`
  on the karakuwa branch resolver (`karakuwaRegistry.getResolver(plotLabel)`), denied for any other key.
- Reads for the co-op table: `ReliefPool.payoutTarget(plotLabel, "2026")` (farmer, plot registry, expiry) and
  `EnsPlotResolver`/branch resolver `resolve(dnsEncodedName, text(...))` for zone/species/area/unit — see
  `contracts/src/adapters/EnsPlotResolver.sol` / `EnsSlotResolver.sol`.
- All of the above interfaces live in `contracts/script/ens/EnsV2.sol` (write side) and
  `contracts/src/interfaces/IEnsV2.sol` (read side); there is no separate ABI export for them yet (no
  TypeScript consumer needed one before #19/#20) — `bun run abi` only exports `ReliefPool`/`HumanRegistry`
  (`packages/shared/src/abi/`), which are unchanged.

## HTTP (pipeline `bun run pipeline`, default `http://localhost:8787`, env `PIPELINE_FEED_URL`)

```
GET /health
GET /series/:zone/:season
GET /indices/:zone/:season
GET /triggers/:zone/:season
GET /buoy/:month
```

Same JSON as the files. CORS open. The web app may also import the files directly for the static demo.

## Trigger → chain

- `Trigger` fields and order: `packages/shared/src/trigger.ts` ⇔ `contracts/src/interfaces/IReliefPool.sol`.
- EIP-712 domain: `{ name: "ReliefPool", version: "1", chainId: 11155111, verifyingContract: ReliefPool }`.
- The pipeline signs with its key; the app's keeper adds the second signature and calls `attest`, then `settle`.
- `dataHash` = sha256 of the exact pinned CSV bytes the index was computed from.

## Rules and regression

`RULES` and `REFERENCE_FIRES` in `packages/shared/src/rules.ts`. The pipeline must reproduce `REFERENCE_FIRES` exactly at 38.85N 141.66E:

| Season | Fires |
|---|---|
| 2022 | none |
| 2023 | scallop tier 2 on 11 Aug, scallop tier 1 on 12 Aug, hoya on 25 Aug |
| 2024 | hoya on 15 Sep |
| 2025 | scallop tier 1 on 28 Aug, hoya on 1 Sep |
