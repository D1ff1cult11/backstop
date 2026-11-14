// Stress test: run the 20-agent simulation over many seeds and report the worst cases.
//   npm run sweep            -> 200 seeds
//   npm run sweep -- --seeds 1000
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { runSim } from './engine.mjs';

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};

export function sweep(cfg, seeds) {
  const out = {
    seeds,
    days: cfg.days,
    agents: cfg.agents,
    fraud: { filed: 0, approved: 0 },
    postureLie: { filed: 0, approved: 0 },
    honest: { filed: 0, approved: 0 },
    minSolvencyBps: Infinity,
    minSolvencySeed: null,
    seedsEndingBelow100: 0,
    seedsEverBelow100: 0,
    finalBalance: { min: Infinity, median: 0, max: -Infinity },
  };
  const finals = [];

  for (let seed = 1; seed <= seeds; seed++) {
    const run = runSim({ ...cfg, seed }, seed);
    const typeOf = new Map(run.agents.map((a) => [a.id, a.type]));

    for (const c of run.claims) {
      const bucket = c.isFake ? out.fraud : typeOf.get(c.claimantId) === 'liar' ? out.postureLie : out.honest;
      bucket.filed++;
      if (c.status === 'Approved') bucket.approved++;
    }

    const low = Math.min(...run.days.map((d) => d.solvency_bps));
    if (low < out.minSolvencyBps) {
      out.minSolvencyBps = low;
      out.minSolvencySeed = seed;
    }
    if (low < 10000) out.seedsEverBelow100++;
    if (run.days.at(-1).solvency_bps < 10000) out.seedsEndingBelow100++;
    finals.push(run.totals.finalPoolBalance);
  }

  finals.sort((a, b) => a - b);
  out.finalBalance = {
    min: Math.round(finals[0]),
    median: Math.round(finals[Math.floor(finals.length / 2)]),
    max: Math.round(finals.at(-1)),
  };
  out.initialCapital = cfg.capital;
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('sweep.mjs')) {
  const cfg = JSON.parse(readFileSync(resolve('config/sim.json'), 'utf8'));
  const seeds = parseInt(flag('seeds', '200'), 10);
  const outPath = resolve(flag('out', 'web/data/sweep.json'));
  const r = sweep(cfg, seeds);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(r, null, 2)}\n`);

  const pct = (b) => (b.filed ? `${((100 * b.approved) / b.filed).toFixed(1)}%` : 'n/a');
  console.log(`[SIM] Sweep: ${r.seeds} seeds x ${r.agents} agents x ${r.days} days (no LLM calls)`);
  console.table({
    'Fraud claims (fake loss)': { filed: r.fraud.filed, approved: r.fraud.approved, rate: pct(r.fraud) },
    'Posture-lie claims': { filed: r.postureLie.filed, approved: r.postureLie.approved, rate: pct(r.postureLie) },
    'Honest claims': { filed: r.honest.filed, approved: r.honest.approved, rate: pct(r.honest) },
  });
  console.log(`[SIM] Lowest solvency on any day of any seed: ${(r.minSolvencyBps / 100).toFixed(1)}% (seed ${r.minSolvencySeed})`);
  console.log(`[SIM] Seeds that ever dropped below 100% solvency: ${r.seedsEverBelow100}/${r.seeds}; ending below 100%: ${r.seedsEndingBelow100}/${r.seeds}`);
  console.log(`[SIM] Final pool balance (start ${r.initialCapital}): min ${r.finalBalance.min}, median ${r.finalBalance.median}, max ${r.finalBalance.max}`);
  console.log(`[SIM] Wrote ${outPath}`);
}
