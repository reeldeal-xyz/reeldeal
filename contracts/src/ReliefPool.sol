// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IReliefPool} from "./interfaces/IReliefPool.sol";
import {IHumanRegistry} from "./interfaces/IHumanRegistry.sol";
import {IPlotResolver} from "./interfaces/IPlotResolver.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Donor-funded relief pool paying JPYC (18 decimals; ¥20,000 = 20000e18) to the owner of a plot's
///         season slot on ENSv2 when a 2-of-3 (admin-configurable N-of-M) signed Trigger crosses a threshold.
///         Amounts are pro-rated across the plots enrolled for the trigger's zone/species at attestation time.
/// @dev Scope is "ReliefPool core": donate, enroll/reindex, attest + the pro-rata reserve snapshot. Two things
///      intentionally still revert NotImplemented and build on the storage/events introduced here:
///        - `settle`/`claimHeld`/`sweep` + per-level unit caps (issue "settle, hold reasons, claimHeld, sweep").
///        - `payoutTarget` and the real ENSv2 branch -> plot -> slot walk (issue "ReliefPool reads ENS on-chain"),
///          which can land as a new `IPlotResolver` implementation without touching this contract, or may extend
///          it for slot owner/expiry — see IPlotResolver.sol.
///      Field order of Trigger MUST match packages/shared/src/trigger.ts (EIP-712 type) — see IReliefPool.sol.
contract ReliefPool is IReliefPool, AccessControl, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Errors beyond the ones IReliefPool already declares (inherited: AlreadyAttested, BadSignatures,
    // ThresholdNotMet, Expired).
    // ---------------------------------------------------------------------
    error NotImplemented();
    error ZeroAmount();
    error ZeroAddress();
    error UnknownPlot(string plotLabel);
    error PlotNotEnrolled(string plotLabel);
    error InvalidSignerConfig();
    error DuplicateSigner(address signer);
    error NoEligibleUnits(bytes32 zoneId, bytes32 speciesId);
    error TierAmountNotSet(bytes32 perilId, bytes32 speciesId, uint8 tier);
    error WindowNotElapsed(uint64 windowEnd, uint64 nowTs);

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

    /// @dev Pro-rata snapshot taken at `attest`, meant to be consumed by `settle` (per-plot pay/hold) and by
    ///      `claimHeld`/`sweep` against `claimDeadline` (issue "settle, hold reasons, claimHeld, sweep").
    struct Attestation {
        uint32 eligibleUnits;
        uint256 perUnit;
        uint256 reservedAmount;
        uint64 attestedAt;
        uint64 claimDeadline;
    }

    // ---------------------------------------------------------------------
    // Immutables
    // ---------------------------------------------------------------------
    IERC20 public immutable jpyc;
    IHumanRegistry public immutable humans;
    IPlotResolver public immutable plotResolver;

    bytes32 private constant TRIGGER_TYPEHASH = keccak256(
        "Trigger(bytes32 zoneId,bytes32 speciesId,bytes32 perilId,uint8 tier,string seasonLabel,uint64 windowStart,uint64 windowEnd,uint64 firedAt,uint32 index,uint32 threshold,bytes32 dataHash,uint64 deadline)"
    );

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
    ///      Consumed by `settle` (issue "settle, hold reasons, claimHeld, sweep").
    mapping(uint8 => uint32) public unitCap;

    /// @dev Window after `attest` in which a Held payout can still be `claimHeld` before `sweep` reclaims it.
    uint64 public claimWindow;

    /// @notice JPYC already committed to attested events; `settle`/`claimHeld`/`sweep` retire it into
    ///         Paid/Held/Swept (invariant tracked by issue "settle, hold reasons, claimHeld, sweep": reserved
    ///         == pending + paid + held + swept).
    uint256 public reserved;

    mapping(bytes32 => Attestation) public attestations;

    constructor(IERC20 jpyc_, IHumanRegistry humans_, IPlotResolver plotResolver_, address admin_)
        EIP712("ReliefPool", "1")
    {
        if (admin_ == address(0)) revert ZeroAddress();
        jpyc = jpyc_;
        humans = humans_;
        plotResolver = plotResolver_;
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
    // Not yet implemented: "settle, hold reasons, claimHeld, sweep" and "ReliefPool reads ENS on-chain"
    // ---------------------------------------------------------------------
    function settle(bytes32, string[] calldata) external pure {
        revert NotImplemented();
    }

    function claimHeld(bytes32, string calldata) external pure {
        revert NotImplemented();
    }

    function sweep(bytes32, string calldata) external pure {
        revert NotImplemented();
    }

    function payoutTarget(string calldata, string calldata) external pure returns (address, address, uint64) {
        revert NotImplemented();
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
