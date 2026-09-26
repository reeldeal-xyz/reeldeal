# Repository map

```sh
bun install --frozen-lockfile
bun run dog:map
bun run dog:query ReliefPool
bun run dog:trace file:contracts/src/ReliefPool.sol
bun run dog:test
```

Run from the repository root. Stage new files before mapping; the inventory uses
`git ls-files` and reads current working-tree bytes. Refresh after changing code
or switching branches. `coverage.json` records the commit, dirty state, exclusions,
file hashes, and unresolved imports. Generated files stay local in `.doghouse/`.

The map covers tracked contracts, interfaces, Solidity tests/deployment scripts,
deployment records, pipeline, shared types/ABIs, UI, scripts, config, and docs.
It includes new Python, Astro, app-core, and deployment files when they land.
Dependencies, vendored contracts, runtime stores, secrets, build outputs, and
symlinks are excluded. Files are mapped, not executed; no RPC or provider calls
are made.

Dotdog 0.9.0 classifies only selected file types and scans at most 500 files.
`scripts/dog-map.ts` runs it on a filtered temporary snapshot, adds every remaining
included file, and links static relative/workspace-package import declarations.
Those links are heuristic, not a Solidity call graph or type checker. Aliases,
Foundry remappings, external dependencies, dynamic imports, and Python imports
can remain unresolved. Check `coverage.json`; absence of a link is not proof that
systems are unrelated. Generated graph quality is not an implementation score.

Observed files belong in the generated graph. Planned Astro/FastAPI/Postgres
systems remain in [#54](https://github.com/ss251/reeldeal/issues/54) and
[#82](https://github.com/ss251/reeldeal/issues/82); HMI work is
[#32](https://github.com/ss251/reeldeal/issues/32). Current `web/` is mapped as
existing code, not a recommendation to build more Next.js. Do not add absent
systems to the observed graph.

If authored `.dog` specs are added, keep them separate from generated inventory.
Use `bunx --no-install dotdog parse <file>` to inspect them and
`bunx --no-install dotdog validate <spec-dir>` / `compile <spec-dir>` for a spec
project. This repository currently uses the observed repo graph, not a generated
template spec pretending to describe completed features.
