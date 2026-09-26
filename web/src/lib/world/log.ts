// Structured logging for every World ID verification outcome, so #25's debrief (time to first
// success, friction points, rejected/cancelled/duplicate counts) can be reconstructed from logs
// without adding a database. One JSON line per outcome on stdout.
import type { WorldLevel } from './schema';

export type WorldOutcome = 'success' | 'cancelled' | 'rejected' | 'duplicate' | 'error';

export interface WorldOutcomeEvent {
  outcome: WorldOutcome;
  level: WorldLevel;
  wallet: string;
  /** Machine-readable reason: an IDKitErrorCode, a contract error name, or an internal code. */
  reason?: string;
  schemaId?: number;
  nullifier?: string;
  txHash?: string;
}

export function logWorldOutcome(event: WorldOutcomeEvent): void {
  const line = {
    at: new Date().toISOString(),
    scope: 'world-id',
    ...event,
  };
  // console.error for non-success so log-level filtering can separate friction from happy path,
  // while keeping every outcome in the same structured shape for the debrief.
  if (event.outcome === 'success') {
    console.log(JSON.stringify(line));
  } else {
    console.error(JSON.stringify(line));
  }
}
