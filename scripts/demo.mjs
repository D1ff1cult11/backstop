import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { runSim } from '../sim/engine.mjs';

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

console.log(`[SIM] 20-Agent Discrete-Event Simulation (${days} days, seed ${seed}):`);
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

// 2. Recorded Testnet Phase [TESTNET-RECORDED]
const depPath = resolve('deployments/testnet.json');
if (existsSync(depPath)) {
  const dep = JSON.parse(readFileSync(depPath, 'utf8'));
  console.log('--- Recorded Testnet Incident & Jury Round [TESTNET-RECORDED] ---');
  console.log(`Pool Contract: ${dep.pool}`);
  console.log(`Wallet Code Hash: ${dep.walletCodeHash}\n`);

  console.log('Agents on NEAR Testnet:');
  const agentRows = [
    { Agent: 'atlas', Account: `atlas.${dep.root}`, Type: 'Policy Wallet + Allowlist', Declared: 100, Verified: 100 },
    { Agent: 'bea', Account: `bea.${dep.root}`, Type: 'Policy Wallet (No Allowlist)', Declared: 90, Verified: 90 },
    { Agent: 'eve', Account: `eve.${dep.root}`, Type: 'Policy Wallet (High Cap, Lazy)', Declared: 70, Verified: 70 },
    { Agent: 'cato', Account: `cato.${dep.root}`, Type: 'Plain Account (Full Access Key)', Declared: 0, Verified: 0 },
    { Agent: 'dex', Account: `dex.${dep.root}`, Type: 'Plain Account (Posture Liar)', Declared: 95, Verified: 0 },
  ];
  console.table(agentRows);

  console.log('\nKey On-Chain Transactions:');
  const importantLabels = [
    'injection_blocked_atlas',
    'loss_tx_bea_round',
    'loss_tx_cato_round',
    'loss_tx_dex_round',
    'file_claim_bea_round',
    'file_claim_cato_round',
    'file_claim_dex_round',
    'resolve_claim_12',
    'resolve_claim_13',
    'resolve_claim_14',
  ];

  for (const label of importantLabels) {
    const tx = dep.txs?.find((t) => t.label === label);
    if (tx) {
      console.log(`  [TESTNET-RECORDED] ${tx.label.padEnd(25)} https://testnet.nearblocks.io/txns/${tx.hash}`);
    }
  }

  console.log('\nIncident & Jury Verdict Summary:');
  console.log('  - Atlas (Policy Wallet + Allowlist): Attack BLOCKED by policy wallet. Zero loss.');
  console.log('  - Bea (Policy Wallet, No Allowlist): 0.20 NEAR loss. Posture verified (90). Claim #12 APPROVED -> 0.16 NEAR payout.');
  console.log('  - Cato (Plain Account, Honest Score 0): 0.80 NEAR loss. Posture verified (0). Claim #13 APPROVED -> 0.64 NEAR payout.');
  console.log('  - Dex (Plain Account, Declared 95 Liar): 0.60 NEAR loss. Posture verified (0 != 95). Claim #14 REJECTED -> 0.00 NEAR payout.');
  console.log('  - Eve (Lazy Juror): Committed votes on all claims, but failed to reveal. Slashed 3 times on-chain.\n');
}

console.log('===============================================================');
console.log('Next: npm run verify (live, read-only) · npm run web (dashboard)');
console.log('===============================================================');
