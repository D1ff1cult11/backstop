import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { scoreFromSnapshot } from '../agents/posture.mjs';

function loadFixture(name) {
  return JSON.parse(readFileSync(`test/fixtures/${name}.json`, 'utf8'));
}

const envOpts = {
  walletCodeHash: 'WALLET_HASH_TEST',
  poolContract: 'pool.testnet',
};

test('a full-access plain account scores 0', () => {
  const fix = loadFixture('plain_full_access');
  const res = scoreFromSnapshot({ ...fix, ...envOpts });
  assert.strictEqual(res.score, 0);
  assert.strictEqual(res.signals[0].ok, false); // no wallet
  assert.strictEqual(res.signals[1].ok, false); // has full access
});

test('a careful wallet with an allowlist and a 20% cap scores 100', () => {
  const fix = loadFixture('wallet_careful_100');
  const res = scoreFromSnapshot({ ...fix, ...envOpts });
  assert.strictEqual(res.score, 100);
  assert(res.signals.every((s) => s.ok));
});

test('a wallet with no allowlist and a 20% cap scores 90', () => {
  const fix = loadFixture('wallet_no_allowlist_90');
  const res = scoreFromSnapshot({ ...fix, ...envOpts });
  assert.strictEqual(res.score, 90);
  assert.strictEqual(res.signals[4].ok, false); // allowlist off
});

test('a wallet with a cap above 25% and no allowlist scores 70', () => {
  const fix = loadFixture('wallet_high_cap_70');
  const res = scoreFromSnapshot({ ...fix, ...envOpts });
  assert.strictEqual(res.score, 70);
  assert.strictEqual(res.signals[3].ok, false); // cap > 25%
  assert.strictEqual(res.signals[4].ok, false); // allowlist off
});

test('a wallet that still has a full-access key scores 40', () => {
  const fix = loadFixture('wallet_with_full_access_40');
  const res = scoreFromSnapshot({ ...fix, ...envOpts });
  assert.strictEqual(res.score, 40);
  assert.strictEqual(res.signals[0].ok, true); // wallet deployed (+30)
  assert.strictEqual(res.signals[1].ok, false); // has full-access (0)
  assert.strictEqual(res.signals[2].ok, true); // scoped func key (+10)
  assert.strictEqual(res.signals[3].ok, false); // cap > 25% (0)
  assert.strictEqual(res.signals[4].ok, false); // allowlist off (0)
});
