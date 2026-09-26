// GET /api/wallet-auth/nonce -- first step of wallet sign-in (Reown AppKit connects the wallet, then this
// SIWE dance proves it holds the key): a single-use nonce the client folds into the EIP-4361 message it asks
// the wallet to sign. See lib/siwe.ts for the store and lib/wallet-auth.ts for the verify step.
import { NextResponse } from 'next/server';
import { issueNonce } from '@/lib/siwe';

export async function GET() {
  return NextResponse.json({ nonce: issueNonce() });
}
