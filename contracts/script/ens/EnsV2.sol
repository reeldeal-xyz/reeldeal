// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IEnsV2Registry, IExtendedResolver} from "../../src/interfaces/IEnsV2.sol";

/// @notice Write-side ENSv2 interfaces and role bitmaps used only by the deploy script and fork tests for
///         issue #7 (register `<parent>.eth`, deploy a branch UserRegistry + PermissionedResolver, grant
///         the science key scoped `setText` roles). `contracts/src/interfaces/IEnsV2.sol` stays the
///         minimal *production* read surface ReliefPool depends on (issue #11); nothing here is imported
///         by `src/`.
///
///         Every signature below is transcribed from primary source and must stay byte-for-byte
///         consistent with it (function selectors depend on the exact type list, not names):
///           - ensdomains/contracts-v2 @ 71a3b7339dbc55ab47667abdfe8303bac4f4c24e
///             contracts/src/registrar/interfaces/IETHRegistrar.sol       (IEthRegistrarV2)
///             contracts/src/registry/interfaces/IStandardRegistry.sol    (IUserRegistryWrite.register)
///             contracts/src/registry/libraries/RegistryRolesLib.sol      (RegistryRoles)
///             contracts/src/access-control/interfaces/IEACGrantInitializable.sol (Grant, IEACGrantInitializable)
///             contracts/src/resolver/interfaces/IPermissionedResolverInitializable.sol (IPermissionedResolverInitializable)
///             contracts/src/resolver/interfaces/setters/ITextSetter.sol / IAddressSetter.sol
///             contracts/src/resolver/interfaces/IPermissionedResolver.sol (grantSetterRoles, decodeSetter)
///             contracts/src/resolver/libraries/PermissionedResolverLib.sol (ResolverRoles)
///             contracts/src/access-control/interfaces/IEnhancedAccessControl.sol (roles/hasRoles/errors)
///           - ensdomains/verifiable-factory @ 5ef7b1a88fd9062bae580ed4048ca369f18450c4
///             src/IVerifiableFactory.sol (IVerifiableFactory)

/// @dev Initialization-time grant, identical shape for `UserRegistry.initialize` and
///      `PermissionedResolver.initialize` (both take `Grant[]`).
struct Grant {
    address account;
    uint256 roleBitmap;
}

/// @notice Mock ERC20 used to pay ETHRegistrar fees on Sepolia only (`MockERC20`, free-mint, no access
///         control on `mint`). Never deployed on mainnet.
interface IMintableERC20 {
    function mint(address to, uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

/// @notice Commit-reveal `.eth` registrar. See ETHRegistrar.sol / AbstractETHRegistrar.sol.
interface IEthRegistrarV2 {
    error UnexpiredCommitmentExists(bytes32 commitment);
    error CommitmentTooNew(bytes32 commitment, uint64 validFrom, uint64 blockTimestamp);
    error CommitmentTooOld(bytes32 commitment, uint64 validTo, uint64 blockTimestamp);
    error NameNotAvailable(string label);

    function commit(bytes32 commitment) external;

    function register(
        string memory label,
        address owner,
        bytes32 secret,
        address subregistry,
        address resolver,
        uint64 duration,
        address paymentToken,
        bytes32 referrer
    ) external returns (uint256);

    function makeCommitment(
        string calldata label,
        address owner,
        bytes32 secret,
        address subregistry,
        address resolver,
        uint64 duration,
        bytes32 referrer
    ) external pure returns (bytes32);

    function commitmentAt(bytes32 commitment) external view returns (uint64);

    function getRegisterPrice(string calldata label, uint64 duration, address paymentToken)
        external
        view
        returns (uint256 base, uint256 premium);

    function isAvailable(string memory label) external view returns (bool);

    function MIN_COMMITMENT_AGE() external view returns (uint64);
    function MAX_COMMITMENT_AGE() external view returns (uint64);
}

/// @notice EnhancedAccessControl read surface + the one error this script's fork tests assert on.
interface IEnhancedAccessControlV2 {
    error EACUnauthorizedAccountRoles(uint256 resource, uint256 roleBitmap, address account);

    function ROOT_RESOURCE() external view returns (uint256);
    function roles(uint256 resource, address account) external view returns (uint256);
    function hasRoles(uint256 resource, uint256 roleBitmap, address account) external view returns (bool);
}

/// @notice Write surface of a `PermissionedRegistry`-family contract (`ETHRegistry`, `RootRegistry`, and
///         the `UserRegistry` proxies this script deploys all share this ABI). Extends the pinned
///         production read surface (`IEnsV2Registry`: getSubregistry/getResolver/findOwner).
interface IUserRegistryWrite is IEnsV2Registry, IEnhancedAccessControlV2 {
    /// @dev `registry`/`resolver` are `address` here (an ABI-compatible narrowing of the real
    ///      `IRegistry`/interface-typed params — interface types encode as `address`).
    function register(
        string calldata label,
        address owner,
        address registry,
        address resolver,
        uint256 roleBitmap,
        uint64 expiry
    ) external returns (uint256 tokenId);
}

/// @notice UUPS proxy initializer for a freshly `deployProxy`'d `UserRegistry`.
interface IEACGrantInitializable {
    function initialize(Grant[] calldata grants) external;
}

/// @notice UUPS proxy initializer for a freshly `deployProxy`'d `PermissionedResolver`.
interface IPermissionedResolverInitializable {
    /// @param calls Multicalled during `initialize` (permission checks are skipped while initializing).
    function initialize(Grant[] calldata grants, bytes[] calldata calls) external;
}

/// @notice Write surface of `PermissionedResolver`. Extends the pinned production read surface
///         (`IExtendedResolver.resolve`).
interface IPermissionedResolverWrite is IExtendedResolver, IEnhancedAccessControlV2 {
    function setText(bytes calldata name, string calldata key, string calldata value) external;
    function setAddress(bytes calldata name, uint256 coinType, bytes calldata addressBytes) external;

    /// @notice Grants the role a setter's argument scopes to (e.g. `setText(_, "zone", _)` scopes
    ///         `ROLE_SET_TEXT` to the resource `keccak256("zone")`). See `PermissionedResolver.sol`'s
    ///         `decodeSetter`/`grantSetterRoles` — this is the mechanism issue #7 asks for.
    function grantSetterRoles(bytes calldata setter, address account) external returns (bool);
}

/// @notice `ensdomains/verifiable-factory` — deploys a deterministic UUPS clone proxy and initializes it
///         in one transaction (`data` is delegatecalled into `implementation` from proxy storage).
interface IVerifiableFactory {
    event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation);
    error VerificationFailed(address proxy);

    function deployProxy(address implementation, uint256 salt, bytes memory data) external returns (address proxy);
    function verifyContract(address proxy) external view returns (address implementation);
}

/// @dev Mirrors `RegistryRolesLib` (contracts/src/registry/libraries/RegistryRolesLib.sol). Roles for
///      `PermissionedRegistry`/`UserRegistry` (`ETH_REGISTRY`, `RootRegistry`, and every branch/plot
///      registry this script or issue #10 deploys).
library RegistryRoles {
    uint256 internal constant ROLE_REGISTRAR = 1 << 0;
    uint256 internal constant ROLE_REGISTRAR_ADMIN = ROLE_REGISTRAR << 128;
    uint256 internal constant ROLE_REGISTER_RESERVED = 1 << 4;
    uint256 internal constant ROLE_REGISTER_RESERVED_ADMIN = ROLE_REGISTER_RESERVED << 128;
    uint256 internal constant ROLE_SET_PARENT = 1 << 8;
    uint256 internal constant ROLE_SET_PARENT_ADMIN = ROLE_SET_PARENT << 128;
    uint256 internal constant ROLE_UNREGISTER = 1 << 12;
    uint256 internal constant ROLE_UNREGISTER_ADMIN = ROLE_UNREGISTER << 128;
    uint256 internal constant ROLE_RENEW = 1 << 16;
    uint256 internal constant ROLE_RENEW_ADMIN = ROLE_RENEW << 128;
    uint256 internal constant ROLE_SET_SUBREGISTRY = 1 << 20;
    uint256 internal constant ROLE_SET_SUBREGISTRY_ADMIN = ROLE_SET_SUBREGISTRY << 128;
    uint256 internal constant ROLE_SET_RESOLVER = 1 << 24;
    uint256 internal constant ROLE_SET_RESOLVER_ADMIN = ROLE_SET_RESOLVER << 128;
    uint256 internal constant ROLE_CAN_TRANSFER_ADMIN = (1 << 28) << 128;
    uint256 internal constant ROLE_SET_URI = 1 << 36;
    uint256 internal constant ROLE_SET_URI_ADMIN = ROLE_SET_URI << 128;
    uint256 internal constant ROLE_UPGRADE = 1 << 124;
    uint256 internal constant ROLE_UPGRADE_ADMIN = ROLE_UPGRADE << 128;

    /// @dev Roles ETHRegistrar grants a `.eth` registrant (see ETHRegistrar.sol `REGISTRATION_ROLE_BITMAP`).
    uint256 internal constant REGISTRATION_ROLE_BITMAP = ROLE_SET_SUBREGISTRY | ROLE_SET_SUBREGISTRY_ADMIN
        | ROLE_SET_RESOLVER | ROLE_SET_RESOLVER_ADMIN | ROLE_CAN_TRANSFER_ADMIN;
}

/// @dev Mirrors `PermissionedResolverLib` (contracts/src/resolver/libraries/PermissionedResolverLib.sol).
library ResolverRoles {
    uint256 internal constant ROLE_SET_ADDRESS = 1 << 0;
    uint256 internal constant ROLE_SET_ADDRESS_ADMIN = ROLE_SET_ADDRESS << 128;
    uint256 internal constant ROLE_SET_TEXT = 1 << 4;
    uint256 internal constant ROLE_SET_TEXT_ADMIN = ROLE_SET_TEXT << 128;
    uint256 internal constant ROLE_SET_CONTENTHASH = 1 << 8;
    uint256 internal constant ROLE_SET_CONTENTHASH_ADMIN = ROLE_SET_CONTENTHASH << 128;
    uint256 internal constant ROLE_SET_ABI = 1 << 12;
    uint256 internal constant ROLE_SET_ABI_ADMIN = ROLE_SET_ABI << 128;
    uint256 internal constant ROLE_SET_INTERFACE = 1 << 16;
    uint256 internal constant ROLE_SET_INTERFACE_ADMIN = ROLE_SET_INTERFACE << 128;
    uint256 internal constant ROLE_SET_NAME = 1 << 20;
    uint256 internal constant ROLE_SET_NAME_ADMIN = ROLE_SET_NAME << 128;
    uint256 internal constant ROLE_SET_DATA = 1 << 24;
    uint256 internal constant ROLE_SET_DATA_ADMIN = ROLE_SET_DATA << 128;
    uint256 internal constant ROLE_LINK = 1 << 28;
    uint256 internal constant ROLE_LINK_ADMIN = ROLE_LINK << 128;
    uint256 internal constant ROLE_UPGRADE = 1 << 124;
    uint256 internal constant ROLE_UPGRADE_ADMIN = ROLE_UPGRADE << 128;

    /// @dev Equivalent to `PermissionedResolverLib.resource(string)`: the EAC resource a `setText`/
    ///      `setData` grant for `key` is scoped to.
    function resource(string memory key) internal pure returns (uint256) {
        return uint256(keccak256(bytes(key)));
    }

    /// @dev Equivalent to `PermissionedResolverLib.resource(uint256)`: the EAC resource a `setAddress`
    ///      grant for `coinType` is scoped to.
    function resource(uint256 coinType) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(coinType)));
    }
}
