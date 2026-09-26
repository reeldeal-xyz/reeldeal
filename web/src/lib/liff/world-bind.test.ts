import { describe, expect, test } from 'bun:test';
import { handleWorldBind, type WorldBindDeps } from './world-bind';

const WALLET = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

function makeDeps(): { deps: WorldBindDeps; binds: [string, string][] } {
  const binds: [string, string][] = [];
  return { deps: { bindWalletToLineUser: (wallet, lineUserId) => binds.push([wallet, lineUserId]) }, binds };
}

describe('handleWorldBind', () => {
  test('rejects a missing/invalid wallet', () => {
    const { deps } = makeDeps();
    expect(handleWorldBind({}, 'U1', deps).status).toBe(400);
    expect(handleWorldBind({ wallet: 'not-an-address' }, 'U1', deps).status).toBe(400);
    expect(handleWorldBind(null, 'U1', deps).status).toBe(400);
  });

  test('binds using the caller-supplied lineUserId, ignoring any wallet-adjacent body field', () => {
    const { deps, binds } = makeDeps();
    const res = handleWorldBind({ wallet: WALLET, lineUserId: 'attacker-supplied' }, 'U-real', deps);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(binds).toEqual([[WALLET, 'U-real']]);
  });
});
