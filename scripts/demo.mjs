import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { runSim } from '../sim/engine.mjs';
import { sweep } from '../sim/sweep.mjs';

console.log('===============================================================');
console.log('              BACKSTOP: MUTUAL COVER FOR AI AGENTS             ');
console.log('===============================================================\n');

// 1. Simulation Phase [SIM]
const simCfgPath = resolve('config/sim.json');
const simCfg = JSON.parse(readFileSync(simCfgPath, 'utf8'));
const seed = 42;
const days = simCfg.days || 30;

const result = runSim({ ...simCfg, seed, days }, seed);
const outPath = resolve('web/data/sim-run.json');
const outDir = dirname(outPath);
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');

console.log(`[SIM] 20-agent simulation, scripted strategies, no LLM calls (${days} days, seed ${seed}):`);
const stratRows = [];
const stratNames = ['careful', 'standard', 'reckless', 'liar', 'fraudster', 'lazy'];

for (const type of stratNames) {
  const group = result.agents.filter((a) => a.type === type);
  const n = group.length;
  if (n === 0) continue;

  const avgPrem = (group.reduce((s, a) => s + a.premiumsPaid, 0) / (n * days)).toFixed(3);
  const avgNet = (group.reduce((s, a) => s + a.net, 0) / n).toFixed(2);
  const avgUnins = (group.reduce((s, a) => s + a.uninsured_net, 0) / n).toFixed(2);
  const approved = group.reduce((s, a) => s + a.claimsApproved, 0);
  const rejected = group.reduce((s, a) => s + a.claimsRejected, 0);

  stratRows.push({
    Strategy: type,
    Agents: n,
    'Avg Prem/Day': avgPrem,
    'Net (Insured)': avgNet,
    'Net (Uninsured)': avgUnins,
    'Approved / Rejected': `${approved} / ${rejected}`,
  });
}
console.table(stratRows);
console.log(
  `[SIM] Solvency: ${(result.days[result.days.length - 1].solvency_bps / 100).toFixed(1)}% | Slashes: ${result.totals.totalSlashes.toFixed(2)} units | Payouts: ${result.totals.totalPayouts.toFixed(2)} units\n`
);

// 2. Stress test across seeds [SIM]
const sw = sweep(simCfg, 200);
console.log(`[SIM] 200-seed sweep: fraud claims approved ${sw.fraud.approved}/${sw.fraud.filed}, posture-lie claims approved ${sw.postureLie.approved}/${sw.postureLie.filed}, honest claims approved ${sw.honest.approved}/${sw.honest.filed}`);
console.log(`[SIM] Lowest solvency on any day of any seed: ${(sw.minSolvencyBps / 100).toFixed(1)}%  (details: npm run sweep)
`);

// 3. Recorded testnet run [TESTNET-RECORDED]: printed from deployments/testnet.json, no network needed.
const dep = JSON.parse(readFileSync(resolve('deployments/testnet.json'), 'utf8'));
const TX = 'https://testnet.nearblocks.io/txns/';
const near = (y) => (Number(BigInt(y) / 10n ** 21n) / 1000).toFixed(2);
const short = (a) => a.split('.')[0];
const txOf = (label) => dep.txs.find((t) => t.label === label)?.hash;

console.log(`--- Recorded testnet run [TESTNET-RECORDED] (snapshot ${dep.recordedAt}) ---`);
console.log(`Pool: ${dep.pool} · wallet code hash: ${dep.walletCodeHash} · ${dep.txs.length} recorded transactions
`);
console.log('Agents (declared posture score; run "npm run verify" to recompute it live):');
for (const a of dep.agents) {
  console.log(`  ${a.account.padEnd(28)} declared ${String(a.declared).padStart(3)}  ${a.wallet ? 'policy wallet, scoped keys only' : 'plain account with a full-access key'}`);
}
console.log(`
Injected invoice -> atlas tried to pay the attacker and its own wallet refused (not on allowlist):`);
console.log(`  [TESTNET-RECORDED] ${TX}${txOf('injection_blocked_atlas')}
`);

for (const r of dep.rounds) {
  console.log(`Round ${r.round} (${r.outcome}): ${r.note}`);
  for (const id of r.claims) {
    const c = dep.recordedClaims.find((x) => x.id === id);
    const votes = c.jury
      .map((j) => `${short(j.juror)}:${j.revealed === true ? 'approve' : j.revealed === false ? 'reject' : j.committed ? 'no-reveal' : 'no-commit'}`)
      .join(' ');
    console.log(`  [TESTNET-RECORDED] claim ${String(c.id).padStart(2)} ${short(c.claimant).padEnd(5)} loss ${near(c.amount)} -> ${c.status.padEnd(8)} payout ${near(c.payout)}  | ${votes}`);
    if (r.outcome === 'Resolved') {
      console.log(`      loss tx ${TX}${c.loss_tx_hash}`);
      const res = txOf(`resolve_claim_${c.id}`);
      if (res) console.log(`      resolve ${TX}${res}`);
    }
  }
  console.log();
}
for (const n of dep.notes) console.log(`Note: ${n}`);

console.log('\n===============================================================');
console.log('Next: npm run verify (live, read-only) · npm run web (dashboard)');
console.log('===============================================================');
