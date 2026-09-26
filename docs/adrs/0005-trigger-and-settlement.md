# 0005: Preserve signed Trigger and settlement compatibility

Status: Accepted for the existing format. Proposed format changes remain unresolved.

## Context

Main defines Trigger in Solidity and TypeScript, with the EIP-712 `ReliefPool` v1
domain and a matching pool typehash. At review, PR #84 adds `tempC` to the interface
while its pool typehash still omits it. A passing pipeline job cannot resolve that mismatch.

## Decision

Change the struct, signed field order/types, hash construction, shared types, ABIs,
and consumers together. Keep domain/chain/address binding and signer quorum checks.
Select the existing deployed format or a coordinated new deployment through #55;
editing an ABI does not upgrade an immutable deployed pool. Preserve old receipt
interpretation and deployment history. JPYC uses 18 decimals.

## Consequences

Require matching Solidity/TypeScript digest vectors and wrong-domain/tampered-payload
tests before a format change. Settlement reads remain authoritative for Paid/Held
outcomes; submitting a transaction is not a receipt. The Reel Deal display rename
does not rename recorded ENS identifiers such as `umi.eth`.

## Evidence

[Solidity Trigger](../../contracts/src/interfaces/IReliefPool.sol),
[pool hash and settlement](../../contracts/src/ReliefPool.sol),
[TypeScript Trigger](../../packages/shared/src/trigger.ts),
[digest vector test](../../contracts/test/ReliefPoolEip712Vector.t.sol),
[#55](https://github.com/reeldeal-xyz/reeldeal/issues/55),
[PR #84 interface at review](https://github.com/reeldeal-xyz/reeldeal/blob/8d3ef636f336d00f1091336009462a828513a4e1/contracts/src/interfaces/IReliefPool.sol),
[PR #84 pool at review](https://github.com/reeldeal-xyz/reeldeal/blob/8d3ef636f336d00f1091336009462a828513a4e1/contracts/src/ReliefPool.sol).
