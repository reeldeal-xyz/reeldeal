// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IReliefPool} from "./interfaces/IReliefPool.sol";
import {IHumanRegistry} from "./interfaces/IHumanRegistry.sol";
import {IPlotResolver} from "./interfaces/IPlotResolver.sol";
import {ISlotResolver} from "./interfaces/ISlotResolver.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Donor-funded relief pool paying JPYC (18 decimals; ¥20,000 = 20000e18) to the owner of a plot's
///         season slot on ENSv2 when a 2-of-3 (admin-configurable N-of-M) signed Trigger crosses a threshold.
///         Amounts are pro-rated across the plots enrolled for the trigger's zone/species at attestation time.
/// @dev Scope is "ReliefPool core" (donate, enroll/reindex, attest + the pro-rata reserve snapshot) plus
///      "settle, hold reasons, claimHeld, sweep" (issue #8): per-(event, plot) settlement ends in exactly one
///      of Paid, Held, Claimed or Swept, and per-level unit caps (`unitCap`, keyed by `HumanRegistry.levelOf`)
///      are enforced per nullifier per event via `unitsPaid`.
///
///      `payoutTarget`/`settle`/`claimHeld` resolve the season-slot owner through `ISlotResolver`, an
///      interface implemented by a mock in tests today; issue #11 ("ReliefPool reads ENS on-chain") plugs in
///      the real ENSv2 branch -> plot -> slot adapter behind that same interface without touching this
///      contract. See ISlotResolver.sol.
///
///      Reserve invariant: `reserved == pending + held` at all times — `reservedAmount` is added to `reserved`
///      at `attest`, and a plot's `perUnit` share leaves `reserved` the moment it is Paid (via `settle`),
///      Claimed (via `claimHeld`) or Swept (via `sweep`); only Held shares (and shares not yet settled at all,
///      i.e. "pending") remain counted in `reserved`.
///      Field order of Trigger MUST match packages/shared/src/trigger.ts (EIP-712 type) — see IReliefPool.sol.
contract ReliefPool is IReliefPool, AccessControl, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Errors beyond the ones IReliefPool already declares (inherited: AlreadyAttested, BadSignatures,
    // ThresholdNotMet, Expired).
    // ---------------------------------------------------------------------
    error ZeroAmount();
    error ZeroAddress();
    error UnknownPlot(string plotLabel);
    error PlotNotEnrolled(string plotLabel);
    error InvalidSignerConfig();
    error DuplicateSigner(address signer);
    error NoEligibleUnits(bytes32 zoneId, bytes32 speciesId);
    error TierAmountNotSet(bytes32 perilId, bytes32 speciesId, uint8 tier);
    error WindowNotElapsed(uint64 windowEnd, uint64 nowTs);
    error UnknownEvent(bytes32 eventId);
    error NotHeld(bytes32 eventId, string plotLabel);
    error ClaimWindowElapsed(uint64 claimDeadline, uint64 nowTs);
    error ClaimWindowActive(uint64 claimDeadline, uint64 nowTs);
    error StillIneligible(bytes32 eventId, string plotLabel, bytes32 reason);

    // ---------------------------------------------------------------------
    // Events beyond the ones IReliefPool already declares.
    // ---------------------------------------------------------------------
    event SignersUpdated(address[] signers, uint256 threshold);
    event TierAmountSet(bytes32 indexed perilId, bytes32 indexed speciesId, uint8 tier, uint256 amountPerUnit);
    event UnitCapSet(uint8 indexed level, uint32 cap);
    event ClaimWindowSet(uint64 window);

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------
    struct Plot {
        bytes32 zoneId;
        bytes32 speciesId;
        bool enrolled;
    }

    /// @dev Pro-rata snapshot taken at `attest`, consumed by `settle` (per-plot pay/hold) and by
    ///      `claimHeld`/`sweep` against `claimDeadline`. `zoneId`/`speciesId`/`seasonLabel` are copied from the
    ///      attested `Trigger` so `settle` can (a) detect a plot whose cached zone/species has since drifted
    ///      away from the event it's being settled against (`ZONE_MISMATCH`), and (b) query `ISlotResolver` for
    ///      the right season slot without needing the original `Trigger` calldata again.
    struct Attestation {
        bytes32 zoneId;
        bytes32 speciesId;
        string seasonLabel;
        uint32 eligibleUnits;
        uint256 perUnit;
        uint256 reservedAmount;
        uint64 attestedAt;
        uint64 claimDeadline;
    }

    /// @dev Per-(event, plot) settlement status. Every (eventId, plotLabel) pair is in exactly one of these
    ///      states at any time: `Unsettled` (never processed by `settle`), `Paid` (settled directly), `Held`
    ///      (on hold — see `holdReason`), `Claimed` (was Held, later paid via `claimHeld`) or `Swept` (was
    ///      Held, its reserve reclaimed via `sweep` after the claim window elapsed).
    enum PlotStatus {
        Unsettled,
        Paid,
        Held,
        Claimed,
        Swept
    }

    struct PlotSettlement {
        PlotStatus status;
        bytes32 holdReason;
    }

    // ---------------------------------------------------------------------
    // Immutables
    // ---------------------------------------------------------------------
    IERC20 public immutable jpyc;
    IHumanRegistry public immutable humans;
    IPlotResolver public immutable plotResolver;
    ISlotResolver public immutable slotResolver;

    bytes32 private constant TRIGGER_TYPEHASH = keccak256(
        "Trigger(bytes32 zoneId,bytes32 speciesId,bytes32 perilId,uint8 tier,string seasonLabel,uint64 windowStart,uint64 windowEnd,uint64 firedAt,uint32 index,uint32 threshold,bytes32 dataHash,uint64 deadline)"
    );

    // ---------------------------------------------------------------------
    // Hold reasons (see IReliefPool.Held) — short ASCII strings packed into bytes32, checked in this priority
    // order by `_settleOne`: ZONE_MISMATCH, NO_FARMER, PLOT_EXPIRED, UNVERIFIED, CAP.
    // ---------------------------------------------------------------------
    bytes32 public constant REASON_NO_FARMER = "NO_FARMER";
    bytes32 public constant REASON_PLOT_EXPIRED = "PLOT_EXPIRED";
    bytes32 public constant REASON_UNVERIFIED = "UNVERIFIED";
    bytes32 public constant REASON_CAP = "CAP";
    bytes32 public constant REASON_ZONE_MISMATCH = "ZONE_MISMATCH";

    // ---------------------------------------------------------------------
    // Signer set (2-of-3 by default; admin-configurable N-of-M)
    // ---------------------------------------------------------------------
    address[] public signers;
    mapping(address => bool) public isSigner;
    uint256 public signerThreshold;

    // ---------------------------------------------------------------------
    // Plot cache (zone/species from a mocked ENSv2 resolver for now, see IPlotResolver)
    // ---------------------------------------------------------------------
    mapping(string => Plot) public plots;
    /// @dev [zoneId][speciesId] => count of currently enrolled plots; O(1) input to the pro-rata snapshot.
    mapping(bytes32 => mapping(bytes32 => uint32)) public unitsByZoneSpecies;

    // ---------------------------------------------------------------------
    // Admin-set economics
    // ---------------------------------------------------------------------
    /// @dev [perilId][speciesId][tier] => JPYC per unit (architecture: scallop tier1 20000e18, etc). Keyed by
    ///      peril too because the same species/tier pays different amounts for different perils (e.g. scallop
    ///      tier 1 heat vs. scallop tier 1 toxin ban).
    mapping(bytes32 => mapping(bytes32 => mapping(uint8 => uint256))) public tierAmounts;

    /// @dev World ID level => max units a verified human may be paid across events (defaults: L1=3, L2=12).
    ///      Consumed by `settle`: a plot's farmer wallet is capped at `unitCap[humans.levelOf(farmer)]` units
    ///      paid per event, tracked per nullifier (not per wallet) via `unitsPaid`.
    mapping(uint8 => uint32) public unitCap;

    /// @dev Window after `attest` in which a Held payout can still be `claimHeld` before `sweep` reclaims it.
    uint64 public claimWindow;

    /// @notice JPYC already committed to attested events; `settle`/`claimHeld`/`sweep` retire it into
    ///         Paid/Claimed/Swept, leaving the reserve. Invariant: `reserved == pending + held` — a plot's
    ///         `perUnit` share stays counted in `reserved` for as long as it is Unsettled ("pending") or Held,
    ///         and leaves `reserved` the instant it becomes Paid, Claimed or Swept.
    uint256 public reserved;

    mapping(bytes32 => Attestation) public attestations;

    /// @dev eventId => nullifier => units already paid to that human (across all their plots) for this event.
    ///      Compared against `unitCap[level]` by `settle`/`claimHeld`; never decremented.
    mapping(bytes32 => mapping(bytes32 => uint32)) public unitsPaid;

    /// @dev eventId => plotLabel => settlement status + (if Held) reason. See `PlotStatus`.
    mapping(bytes32 => mapping(string => PlotSettlement)) public plotSettlements;

    constructor(
        IERC20 jpyc_,
        IHumanRegistry humans_,
        IPlotResolver plotResolver_,
        ISlotResolver slotResolver_,
        address admin_
    ) EIP712("ReliefPool", "1") {
        if (admin_ == address(0)) revert ZeroAddress();
        jpyc = jpyc_;
        humans = humans_;
        plotResolver = plotResolver_;
        slotResolver = slotResolver_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);

        unitCap[1] = 3;
        unitCap[2] = 12;
        claimWindow = 90 days;
    }

    // ---------------------------------------------------------------------
    // Donor flow
    // ---------------------------------------------------------------------
    function donate(uint256 amount, string calldata memo) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        jpyc.safeTransferFrom(msg.sender, address(this), amount);
        emit Donated(msg.sender, amount, memo);
    }

    // ---------------------------------------------------------------------
    // Plot enrollment
    // ---------------------------------------------------------------------
    function enroll(string calldata plotLabel) external {
        _syncPlot(plotLabel);
    }

    function reindex(string calldata plotLabel) external {
        if (!plots[plotLabel].enrolled) revert PlotNotEnrolled(plotLabel);
        _syncPlot(plotLabel);
    }

    function _syncPlot(string calldata plotLabel) internal {
        (bytes32 zoneId, bytes32 speciesId) = plotResolver.zoneAndSpeciesOf(plotLabel);
        if (zoneId == bytes32(0) || speciesId == bytes32(0)) revert UnknownPlot(plotLabel);

        Plot storage p = plots[plotLabel];
        if (!p.enrolled) {
            unitsByZoneSpecies[zoneId][speciesId] += 1;
            p.enrolled = true;
        } else if (p.zoneId != zoneId || p.speciesId != speciesId) {
            unitsByZoneSpecies[p.zoneId][p.speciesId] -= 1;
            unitsByZoneSpecies[zoneId][speciesId] += 1;
        }
        p.zoneId = zoneId;
        p.speciesId = speciesId;
        emit Enrolled(plotLabel, zoneId, speciesId);
    }

    // ---------------------------------------------------------------------
    // Attestation: N-of-M EIP-712 signed Trigger (2-of-3 by default) + pro-rata reserve snapshot
    // ---------------------------------------------------------------------
    function attest(Trigger calldata t, bytes[] calldata sigs) external nonReentrant returns (bytes32 eventId) {
        if (block.timestamp > t.deadline) revert Expired();
        if (t.windowEnd > block.timestamp) revert WindowNotElapsed(t.windowEnd, uint64(block.timestamp));
        if (t.index < t.threshold) revert ThresholdNotMet(t.index, t.threshold);

        eventId = eventIdOf(t);
        if (attestations[eventId].attestedAt != 0) revert AlreadyAttested(eventId);

        uint256 threshold = signerThreshold;
        if (threshold == 0 || sigs.length < threshold) revert BadSignatures();

        address[] memory recovered = _verifySignatures(t, sigs);

        bytes32 zoneId = t.zoneId;
        bytes32 speciesId = t.speciesId;
        uint32 eligibleUnits = unitsByZoneSpecies[zoneId][speciesId];
        if (eligibleUnits == 0) revert NoEligibleUnits(zoneId, speciesId);

        uint256 tierAmount = tierAmounts[t.perilId][speciesId][t.tier];
        if (tierAmount == 0) revert TierAmountNotSet(t.perilId, speciesId, t.tier);

        uint256 free = jpyc.balanceOf(address(this)) - reserved;
        uint256 perUnitFree = free / eligibleUnits;
        uint256 perUnit = tierAmount < perUnitFree ? tierAmount : perUnitFree;
        uint256 amount = perUnit * eligibleUnits;
        reserved += amount;

        attestations[eventId] = Attestation({
            zoneId: zoneId,
            speciesId: speciesId,
            seasonLabel: t.seasonLabel,
            eligibleUnits: eligibleUnits,
            perUnit: perUnit,
            reservedAmount: amount,
            attestedAt: uint64(block.timestamp),
            claimDeadline: uint64(block.timestamp) + claimWindow
        });

        emit Attested(eventId, t, eligibleUnits, perUnit, recovered);
    }

    /// @dev Every signature must recover to a distinct, currently-registered signer, or the whole call reverts.
    function _verifySignatures(Trigger calldata t, bytes[] calldata sigs)
        internal
        view
        returns (address[] memory recovered)
    {
        bytes32 digest = triggerDigest(t);
        recovered = new address[](sigs.length);
        for (uint256 i = 0; i < sigs.length; ++i) {
            (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sigs[i]);
            if (err != ECDSA.RecoverError.NoError || !isSigner[signer]) revert BadSignatures();
            for (uint256 j = 0; j < i; ++j) {
                if (recovered[j] == signer) revert BadSignatures();
            }
            recovered[i] = signer;
        }
    }

    /// @notice EIP-712 digest for `t` under this pool's domain {name: "ReliefPool", version: "1", chainId:
    ///         block.chainid, verifyingContract: address(this)}; off-chain signers (pipeline + keeper) sign this
    ///         exact digest to produce the `sigs` passed to `attest`.
    function triggerDigest(Trigger calldata t) public view returns (bytes32) {
        return _hashTypedDataV4(_hashTrigger(t));
    }

    function _hashTrigger(Trigger calldata t) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                TRIGGER_TYPEHASH,
                t.zoneId,
                t.speciesId,
                t.perilId,
                t.tier,
                keccak256(bytes(t.seasonLabel)),
                t.windowStart,
                t.windowEnd,
                t.firedAt,
                t.index,
                t.threshold,
                t.dataHash,
                t.deadline
            )
        );
    }

    // ---------------------------------------------------------------------
    // settle / claimHeld / sweep
    // ---------------------------------------------------------------------

    /// @notice Settles each plot in `plotLabels` against `eventId`'s attestation: pays it, or holds it with a
    ///         reason. Idempotent — a plot already Paid/Held/Claimed/Swept is skipped, so a batch mixing fresh
    ///         and already-settled plot labels never reverts on that account. Reverts only if `eventId` was
    ///         never attested.
    function settle(bytes32 eventId, string[] calldata plotLabels) external nonReentrant {
        Attestation storage a = attestations[eventId];
        if (a.attestedAt == 0) revert UnknownEvent(eventId);

        uint256 n = plotLabels.length;
        for (uint256 i = 0; i < n; ++i) {
            _settleOne(eventId, a, plotLabels[i]);
        }
    }

    /// @notice Re-runs `settle`'s eligibility checks for a Held plot, within the claim window. Pays and moves
    ///         the plot to Claimed if the checks now pass (e.g. the farmer has since bound a World ID, or the
    ///         cap has room in a way it didn't before — note per-nullifier `unitsPaid` never decreases, so a
    ///         CAP hold cannot be claimed away by waiting); otherwise reverts `StillIneligible` with the
    ///         current failing reason. A revert unwinds every state change from this call (Solidity semantics),
    ///         so a still-ineligible attempt necessarily leaves `holdReason` exactly as `settle` (or a prior
    ///         `claimHeld` attempt) last recorded it — it is not "refreshed" to the new reason, since a
    ///         changed-but-still-failing reason can only be observed via this revert's error data, not storage.
    function claimHeld(bytes32 eventId, string calldata plotLabel) external nonReentrant {
        Attestation storage a = attestations[eventId];
        if (a.attestedAt == 0) revert UnknownEvent(eventId);

        PlotSettlement storage ps = plotSettlements[eventId][plotLabel];
        if (ps.status != PlotStatus.Held) revert NotHeld(eventId, plotLabel);
        if (block.timestamp > a.claimDeadline) revert ClaimWindowElapsed(a.claimDeadline, uint64(block.timestamp));

        (bytes32 reason, address farmer, bytes32 nullifier) = _checkEligibility(eventId, a, plotLabel);
        if (reason != bytes32(0)) {
            revert StillIneligible(eventId, plotLabel, reason);
        }

        _pay(eventId, ps, PlotStatus.Claimed, farmer, nullifier, a.perUnit);
        emit Claimed(eventId, plotLabel, farmer, a.perUnit);
    }

    /// @notice Reclaims a Held plot's reserved share back into the free pool once the claim window has
    ///         elapsed. Does not move tokens (the JPYC never left the pool) — it only releases `reserved`.
    function sweep(bytes32 eventId, string calldata plotLabel) external nonReentrant {
        Attestation storage a = attestations[eventId];
        if (a.attestedAt == 0) revert UnknownEvent(eventId);

        PlotSettlement storage ps = plotSettlements[eventId][plotLabel];
        if (ps.status != PlotStatus.Held) revert NotHeld(eventId, plotLabel);
        if (block.timestamp <= a.claimDeadline) revert ClaimWindowActive(a.claimDeadline, uint64(block.timestamp));

        ps.status = PlotStatus.Swept;
        reserved -= a.perUnit;
        emit Swept(eventId, plotLabel, a.perUnit);
    }

    /// @inheritdoc IReliefPool
    /// @dev Thin passthrough to `slotResolver` — the interface issue #11 implements against real ENSv2.
    function payoutTarget(string calldata plotLabel, string calldata seasonLabel)
        external
        view
        returns (address farmer, address plotRegistry, uint64 slotExpiry)
    {
        return slotResolver.slotOwnerOf(plotLabel, seasonLabel);
    }

    /// @dev Settles a single plot: no-op if already settled (idempotency), else runs the same eligibility
    ///      checks as `claimHeld` and either pays (Paid) or holds (Held, with reason).
    function _settleOne(bytes32 eventId, Attestation storage a, string calldata plotLabel) internal {
        PlotSettlement storage ps = plotSettlements[eventId][plotLabel];
        if (ps.status != PlotStatus.Unsettled) return;

        (bytes32 reason, address farmer, bytes32 nullifier) = _checkEligibility(eventId, a, plotLabel);
        if (reason != bytes32(0)) {
            ps.status = PlotStatus.Held;
            ps.holdReason = reason;
            emit Held(eventId, plotLabel, reason);
            return;
        }

        _pay(eventId, ps, PlotStatus.Paid, farmer, nullifier, a.perUnit);
        emit Paid(eventId, plotLabel, farmer, nullifier, a.perUnit);
    }

    /// @dev Shared eligibility logic for `settle`/`claimHeld`, checked in priority order:
    ///        1. ZONE_MISMATCH — the plot isn't currently enrolled for this event's zone/species (covers a
    ///           plot that was never enrolled, since an unenrolled `Plot` has zoneId 0, and a plot reindexed
    ///           to a different zone/species since `attest`).
    ///        2. NO_FARMER    — `slotResolver` has no owner for the plot's season slot.
    ///        3. PLOT_EXPIRED — the season slot's expiry is at or before now.
    ///        4. UNVERIFIED   — the farmer wallet has no World ID binding (`humanOf(...).nullifier == 0`) or
    ///           resolves to level 0.
    ///        5. CAP          — the farmer's nullifier has already been paid `unitCap[level]` units for this
    ///           event.
    ///      Returns `reason == bytes32(0)` when every check passes, alongside the resolved `farmer`/`nullifier`.
    function _checkEligibility(bytes32 eventId, Attestation storage a, string calldata plotLabel)
        internal
        view
        returns (bytes32 reason, address farmer, bytes32 nullifier)
    {
        Plot storage p = plots[plotLabel];
        if (!p.enrolled || p.zoneId != a.zoneId || p.speciesId != a.speciesId) {
            return (REASON_ZONE_MISMATCH, address(0), bytes32(0));
        }

        uint64 slotExpiry;
        (farmer,, slotExpiry) = slotResolver.slotOwnerOf(plotLabel, a.seasonLabel);
        if (farmer == address(0)) {
            return (REASON_NO_FARMER, address(0), bytes32(0));
        }
        if (slotExpiry <= block.timestamp) {
            return (REASON_PLOT_EXPIRED, farmer, bytes32(0));
        }

        nullifier = humans.humanOf(farmer).nullifier;
        uint8 level = humans.levelOf(farmer);
        if (nullifier == bytes32(0) || level == 0) {
            return (REASON_UNVERIFIED, farmer, bytes32(0));
        }

        if (unitsPaid[eventId][nullifier] >= unitCap[level]) {
            return (REASON_CAP, farmer, nullifier);
        }

        return (bytes32(0), farmer, nullifier);
    }

    /// @dev Common bookkeeping for a successful payout (via `settle` or `claimHeld`): marks the plot settled,
    ///      bumps `unitsPaid`, releases `reserved`, and transfers JPYC. Follows checks-effects-interactions —
    ///      all state is updated before the external `safeTransfer`.
    function _pay(
        bytes32 eventId,
        PlotSettlement storage ps,
        PlotStatus finalStatus,
        address farmer,
        bytes32 nullifier,
        uint256 amount
    ) internal {
        ps.status = finalStatus;
        ps.holdReason = bytes32(0);
        unitsPaid[eventId][nullifier] += 1;
        reserved -= amount;
        jpyc.safeTransfer(farmer, amount);
    }

    // ---------------------------------------------------------------------
    // Admin setters
    // ---------------------------------------------------------------------
    function setSigners(address[] calldata newSigners, uint256 threshold_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 n = newSigners.length;
        if (threshold_ == 0 || threshold_ > n) revert InvalidSignerConfig();

        uint256 oldLen = signers.length;
        for (uint256 i = 0; i < oldLen; ++i) {
            isSigner[signers[i]] = false;
        }
        delete signers;

        for (uint256 i = 0; i < n; ++i) {
            address s = newSigners[i];
            if (s == address(0)) revert ZeroAddress();
            if (isSigner[s]) revert DuplicateSigner(s);
            isSigner[s] = true;
            signers.push(s);
        }
        signerThreshold = threshold_;
        emit SignersUpdated(newSigners, threshold_);
    }

    function setTierAmount(bytes32 perilId, bytes32 speciesId, uint8 tier, uint256 amountPerUnit)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        tierAmounts[perilId][speciesId][tier] = amountPerUnit;
        emit TierAmountSet(perilId, speciesId, tier, amountPerUnit);
    }

    function setUnitCap(uint8 level, uint32 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        unitCap[level] = cap;
        emit UnitCapSet(level, cap);
    }

    function setClaimWindow(uint64 window) external onlyRole(DEFAULT_ADMIN_ROLE) {
        claimWindow = window;
        emit ClaimWindowSet(window);
    }

    function signersCount() external view returns (uint256) {
        return signers.length;
    }

    /// @dev eventId = keccak256(abi.encode(zoneId, speciesId, perilId, tier, seasonLabel)); mirrors @repo/shared eventIdOf.
    function eventIdOf(Trigger calldata t) public pure returns (bytes32) {
        return keccak256(abi.encode(t.zoneId, t.speciesId, t.perilId, t.tier, t.seasonLabel));
    }
}
