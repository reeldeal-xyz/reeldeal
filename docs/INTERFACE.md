# Interface contract: pipeline (Jay) ↔ app (Sailesh)

Frozen at kickoff. Change it only by PR touching `packages/shared/src/feed.ts` + this file, reviewed by both owners.
Types and zod schemas live in `@umi/shared` (`packages/shared/src`). Everything below is validated with those schemas.

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
- EIP-712 domain: `{ name: "UmiRelief", version: "1", chainId: 11155111, verifyingContract: ReliefPool }`.
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
