// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IPlotResolver} from "../../src/interfaces/IPlotResolver.sol";

/// @notice Settable test double for IPlotResolver. Stands in for the ENSv2 branch -> plot walk until issue
///         "ReliefPool reads ENS on-chain" wires the real resolver.
contract MockPlotResolver is IPlotResolver {
    mapping(string => bytes32) public zoneOf;
    mapping(string => bytes32) public speciesOf;

    function setPlot(string calldata plotLabel, bytes32 zoneId, bytes32 speciesId) external {
        zoneOf[plotLabel] = zoneId;
        speciesOf[plotLabel] = speciesId;
    }

    function zoneAndSpeciesOf(string calldata plotLabel) external view returns (bytes32 zoneId, bytes32 speciesId) {
        return (zoneOf[plotLabel], speciesOf[plotLabel]);
    }
}
