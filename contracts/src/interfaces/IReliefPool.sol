// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Donor-funded relief pool paying JPYC (18 decimals) to the owner of a plot's season slot on ENSv2.
///         Field order of Trigger MUST match packages/shared/src/trigger.ts (EIP-712 type).
interface IReliefPool {
    struct Trigger {
        bytes32 zoneId;
        bytes32 speciesId;
        bytes32 perilId;
        uint8 tier;
        string seasonLabel;
        uint64 windowStart;
        uint64 windowEnd;
        uint64 firedAt;
        uint32 index;
        uint32 threshold;
        uint8 tempC; // HEAT: a day counts when daily SST >= tempC (whole °C). 0 for perils without a temperature.
        bytes32 dataHash;
        uint64 deadline;
    }

    event Donated(address indexed from, uint256 amount, string memo);
    event Enrolled(string plotLabel, bytes32 zoneId, bytes32 speciesId);
    event Attested(bytes32 indexed eventId, Trigger t, uint32 eligibleUnits, uint256 perUnit, address[] signers);
    event Paid(bytes32 indexed eventId, string plotLabel, address indexed farmer, bytes32 indexed nullifier, uint256 amount);
    event Held(bytes32 indexed eventId, string plotLabel, bytes32 reason); // NO_FARMER, PLOT_EXPIRED, UNVERIFIED, CAP, ZONE_MISMATCH
    event Claimed(bytes32 indexed eventId, string plotLabel, address farmer, uint256 amount);
    event Swept(bytes32 indexed eventId, string plotLabel, uint256 amount);

    error AlreadyAttested(bytes32 eventId);
    error BadSignatures();
    error ThresholdNotMet(uint32 index, uint32 threshold);
    error Expired();

    function donate(uint256 amount, string calldata memo) external;
    function enroll(string calldata plotLabel) external;
    function reindex(string calldata plotLabel) external;
    function attest(Trigger calldata t, bytes[] calldata sigs) external returns (bytes32 eventId);
    function settle(bytes32 eventId, string[] calldata plotLabels) external;
    function claimHeld(bytes32 eventId, string calldata plotLabel) external;
    function sweep(bytes32 eventId, string calldata plotLabel) external;
    function payoutTarget(string calldata plotLabel, string calldata seasonLabel)
        external view returns (address farmer, address plotRegistry, uint64 slotExpiry);
}
