# eth-global-tokyo

Donor-funded relief for Kesennuma shellfish farmers: when the sea stays too hot or toxin bans hit, JPYC is paid on Sepolia to whoever farms each plot this season, recorded as ENSv2 names, with World ID capping payouts per real person and a LINE app for farmers.

- `contracts/` Foundry: `ReliefPool`, `HumanRegistry`
- `web/` Next.js: donor, co-op, holder screens, `/liff` farmer app, `/verify/[eventId]`, API routes
- `pipeline/` Bun: ocean data ingestion, indices, trigger signing, feed server (owner: Jay)
- `packages/shared/` Types, zod schemas, rules, addresses: the interface contract
- `docs/INTERFACE.md` Pipeline ↔ app contract. `docs/ARCHITECTURE.md` stack.

## Setup

```sh
git clone --recurse-submodules <repo> && cd eth-global-tokyo
cp .env.example .env
bun install
bun run contracts:build && bun run contracts:test
bun run typecheck
bun run pipeline   # feed on :8787
bun run dev        # web on :3000
```

Built at ETHGlobal Tokyo 2026 (Classic track), from 21:00 JST Friday 25 Sep.
