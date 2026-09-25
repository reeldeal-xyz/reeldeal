// OWNER: Jay. Sign each Trigger with the pipeline key using TRIGGER_EIP712_TYPES and eip712Domain(ReliefPool)
// from @umi/shared, and append { signer, signature } to out/triggers-*.json. The app's keeper collects a second
// signature and submits attest().
export {};
