#!/usr/bin/env bash
# Restores the official agent skills into .claude/skills (untracked). Run once after cloning.
set -euo pipefail
cd "$(dirname "$0")/.."
npx -y skills experimental_install -y || {
  npx -y skills add OpenZeppelin/openzeppelin-skills -s develop-secure-contracts -s setup-solidity-contracts -s upgrade-solidity-contracts -a claude-code -y --copy
  npx -y skills add vercel-labs/agent-skills -s vercel-react-best-practices -s deploy-to-vercel -a claude-code -y --copy --full-depth
}
mkdir -p .claude/skills/world-id
{
  printf -- '---\nname: world-id\ndescription: Official World ID integration skill (verbatim from https://docs.world.org/world-id/SKILL.md). Use for IDKit, Selfie Check, passport/My Number Card, Developer Portal setup, server-side proof verification and nullifiers.\n---\n\n'
  curl -fsSL https://docs.world.org/world-id/SKILL.md
} > .claude/skills/world-id/SKILL.md
echo "Skills installed. The World ID sandbox plugin is declared in .claude/settings.json (claude plugin install world-id-sandbox@world-id-demo)."
