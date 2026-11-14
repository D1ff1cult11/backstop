import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { runSim } from '../sim/engine.mjs';

const cfg = JSON.parse(readFileSync('config/sim.json', 'utf8'));

test('sim invariants with seed 42', () => {
  const res = runSim(cfg, 42);

  // 1. pool_balance >= 0 every day
  for (const day of res.days) {
    assert(day.pool_balance >= 0, `pool balance negative on day ${day.day}: ${day.pool_balance}`);
  }

  // 2. conservation: sum of balances, stakes, bondReserved, losses and pool is constant
  const initialTotal = cfg.agents * 200 + cfg.capital;
  const totalBalances = res.agents.reduce((s, a) => s + a.balance, 0);
  const totalStakes = res.agents.reduce((s, a) => s + a.stake + a.bondReserved, 0);
  const totalLosses = res.agents.reduce((s, a) => s + a.losses, 0);
  const finalTotal = totalBalances + totalStakes + totalLosses + res.totals.finalPoolBalance;

  const relDiff = Math.abs(finalTotal - initialTotal) / initialTotal;
  assert(relDiff <= 1e-9, `conservation failed: relative diff ${relDiff}`);

  // 3. liar approved claims = 0
  const liars = res.agents.filter((a) => a.type === 'liar');
  const liarApproved = liars.reduce((s, a) => s + a.claimsApproved, 0);
  assert.strictEqual(liarApproved, 0, 'liars must have 0 approved claims');

  // 4. fraudster approved claims = 0
  const fraudsters = res.agents.filter((a) => a.type === 'fraudster');
  const fraudsterApproved = fraudsters.reduce((s, a) => s + a.claimsApproved, 0);
  assert.strictEqual(fraudsterApproved, 0, 'fraudsters must have 0 approved claims');

  // 5. lazy jurors slashed > 0
  const lazy = res.agents.filter((a) => a.type === 'lazy');
  const lazySlashes = lazy.reduce((s, a) => s + a.slashes, 0);
  assert(lazySlashes > 0, 'lazy jurors must be slashed');

  // 6. average premium per day of careful is below reckless
  const careful = res.agents.filter((a) => a.type === 'careful');
  const reckless = res.agents.filter((a) => a.type === 'reckless');
  const avgPremCareful = careful.reduce((s, a) => s + a.premiumsPaid, 0) / (careful.length * cfg.days);
  const avgPremReckless = reckless.reduce((s, a) => s + a.premiumsPaid, 0) / (reckless.length * cfg.days);
  assert(avgPremCareful < avgPremReckless, `careful premium (${avgPremCareful}) not below reckless (${avgPremReckless})`);

  // 7. day 30 solvency >= 50% (5000 bps)
  const d30 = res.days[res.days.length - 1];
  assert(d30.solvency_bps >= 5000, `day 30 solvency (${d30.solvency_bps} bps) below 5000 bps`);
});
