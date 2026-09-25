// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Binds a payout wallet to one World ID nullifier. Written only by the binder key after server-side
///         verification at developer.world.org/api/v4/verify. Levels: 0 none, 1 Selfie Check (schema 11),
///         2 My Number Card (9310), passport (9303) or Orb Proof of Human (1).
interface IHumanRegistry {
    struct Human {
        bytes32 nullifier;
        uint16 schemaId;
        uint16 sybilScoreBps;
        uint64 verifiedAt;
        bytes32 receiptHash;
    }

    event Bound(address indexed wallet, bytes32 indexed nullifier, uint16 schemaId, uint16 sybilScoreBps);
    event Upgraded(address indexed wallet, bytes32 indexed nullifier, uint16 schemaId);
    event Rebound(bytes32 indexed nullifier, address oldWallet, address newWallet);

    error NullifierAlreadyBound(address wallet);
    error WalletAlreadyBound(bytes32 nullifier);
    error SybilScoreTooLow(uint16 score, uint16 min);
    error UnknownSchema(uint16 schemaId);

    function bind(address wallet, bytes32 nullifier, uint16 schemaId, uint16 sybilScoreBps, uint64 verifiedAt, bytes32 receiptHash) external;
    function upgrade(address wallet, bytes32 nullifier, uint16 schemaId, bytes32 receiptHash) external;
    function rebind(bytes32 nullifier, address newWallet) external;
    function levelOf(address wallet) external view returns (uint8);
    function humanOf(address wallet) external view returns (Human memory);
    function walletOf(bytes32 nullifier) external view returns (address);
}
