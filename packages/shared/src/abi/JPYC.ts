// Minimal JPYC ABI for the LIFF in-app wallet (issue #15 wallet management): balance reads, Transfer
// event logs, the EIP-3009 gasless-transfer surface (`transferWithAuthorization` + `authorizationState`),
// and (Reown wallet login) the plain ERC20 `transfer` a connected external wallet can call directly, paying
// its own gas, as an alternative to the gasless relay. Hand-picked from the deployed proxy at
// packages/shared/src/addresses.ts's JPYC -- not the full JPYC/FiatToken ABI (no mint/burn/pause/admin
// surface here; this app never needs it).
//
// Verified live against the Sepolia proxy (0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29), 2026-09-26:
// name() -> "JPY Coin", symbol() -> "JPYC", decimals() -> 18. `transferWithAuthorization` and
// `authorizationState`/`nonces` all respond (see JPYC_EIP712_DOMAIN in addresses.ts for how the EIP-712
// domain used to sign transferWithAuthorization was verified).
export const JpycAbi = [
  {
    "type": "function",
    "name": "name",
    "inputs": [],
    "outputs": [{ "name": "", "type": "string", "internalType": "string" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "symbol",
    "inputs": [],
    "outputs": [{ "name": "", "type": "string", "internalType": "string" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "decimals",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint8", "internalType": "uint8" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "balanceOf",
    "inputs": [{ "name": "account", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "nonces",
    "inputs": [{ "name": "owner", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "authorizationState",
    "inputs": [
      { "name": "authorizer", "type": "address", "internalType": "address" },
      { "name": "nonce", "type": "bytes32", "internalType": "bytes32" }
    ],
    "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "transferWithAuthorization",
    "inputs": [
      { "name": "from", "type": "address", "internalType": "address" },
      { "name": "to", "type": "address", "internalType": "address" },
      { "name": "value", "type": "uint256", "internalType": "uint256" },
      { "name": "validAfter", "type": "uint256", "internalType": "uint256" },
      { "name": "validBefore", "type": "uint256", "internalType": "uint256" },
      { "name": "nonce", "type": "bytes32", "internalType": "bytes32" },
      { "name": "v", "type": "uint8", "internalType": "uint8" },
      { "name": "r", "type": "bytes32", "internalType": "bytes32" },
      { "name": "s", "type": "bytes32", "internalType": "bytes32" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "transfer",
    "inputs": [
      { "name": "to", "type": "address", "internalType": "address" },
      { "name": "value", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "Transfer",
    "inputs": [
      { "name": "from", "type": "address", "indexed": true, "internalType": "address" },
      { "name": "to", "type": "address", "indexed": true, "internalType": "address" },
      { "name": "value", "type": "uint256", "indexed": false, "internalType": "uint256" }
    ],
    "anonymous": false
  }
] as const;
