# eth-global-tokyo: agent notes

- bun workspaces; Foundry in `contracts/`. Run `bun run contracts:test` and `bun run typecheck` before committing.
- The interface contract is `packages/shared` + `docs/INTERFACE.md`. Don't change Trigger fields or feed shapes without updating both sides and the Solidity struct.
- JPYC has 18 decimals. ¥20,000 = `20000e18`. Never assume 6.
- ENSv2 Sepolia redeploys monthly; addresses live only in `packages/shared/src/addresses.ts`.
- World ID proofs verify server-side at developer.world.org/api/v4/verify; accepted schemas: 1, 9303, 9310, 11.
- No personal data on-chain: plot codes, zone, species, wallets, nullifiers only.
- Conventional, small commits. Work on the issue's branch or main with the issue number in the message.
