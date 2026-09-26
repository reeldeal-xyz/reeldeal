import { describe, expect, test } from 'bun:test';
import { donorPreviews } from '../src/fixtures/donor-preview';
import { createDonorState, parseDonationAmount, transitionDonor, type DonorAction, type DonorFixture, type DonorState } from '../src/components/organisms/donor/model';

const confirmedDonations = (state: DonorState) => state.activity.filter(item => item.operation === 'donation' && item.status === 'confirmed');
function run(fixture: DonorFixture, actions: DonorAction[], initial = createDonorState(fixture)) {
  return actions.reduce((state, action) => transitionDonor(state, action, fixture), initial);
}
const confirmSteps: DonorAction[] = [{ type: 'review' }, { type: 'submit' }, { type: 'confirm' }];

describe('local donor amounts', () => {
  test('preserves 18 decimals and amounts beyond safe integer precision', () => {
    expect(parseDonationAmount('0.000000000000000001')).toEqual({ ok: true, baseUnits: '1', amount: '0.000000000000000001' });
    expect(parseDonationAmount('20000')).toEqual({ ok: true, baseUnits: '20000000000000000000000', amount: '20000' });
    expect(parseDonationAmount('9007199254740993.000000000000000001')).toEqual({ ok: true, baseUnits: '9007199254740993000000000000000001', amount: '9007199254740993.000000000000000001' });
    expect(parseDonationAmount(' 001.2500 ')).toEqual({ ok: true, baseUnits: '1250000000000000000', amount: '1.25' });
  });
  test('refuses rounded, ambiguous, zero, negative and overflowing amounts', () => {
    for (const value of ['', ' ', '0', '0.000', '-1', '+1', '1,000', '1e3', 'NaN', '.5', '1.', '1.0000000000000000001', '9'.repeat(79)]) {
      expect(parseDonationAmount(value).ok).toBe(false);
    }
  });
});

describe('local donor approval and receipt states', () => {
  test('approval never creates a donation; only the separately confirmed donation changes balances once', () => {
    const fixture = donorPreviews.ready;
    const approved = run(fixture, confirmSteps);
    expect(approved.phase).toBe('approved');
    expect(approved.balanceBaseUnits).toBe(fixture.balanceBaseUnits);
    expect(approved.allowanceBaseUnits).toBe('20000000000000000000000');
    expect(confirmedDonations(approved)).toHaveLength(0);
    const pending = run(fixture, [{ type: 'review' }, { type: 'submit' }], approved);
    expect(pending.operation).toBe('donation');
    expect(confirmedDonations(pending)).toHaveLength(0);
    expect(transitionDonor(pending, { type: 'amount', value: '1' }, fixture)).toBe(pending);
    expect(transitionDonor(pending, { type: 'review' }, fixture)).toBe(pending);
    const confirmed = transitionDonor(pending, { type: 'confirm' }, fixture);
    expect(confirmed.phase).toBe('confirmed');
    expect(confirmed.balanceBaseUnits).toBe('30000000000000000000000');
    expect(confirmed.allowanceBaseUnits).toBe('0');
    expect(confirmedDonations(confirmed)).toHaveLength(1);
    expect(confirmed.activity).toHaveLength(2);
    expect(transitionDonor(confirmed, { type: 'confirm' }, fixture)).toBe(confirmed);
  });
  test('editing above confirmed allowance requires a fresh approval', () => {
    const fixture = donorPreviews.ready;
    const approved = run(fixture, confirmSteps);
    const revised = run(fixture, [{ type: 'amount', value: '30000' }, { type: 'review' }], approved);
    expect(revised.operation).toBe('approval');
    expect(revised.snapshot?.baseUnits).toBe('30000000000000000000000');
    expect(confirmedDonations(revised)).toHaveLength(0);
  });
  test('cancelled, rejected and failed donations do not produce receipts or debit balances', () => {
    const fixture = donorPreviews.donationReview;
    for (const actions of [[{ type: 'cancel' }], [{ type: 'reject' }], [{ type: 'submit' }, { type: 'fail' }]] as DonorAction[][]) {
      const stopped = run(fixture, actions);
      expect(confirmedDonations(stopped)).toHaveLength(0);
      expect(stopped.balanceBaseUnits).toBe(fixture.balanceBaseUnits);
      expect(stopped.allowanceBaseUnits).toBe(fixture.allowanceBaseUnits);
      expect(transitionDonor(stopped, { type: 'confirm' }, fixture)).toBe(stopped);
    }
  });
  test('unknown setup, identity context and reads block preparation without treating unknown as zero', () => {
    for (const fixture of [donorPreviews.disconnected, donorPreviews.wrongNetwork, donorPreviews.missingSetup, donorPreviews.loading, donorPreviews.unavailable, donorPreviews.allowanceUnavailable]) {
      const result = run(fixture, [{ type: 'review' }]);
      expect(result.error).not.toBeNull();
      expect(result.activity).toHaveLength(0);
      expect(result.phase).toBe('editing');
    }
  });
  test('balance comparison is exact down to one base unit and memo limit is enforced', () => {
    const fixture = { ...donorPreviews.ready, amount: '0.000000000000000002', balanceBaseUnits: '1' };
    expect(run(fixture, [{ type: 'review' }]).error).toContain('exceeds');
    const tooLong = { ...donorPreviews.ready, memo: 'x'.repeat(141) };
    expect(run(tooLong, [{ type: 'review' }]).error).toContain('140');
  });
  test('unavailable confirmation locks the attempt until the same pending status is restored', () => {
    const fixture = donorPreviews.donationPending;
    const unknown = run(fixture, [{ type: 'unavailable' }]);
    expect(unknown.phase).toBe('unavailable');
    expect(confirmedDonations(unknown)).toHaveLength(0);
    for (const action of [{ type: 'review' }, { type: 'edit' }, { type: 'confirm' }] as DonorAction[]) expect(transitionDonor(unknown, action, fixture)).toBe(unknown);
    const resolved = run(fixture, [{ type: 'restore' }, { type: 'confirm' }], unknown);
    expect(resolved.activity).toHaveLength(1);
    expect(confirmedDonations(resolved)).toHaveLength(1);
  });
});
