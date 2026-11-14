import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runSim } from './engine.mjs';

const args = process.argv.slice(2);
function getArg(name, def) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
}

const cfgPath = resolve('config/sim.json');
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));

const seed = parseInt(getArg('seed', cfg.seed || 42), 10);
const days = parseInt(getArg('days', cfg.days || 30), 10);
const outPath = resolve(getArg('out', 'web/data/sim-run.json'));

const simCfg = { ...cfg, days, seed };
const result = runSim(simCfg, seed);

const outDir = dirname(outPath);
if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');

console.log(`[SIM] Backstop 20-Agent Simulation (${days} days, seed ${seed})`);
console.log(`[SIM] Wrote results to ${outPath}\n`);

// Table per strategy
const stratNames = ['careful', 'standard', 'reckless', 'liar', 'fraudster', 'lazy'];
const stratRows = [];

for (const type of stratNames) {
  const group = result.agents.filter((a) => a.type === type);
  const n = group.length;
  if (n === 0) continue;

  const avgPrem = (group.reduce((s, a) => s + a.premiumsPaid, 0) / (n * days)).toFixed(3);
  const avgNet = (group.reduce((s, a) => s + a.net, 0) / n).toFixed(2);
  const avgUninsured = (group.reduce((s, a) => s + a.uninsured_net, 0) / n).toFixed(2);
  const approved = group.reduce((s, a) => s + a.claimsApproved, 0);
  const rejected = group.reduce((s, a) => s + a.claimsRejected, 0);

  stratRows.push({
    Strategy: type,
    Count: n,
    'Avg Prem/Day': avgPrem,
    'Avg Net': avgNet,
    'Avg Unins Net': avgUninsured,
    'Claims App/Rej': `${approved}/${rejected}`,
  });
}

console.log('[SIM] Strategy Breakdown:');
console.table(stratRows);

const d0Solv = (simCfg.capital * 10000 / (20 * 100)) / 100; // initial pool capital / active cover
const d15 = result.days.find((d) => d.day === 15);
const d30 = result.days.find((d) => d.day === days);

console.log('[SIM] Solvency Milestones:');
console.log(`  Day 0 : ${d0Solv.toFixed(1)}%`);
if (d15) console.log(`  Day 15: ${(d15.solvency_bps / 100).toFixed(1)}% (balance: ${d15.pool_balance.toFixed(1)})`);
if (d30) console.log(`  Day ${days}: ${(d30.solvency_bps / 100).toFixed(1)}% (balance: ${d30.pool_balance.toFixed(1)})`);

console.log(`\n[SIM] Total Slashes: ${result.totals.totalSlashes.toFixed(2)} units`);
console.log(`[SIM] Total Payouts: ${result.totals.totalPayouts.toFixed(2)} units`);
