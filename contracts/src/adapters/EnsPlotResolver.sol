// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IPlotResolver} from "../interfaces/IPlotResolver.sol";
import {IEnsV2Registry, IExtendedResolver} from "../interfaces/IEnsV2.sol";

/// @notice Reads a `text(bytes32,string)` record through the ENSIP-5/ENSIP-10 `resolve()` entrypoint. Only
///         used to build calldata for `IExtendedResolver.resolve` below — the resolver never receives a
///         direct call to this selector. `PermissionedResolver.resolve` (and `AbstractRecordResolver`
///         underneath it) ignores the `bytes32 node` argument entirely and recomputes the node from the
///         DNS-encoded `name` passed to `resolve()` itself, so `bytes32(0)` here is correct for any name.
interface ITextResolverRead {
    function text(bytes32 node, string calldata key) external view returns (string memory);
}

/// @notice Issue #11 — real IPlotResolver adapter: reads a plot's `zone`/`species` ENSIP-5 text records off
///         the real ENSv2 branch on Sepolia issue #10 deploys.
///
///         Plot labels are direct children of the karakuwa branch registry
///         (`p1213-017.karakuwa.<parent>.eth`); `branchRegistry.getResolver(plotLabel)` gives the resolver
///         responsible for that plot (in `DeployEnsPlots.s.sol`'s layout, the same shared branch
///         `PermissionedResolver` instance issue #7 deployed and scoped the science key's
///         `setText(zone)`/`setText(species)` grants against — that scoping is by text *key* only
///         (`PermissionedResolverLib.resource(key) = keccak256(key)`), not by name/node, so the science key
///         can already set zone/species for every plot on this resolver without any additional grant).
///
///         Returns `(0, 0)` — "does not resolve", per `IPlotResolver`'s contract — for a plot with no
///         resolver yet, or with a resolver but no zone/species text set. `keccak256(bytes(value))` mirrors
///         `idOf(label)` from `packages/shared/src/ids.ts` exactly.
contract EnsPlotResolver is IPlotResolver {
    IEnsV2Registry public immutable branchRegistry;

    /// @dev DNS wire encoding of `branchLabel.parentLabel.tld` (e.g. `karakuwa.umi.eth`), precomputed once.
    ///      A plot's full DNS name is `lengthPrefix(plotLabel) . plotLabel . branchSuffix`.
    bytes internal branchSuffix;

    constructor(IEnsV2Registry branchRegistry_, string memory branchLabel_, string memory parentLabel_, string memory tld_) {
        branchRegistry = branchRegistry_;
        branchSuffix = abi.encodePacked(
            uint8(bytes(branchLabel_).length),
            branchLabel_,
            uint8(bytes(parentLabel_).length),
            parentLabel_,
            uint8(bytes(tld_).length),
            tld_,
            uint8(0)
        );
    }

    /// @inheritdoc IPlotResolver
    function zoneAndSpeciesOf(string calldata plotLabel) external view returns (bytes32 zoneId, bytes32 speciesId) {
        address resolver = branchRegistry.getResolver(plotLabel);
        if (resolver == address(0)) {
            return (bytes32(0), bytes32(0));
        }

        bytes memory name = abi.encodePacked(uint8(bytes(plotLabel).length), plotLabel, branchSuffix);
        string memory zone = _readText(resolver, name, "zone");
        string memory species = _readText(resolver, name, "species");
        if (bytes(zone).length == 0 || bytes(species).length == 0) {
            return (bytes32(0), bytes32(0));
        }

        return (keccak256(bytes(zone)), keccak256(bytes(species)));
    }

    function _readText(address resolver, bytes memory name, string memory key)
        internal
        view
        returns (string memory)
    {
        bytes memory result =
            IExtendedResolver(resolver).resolve(name, abi.encodeCall(ITextResolverRead.text, (bytes32(0), key)));
        return abi.decode(result, (string));
    }
}
