// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IHumanRegistry} from "./interfaces/IHumanRegistry.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @notice Binds one payout wallet to one World ID nullifier. Levels gate ReliefPool payout caps
///         (level 1 = 3 units, level 2 = 12 units — enforced by ReliefPool, not here).
///
///         Roles:
///         - `DEFAULT_ADMIN_ROLE`: rotates the binder key (grant/revoke `BINDER_ROLE`), performs `rebind`
///           for a lost phone/wallet, and tunes `minSybilScoreBps`.
///         - `BINDER_ROLE`: an off-chain server key. Writes `bind`/`upgrade` only after verifying a World ID
///           proof server-side at developer.world.org/api/v4/verify.
///
///         Schemas: 11 -> level 1 (Selfie Check). 1, 9303, 9310 -> level 2 (Orb Proof of Human, passport,
///         My Number Card). Anything else reverts `UnknownSchema`.
///
///         No personal data is stored on-chain: only the wallet, the World ID nullifier, the schema id, a
///         sybil score and an opaque receipt hash of the off-chain verification record.
contract HumanRegistry is IHumanRegistry, AccessControl {
    bytes32 public constant BINDER_ROLE = keccak256("BINDER_ROLE");

    /// @dev wallet => Human. `nullifier == bytes32(0)` means the wallet has never been bound.
    mapping(address wallet => Human) private _humans;
    /// @dev nullifier => bound wallet. `address(0)` means the nullifier has never been bound.
    mapping(bytes32 nullifier => address) private _wallets;

    /// @notice Minimum `sybilScoreBps` a `bind` must carry. Admin-settable; defaults to 0 (no floor), since
    ///         the score is only advisory until World ID's sybil signal is calibrated for this deployment.
    uint16 public minSybilScoreBps;

    event MinSybilScoreUpdated(uint16 oldMin, uint16 newMin);

    error ZeroAddress();
    error ZeroNullifier();
    error WalletNullifierMismatch(address wallet, bytes32 nullifier);
    error NullifierNotBound(bytes32 nullifier);

    constructor(address admin_, address binder_) {
        if (admin_ == address(0) || binder_ == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(BINDER_ROLE, binder_);
    }

    /// @inheritdoc IHumanRegistry
    function bind(
        address wallet,
        bytes32 nullifier,
        uint16 schemaId,
        uint16 sybilScoreBps,
        uint64 verifiedAt,
        bytes32 receiptHash
    ) external onlyRole(BINDER_ROLE) {
        if (wallet == address(0)) revert ZeroAddress();
        if (nullifier == bytes32(0)) revert ZeroNullifier();

        _levelForSchema(schemaId); // reverts UnknownSchema for anything but 11, 1, 9303, 9310

        if (sybilScoreBps < minSybilScoreBps) revert SybilScoreTooLow(sybilScoreBps, minSybilScoreBps);

        address boundWallet = _wallets[nullifier];
        if (boundWallet != address(0)) revert NullifierAlreadyBound(boundWallet);

        bytes32 boundNullifier = _humans[wallet].nullifier;
        if (boundNullifier != bytes32(0)) revert WalletAlreadyBound(boundNullifier);

        _humans[wallet] = Human({
            nullifier: nullifier,
            schemaId: schemaId,
            sybilScoreBps: sybilScoreBps,
            verifiedAt: verifiedAt,
            receiptHash: receiptHash
        });
        _wallets[nullifier] = wallet;

        emit Bound(wallet, nullifier, schemaId, sybilScoreBps);
    }

    /// @inheritdoc IHumanRegistry
    /// @dev Moves an already-bound human to a level-2 schema (1, 9303 or 9310). Re-running this with a fresh
    ///      level-2 proof (e.g. a renewed passport check) is allowed and simply refreshes `verifiedAt` and
    ///      `receiptHash`; it does not change `sybilScoreBps`, which is only set at `bind` time.
    function upgrade(address wallet, bytes32 nullifier, uint16 schemaId, bytes32 receiptHash)
        external
        onlyRole(BINDER_ROLE)
    {
        if (wallet == address(0) || _wallets[nullifier] != wallet) {
            revert WalletNullifierMismatch(wallet, nullifier);
        }

        uint8 level = _levelForSchema(schemaId);
        if (level != 2) revert UnknownSchema(schemaId);

        Human storage h = _humans[wallet];
        h.schemaId = schemaId;
        h.verifiedAt = uint64(block.timestamp);
        h.receiptHash = receiptHash;

        emit Upgraded(wallet, nullifier, schemaId);
    }

    /// @inheritdoc IHumanRegistry
    /// @dev Admin-only recovery path for a lost phone/wallet. Moves the whole `Human` record (nullifier,
    ///      schema, score, receipt) from `oldWallet` to `newWallet`; the identity stays tied to the
    ///      nullifier, only the payout wallet pointer changes.
    function rebind(bytes32 nullifier, address newWallet) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address oldWallet = _wallets[nullifier];
        if (oldWallet == address(0)) revert NullifierNotBound(nullifier);
        if (newWallet == address(0)) revert ZeroAddress();

        if (newWallet != oldWallet) {
            if (_humans[newWallet].nullifier != bytes32(0)) {
                revert WalletAlreadyBound(_humans[newWallet].nullifier);
            }

            Human memory h = _humans[oldWallet];
            delete _humans[oldWallet];
            _humans[newWallet] = h;
            _wallets[nullifier] = newWallet;
        }

        emit Rebound(nullifier, oldWallet, newWallet);
    }

    /// @notice Raises or lowers the minimum `sybilScoreBps` future `bind` calls must meet.
    function setMinSybilScoreBps(uint16 newMin) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit MinSybilScoreUpdated(minSybilScoreBps, newMin);
        minSybilScoreBps = newMin;
    }

    /// @inheritdoc IHumanRegistry
    function levelOf(address wallet) external view returns (uint8) {
        bytes32 nullifier = _humans[wallet].nullifier;
        if (nullifier == bytes32(0)) return 0;
        return _levelForSchema(_humans[wallet].schemaId);
    }

    /// @inheritdoc IHumanRegistry
    function humanOf(address wallet) external view returns (Human memory) {
        return _humans[wallet];
    }

    /// @inheritdoc IHumanRegistry
    function walletOf(bytes32 nullifier) external view returns (address) {
        return _wallets[nullifier];
    }

    /// @dev Schemas: 11 -> level 1; 1, 9303, 9310 -> level 2; anything else reverts `UnknownSchema`.
    function _levelForSchema(uint16 schemaId) internal pure returns (uint8) {
        if (schemaId == 11) return 1;
        if (schemaId == 1 || schemaId == 9303 || schemaId == 9310) return 2;
        revert UnknownSchema(schemaId);
    }
}
