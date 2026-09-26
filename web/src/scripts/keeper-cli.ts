#!/usr/bin/env bun
// CLI for the keeper (issue #17): bun run keeper -- --event <id> [--dry-run]
//
// Shares web/src/lib/keeper/run.ts with the Next route (app/api/keeper/replay/route.ts) -- same module,
// same defaults, same idempotency. Run `bun run keeper -- --list` to see known reference event ids.
import { REFERENCE_EVENTS } from '@/lib/keeper/reference-events';
import { runKeeper } from '@/lib/keeper/run';

function parseArgs(argv: string[]): { event?: string; dryRun: boolean; list: boolean } {
  let event: string | undefined;
  let dryRun = false;
  let list = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--event') {
      event = argv[++i];
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--list') {
      list = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
  }
  return { event, dryRun, list };
}

function printUsage(): void {
  console.log(`Usage: bun run keeper -- --event <id> [--dry-run]
       bun run keeper -- --list

Known reference events:
${REFERENCE_EVENTS.map((r) => `  ${r.id}  (${r.zone}/${r.species} tier ${r.tier}, fired ${r.firedOn})`).join('\n')}`);
}

async function main(): Promise<void> {
  const { event, dryRun, list } = parseArgs(process.argv.slice(2));

  if (list || !event) {
    printUsage();
    process.exit(list ? 0 : 1);
  }

  console.log(`[keeper-cli] running "${event}"${dryRun ? ' (--dry-run, no transactions will be sent)' : ''}`);
  const result = await runKeeper({ referenceEventId: event, dryRun });

  console.log(
    JSON.stringify(
      result,
      (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
      2,
    ),
  );

  const heldCount = result.plotOutcomes.filter((p) => p.status === 'Held').length;
  const paidCount = result.plotOutcomes.filter((p) => p.status === 'Paid').length;
  console.log(
    `[keeper-cli] done: eventId=${result.eventId} source=${result.triggerSource} attested=${!result.alreadyAttested} paid=${paidCount} held=${heldCount} settleTxs=${result.settleTxHashes.length}`,
  );
}

main().catch((err) => {
  console.error('[keeper-cli] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
