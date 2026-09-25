// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IReliefPool} from "./interfaces/IReliefPool.sol";
import {IHumanRegistry} from "./interfaces/IHumanRegistry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Scaffold. Core logic tracked in the "ReliefPool" issues. Amounts are JPYC with 18 decimals (¥20,000 = 20000e18).
contract ReliefPool is IReliefPool {
    error NotImplemented();

    IERC20 public immutable jpyc;
    IHumanRegistry public immutable humans;
    address public immutable branchRegistry; // ENSv2 registry for karakuwa.<parent>.eth
    address public admin;

    constructor(IERC20 jpyc_, IHumanRegistry humans_, address branchRegistry_, address admin_) {
        jpyc = jpyc_;
        humans = humans_;
        branchRegistry = branchRegistry_;
        admin = admin_;
    }

    function donate(uint256, string calldata) external pure { revert NotImplemented(); }
    function enroll(string calldata) external pure { revert NotImplemented(); }
    function reindex(string calldata) external pure { revert NotImplemented(); }
    function attest(Trigger calldata, bytes[] calldata) external pure returns (bytes32) { revert NotImplemented(); }
    function settle(bytes32, string[] calldata) external pure { revert NotImplemented(); }
    function claimHeld(bytes32, string calldata) external pure { revert NotImplemented(); }
    function sweep(bytes32, string calldata) external pure { revert NotImplemented(); }
    function payoutTarget(string calldata, string calldata) external pure returns (address, address, uint64) {
        revert NotImplemented();
    }

    /// @dev eventId = keccak256(abi.encode(zoneId, speciesId, perilId, tier, seasonLabel)); mirrors @umi/shared eventIdOf.
    function eventIdOf(Trigger calldata t) public pure returns (bytes32) {
        return keccak256(abi.encode(t.zoneId, t.speciesId, t.perilId, t.tier, t.seasonLabel));
    }
}
