import test from 'node:test';
import assert from 'node:assert';
import {
  multiplierBps,
  premiumPerEpoch,
  stakeFor,
  claimBond,
  postureOk,
  resolve,
} from '../sim/rules.mjs';

const testnetCfg = {
  base_premium_bps: 100,
  min_stake_bps: 2000,
  deductible_bps: 2000,
  max_payout_bps: 5000,
  claim_bond_bps: 1000,
  min_claim_bond: 0.05,
  jury_size: 4,
};

const simCfg = {
  base_premium_bps: 40,
  min_stake_bps: 2000,
  deductible_bps: 2000,
  max_payout_bps: 5000,
  claim_bond_bps: 1000,
  min_claim_bond: 0.5,
  jury_size: 5,
};

test('multiplierBps', () => {
  assert.strictEqual(multiplierBps(0), 30000);
  assert.strictEqual(multiplierBps(50), 17500);
  assert.strictEqual(multiplierBps(100), 5000);
});

test('premium scaling mirrors Rust tests', () => {
  const cover = 100;
  assert.strictEqual(premiumPerEpoch(cover, 0, testnetCfg), 3.0);
  assert.strictEqual(premiumPerEpoch(cover, 50, testnetCfg), 1.75);
  assert.strictEqual(premiumPerEpoch(cover, 100, testnetCfg), 0.5);

  assert.strictEqual(premiumPerEpoch(cover, 0, simCfg), 1.2);
  assert.strictEqual(premiumPerEpoch(cover, 50, simCfg), 0.7);
  assert.strictEqual(premiumPerEpoch(cover, 100, simCfg), 0.2);
});

test('stakeFor, claimBond, postureOk', () => {
  assert.strictEqual(stakeFor(100, simCfg), 20);
  assert.strictEqual(claimBond(10, simCfg), 1.0);
  assert.strictEqual(claimBond(2, simCfg), 0.5);
  assert.strictEqual(postureOk(90, 80, 10), true);
  assert.strictEqual(postureOk(95, 80, 10), false);
});

test('resolve: approved with payout caps', () => {
  const juryAll = ['j1', 'j2', 'j3', 'j4', 'j5'];
  const votes = [
    { juror: 'j1', approve: true }, { juror: 'j2', approve: true }, { juror: 'j3', approve: true },
    { juror: 'j4', approve: false }, { juror: 'j5', approve: false },
  ];
  const res = resolve({ votes, juryAll, amount: 50, coverRemaining: 100, poolBalance: 1000, cfg: simCfg });
  assert.strictEqual(res.status, 'Approved');
  assert.strictEqual(res.payout, 40); // cap1 = 50 * 0.8 = 40
  assert.deepStrictEqual(res.coherent, ['j1', 'j2', 'j3']);
  assert.deepStrictEqual(res.slashed, ['j4', 'j5']);
});

test('resolve: rejected outcome', () => {
  const juryAll = ['j1', 'j2', 'j3', 'j4', 'j5'];
  const votes = [
    { juror: 'j1', approve: true }, { juror: 'j2', approve: false },
    { juror: 'j3', approve: false }, { juror: 'j4', approve: false }, { juror: 'j5', approve: false },
  ];
  const res = resolve({ votes, juryAll, amount: 50, coverRemaining: 100, poolBalance: 1000, cfg: simCfg });
  assert.strictEqual(res.status, 'Rejected');
  assert.strictEqual(res.payout, 0);
  assert.deepStrictEqual(res.coherent, ['j2', 'j3', 'j4', 'j5']);
});

test('resolve: tie means rejected', () => {
  const juryAll = ['j1', 'j2', 'j3', 'j4', 'j5'];
  const votes = [
    { juror: 'j1', approve: true }, { juror: 'j2', approve: true },
    { juror: 'j3', approve: false }, { juror: 'j4', approve: false },
  ];
  const res = resolve({ votes, juryAll, amount: 50, coverRemaining: 100, poolBalance: 1000, cfg: simCfg });
  assert.strictEqual(res.status, 'Rejected');
  assert.strictEqual(res.payout, 0);
  assert.deepStrictEqual(res.coherent, ['j3', 'j4']);
  assert.deepStrictEqual(res.slashed, ['j1', 'j2', 'j5']);
});

test('resolve: void threshold', () => {
  const juryAll = ['j1', 'j2', 'j3', 'j4', 'j5'];
  const votes = [{ juror: 'j1', approve: true }, { juror: 'j2', approve: true }];
  const res = resolve({ votes, juryAll, amount: 50, coverRemaining: 100, poolBalance: 1000, cfg: simCfg });
  assert.strictEqual(res.status, 'Void');
  assert.strictEqual(res.payout, 0);
  assert.deepStrictEqual(res.slashed, ['j3', 'j4', 'j5']);
});
