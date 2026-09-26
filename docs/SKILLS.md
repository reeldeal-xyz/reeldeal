# Official agent skills and docs, by area

Use the vendor's official skill wherever one exists. Where a vendor ships none, load its official LLM docs file into the agent instead. Install skills with `scripts/install-skills.sh` (pinned in `skills-lock.json`).

| Area | Official skill (in `.claude/skills/`) | Official docs for agents |
|---|---|---|
| Solidity security, setup, OpenZeppelin usage | `develop-secure-contracts`, `setup-solidity-contracts`, `upgrade-solidity-contracts` (OpenZeppelin/openzeppelin-skills) | docs.openzeppelin.com |
| Foundry | none published | https://getfoundry.sh/llms.txt |
| World ID / IDKit | `world-id` (docs.world.org/world-id/SKILL.md, verbatim) and the `world-id-sandbox` plugin (worldcoin/world-id-agent-plugin) | https://docs.world.org/llms.txt |
| ENSv2 | none published | https://docs.ens.domains/llms-full.txt |
| viem | none published | https://viem.sh/llms.txt |
| React / Next.js web app | `vercel-react-best-practices` (vercel-labs/agent-skills) | nextjs.org/docs |
| Deploy (live demo link) | `deploy-to-vercel` (vercel-labs/agent-skills) | vercel.com/docs |
| LINE LIFF, Login, Messaging API | none published | https://developers.line.biz/llms.txt |
| JPYC | none published | `@jpyc/sdk-core` README (github.com/jcam1/sdks), faucet.jpyc.co.jp |
| Curvegrid MultiBaas | none published | docs.curvegrid.com |
| NASA MUR SST / ERDDAP | none | coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.html |
