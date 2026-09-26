import { JPYC_DECIMALS, jpycFromBaseUnits } from '../../../lib/format-amount';

/** Local presentation state only. No wallet, RPC, persistence or shared API contract. */
export type DonorPhase = 'editing' | 'review' | 'pending' | 'approved' | 'confirmed' | 'cancelled' | 'rejected' | 'failed' | 'unavailable';
export type DonorOperation = 'approval' | 'donation';
export type ActivityStatus = 'review' | 'pending' | 'confirmed' | 'cancelled' | 'rejected' | 'failed' | 'unavailable';
export interface DonationSnapshot { baseUnits: string; amount: string; memo: string }
export interface DonorActivity extends DonationSnapshot { id: number; operation: DonorOperation; status: ActivityStatus }
export interface DonorLedgerEntry {
  id: string;
  event: 'Donated' | 'Paid' | 'Held' | 'Claimed' | 'Swept';
  amountBaseUnits: string | null;
  description: string;
  recorded: string;
}
export interface DonorFixture {
  connection: 'connected' | 'disconnected' | 'wrong-network';
  poolConfigured: boolean;
  readState: 'ready' | 'loading' | 'unavailable';
  balanceBaseUnits: string | null;
  allowanceBaseUnits: string | null;
  amount: string;
  memo: string;
  phase?: DonorPhase;
  operation?: DonorOperation;
  ledgerState: 'ready' | 'loading' | 'unavailable';
  ledger: DonorLedgerEntry[];
}
export interface DonorState {
  amount: string;
  memo: string;
  phase: DonorPhase;
  operation: DonorOperation | null;
  allowanceBaseUnits: string | null;
  balanceBaseUnits: string | null;
  snapshot: DonationSnapshot | null;
  activity: DonorActivity[];
  error: string | null;
}

export function parseDonationAmount(input: string): { ok: true; baseUnits: string; amount: string } | { ok: false; error: string } {
  const value = input.trim();
  if (!value) return { ok: false, error: 'Enter an amount in JPYC.' };
  if (!/^\d+(?:\.\d{1,18})?$/.test(value)) return { ok: false, error: 'Use digits and up to 18 decimal places. Do not use commas, signs or exponent notation.' };
  const [whole, fraction = ''] = value.split('.');
  if (whole.length > 78) return { ok: false, error: 'This amount exceeds the JPYC transaction limit.' };
  const units = BigInt(whole) * 10n ** BigInt(JPYC_DECIMALS) + BigInt(fraction.padEnd(JPYC_DECIMALS, '0'));
  if (units <= 0n) return { ok: false, error: 'Enter an amount greater than zero.' };
  if (units > 2n ** 256n - 1n) return { ok: false, error: 'This amount exceeds the JPYC transaction limit.' };
  return { ok: true, baseUnits: units.toString(), amount: jpycFromBaseUnits(units)! };
}

function readUnits(value: string | null): bigint | null {
  return value !== null && /^\d+$/.test(value) ? BigInt(value) : null;
}

export function donorBlocker(state: DonorState, fixture: DonorFixture): string | null {
  if (!fixture.poolConfigured) return 'Relief pool setup is unavailable. No donation can be prepared.';
  if (fixture.connection === 'disconnected') return 'No sample wallet is connected. No approval or donation can be prepared.';
  if (fixture.connection === 'wrong-network') return 'The sample wallet is on a different network. This example requires Sepolia.';
  if (fixture.readState !== 'ready') return fixture.readState === 'loading' ? 'Loading sample balance and allowance…' : 'Balance and allowance are unavailable. They are not assumed to be zero.';
  if (readUnits(state.balanceBaseUnits) === null) return 'The sample balance is unavailable. An amount cannot be checked yet.';
  if (readUnits(state.allowanceBaseUnits) === null) return 'The sample allowance is unavailable. Approval requirements cannot be determined.';
  return null;
}

export function createDonorState(fixture: DonorFixture): DonorState {
  const parsed = parseDonationAmount(fixture.amount);
  const phase = fixture.phase ?? 'editing';
  const operation = phase === 'editing' ? null : fixture.operation ?? (phase === 'approved' ? 'approval' : 'donation');
  const snapshot = parsed.ok && phase !== 'editing' ? { baseUnits: parsed.baseUnits, amount: parsed.amount, memo: fixture.memo } : null;
  const status = phase === 'approved' ? 'confirmed' : phase;
  return {
    amount: fixture.amount, memo: fixture.memo, phase, operation,
    balanceBaseUnits: fixture.balanceBaseUnits,
    allowanceBaseUnits: phase === 'approved' && snapshot ? snapshot.baseUnits : fixture.allowanceBaseUnits,
    snapshot, error: null,
    activity: operation && snapshot && status !== 'editing'
      ? [{ id: 1, operation, status, ...snapshot }] : [],
  };
}

export type DonorAction =
  | { type: 'amount'; value: string }
  | { type: 'memo'; value: string }
  | { type: 'review' | 'submit' | 'confirm' | 'fail' | 'cancel' | 'reject' | 'edit' | 'unavailable' | 'restore' };

/** Deliberate, synchronous demo transitions. Confirmation is never inferred from submission. */
export function transitionDonor(state: DonorState, action: DonorAction, fixture: DonorFixture): DonorState {
  if (action.type === 'amount' || action.type === 'memo') {
    if (['review', 'pending', 'confirmed', 'unavailable'].includes(state.phase)) return state;
    return { ...state, [action.type]: action.value, phase: 'editing', snapshot: null, error: null };
  }
  if (action.type === 'edit') {
    if (['review', 'pending', 'unavailable'].includes(state.phase)) return state;
    return { ...state, phase: 'editing', snapshot: null, operation: null, error: null };
  }
  if (action.type === 'review') {
    if (!['editing', 'approved', 'cancelled', 'rejected', 'failed'].includes(state.phase)) return state;
    const blocked = donorBlocker(state, fixture);
    if (blocked) return { ...state, error: blocked };
    const parsed = parseDonationAmount(state.amount);
    if (!parsed.ok) return { ...state, error: parsed.error };
    if (state.memo.length > 140) return { ...state, error: 'Keep the memo to 140 characters.' };
    if (BigInt(parsed.baseUnits) > readUnits(state.balanceBaseUnits)!) return { ...state, error: 'The amount exceeds the sample wallet balance.' };
    const operation = readUnits(state.allowanceBaseUnits)! < BigInt(parsed.baseUnits) ? 'approval' : 'donation';
    const snapshot = { baseUnits: parsed.baseUnits, amount: parsed.amount, memo: state.memo };
    const id = (state.activity.at(-1)?.id ?? 0) + 1;
    return { ...state, phase: 'review', operation, snapshot, error: null, activity: [...state.activity, { id, operation, status: 'review', ...snapshot }] };
  }
  if (!state.snapshot || !state.operation) return state;
  const last = state.activity.at(-1);
  const update = (status: ActivityStatus, phase: DonorPhase = status) => ({ ...state, phase, activity: state.activity.map(item => item.id === last?.id ? { ...item, status } : item), error: null });
  if (state.phase === 'review') {
    if (action.type === 'cancel') return update('cancelled');
    if (action.type === 'reject') return update('rejected');
    if (action.type === 'submit') return update('pending');
  }
  if (state.phase === 'pending') {
    if (action.type === 'unavailable') return update('unavailable');
    if (action.type === 'fail') return update('failed');
    if (action.type === 'confirm') {
      if (state.operation === 'approval') return { ...update('confirmed', 'approved'), allowanceBaseUnits: state.snapshot.baseUnits };
      const amount = BigInt(state.snapshot.baseUnits);
      const balance = readUnits(state.balanceBaseUnits);
      const allowance = readUnits(state.allowanceBaseUnits);
      if (balance === null || allowance === null || amount > balance || amount > allowance) return { ...state, error: 'Sample balance or allowance cannot support this confirmation.' };
      return { ...update('confirmed'), balanceBaseUnits: (balance - amount).toString(), allowanceBaseUnits: (allowance - amount).toString() };
    }
  }
  if (state.phase === 'unavailable' && action.type === 'restore') return update('pending');
  return state;
}
