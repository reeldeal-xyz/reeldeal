// Wallet/plot -> LINE userId lookup (issue #23, blocked on #15 "World ID bind" and #17 "keeper").
//
// The ReliefPool `Paid` event carries the farmer's payout wallet; `Held` carries only the plotLabel (see
// IReliefPool.Held). Neither carries a LINE userId directly, so the webhook needs this directory to turn
// on-chain identifiers into a push target.
//
// TODO(#15): HumanRegistry.bind() receipts (World ID verification) are the natural source for
// wallet -> nullifier -> LINE userId once that binding step also records the LINE userId (LIFF login,
// issue #13/#14). TODO(#17): the keeper already knows plotLabel -> farmer wallet from `enroll`/replay
// bookkeeping and could maintain the plotLabel -> wallet half of this mapping. Until one of those lands,
// both methods return null and the webhook logs a warning instead of pushing.
export interface PayoutDirectory {
  lineUserIdForWallet(wallet: string): Promise<string | null>;
  lineUserIdForPlot(plotLabel: string): Promise<string | null>;
}

export const payoutDirectory: PayoutDirectory = {
  async lineUserIdForWallet(_wallet: string): Promise<string | null> {
    // TODO(#15): look up via HumanRegistry bind() receipts / LIFF login session once that mapping exists.
    return null;
  },
  async lineUserIdForPlot(_plotLabel: string): Promise<string | null> {
    // TODO(#17): look up via the keeper's plotLabel -> farmer wallet bookkeeping, then delegate to
    // lineUserIdForWallet.
    return null;
  },
};
