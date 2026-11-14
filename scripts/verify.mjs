import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { viewCall, viewAccount, viewKeys } from '../agents/rpc.mjs';
import { fetchSnapshot } from '../agents/posture.mjs';
import { multiplierBps } from '../sim/rules.mjs';

const DEPLOYMENTS_FILE = resolve('deployments/testnet.json');

function toNear(yocto) {
  try {
    const val = BigInt(yocto || '0');
    return (Number(val / 10000000000000000000000n) / 100).toFixed(2);
  } catch {
    return '0.00';
  }
}

async function verify() {
  if (!existsSync(DEPLOYMENTS_FILE)) {
    console.error('[ERROR] deployments/testnet.json not found. Run setup first.');
    process.exit(1);
  }

  const dep = JSON.parse(readFileSync(DEPLOYMENTS_FILE, 'utf8'));
  const pool = dep.pool;
  const walletCodeHash = dep.walletCodeHash;

  console.log('=== Backstop On-Chain Verification [TESTNET] ===\n');
  console.log(`Pool Contract: ${pool}`);
  console.log(`Wallet Code Hash: ${walletCodeHash}\n`);

  try {
    // 1. Pool Stats
    const stats = await viewCall(pool, 'get_pool_stats', {});
    const poolBal = toNear(stats.pool_balance);
    const stake = toNear(stats.total_stake);
    const cover = toNear(stats.total_cover_remaining);
    const solvency = (Number(stats.solvency_bps || 0) / 100).toFixed(2);

    console.log('--- Pool Status [TESTNET] ---');
    console.log(`Pool Balance:    ${poolBal} NEAR`);
    console.log(`Total Stake:     ${stake} NEAR`);
    console.log(`Cover Remaining: ${cover} NEAR`);
    console.log(`Solvency Ratio:  ${solvency}%`);
    console.log(`Active Members:  ${stats.active_members} / ${stats.members}`);
    console.log(`Total Claims:    ${stats.claims}`);
    console.log(`Current Epoch:   ${stats.current_epoch}\n`);

    // 2. Members & Posture Verification
    const members = await viewCall(pool, 'get_members', { from_index: 0, limit: 50 });
    console.log('--- Member Posture Audit [TESTNET] ---');
    console.log(
      '| Account | Declared | Live Verified | Multiplier | Stake (NEAR) | Cover Left (NEAR) | Match |'
    );
    console.log('|---|---|---|---|---|---|---|');

    const rpcClient = { viewCall, viewAccount, viewKeys };
    for (const m of members) {
      let verifiedScore = 0;
      let ok = false;
      try {
        const snap = await fetchSnapshot(m.account, { walletCodeHash, poolContract: pool }, rpcClient);
        verifiedScore = snap.score;
        ok = Math.abs(m.declared_score - verifiedScore) <= 10;
      } catch (err) {
        verifiedScore = 'ERR';
      }

      const mult = (multiplierBps(m.declared_score) / 100).toFixed(2) + 'x';
      const mStake = toNear(m.stake);
      const mCover = toNear(m.cover_remaining);
      const matchLabel = ok ? 'VALID' : 'MISMATCH';

      console.log(
        `| ${m.account} | ${m.declared_score} | ${verifiedScore} | ${mult} | ${mStake} | ${mCover} | ${matchLabel} |`
      );
    }
    console.log();

    // 3. Claims & Resolutions
    const claims = await viewCall(pool, 'get_claims', { from_index: 0, limit: 50 });
    console.log('--- Claims & Resolutions [TESTNET] ---');
    console.log('| ID | Claimant | Loss Amount (NEAR) | Status | Payout (NEAR) | Jury Decisions |');
    console.log('|---|---|---|---|---|---|');

    for (const c of claims) {
      const amt = toNear(c.amount);
      const payout = toNear(c.payout);
      const votes = c.jury
        .map((j) => {
          const rev = j.revealed === null ? 'NO_REVEAL' : (j.revealed ? 'YES' : 'NO');
          return `${j.juror.split('.')[0]}:${rev}`;
        })
        .join(', ');

      console.log(`| ${c.id} | ${c.claimant} | ${amt} | ${c.status} | ${payout} | ${votes} |`);
    }
    console.log();

    // 4. Recorded Transactions
    const txCount = dep.txs ? dep.txs.length : 0;
    console.log(`Recorded Transactions in deployments/testnet.json: ${txCount}`);
    console.log('\n[TESTNET] Verification completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error(`\n[ERROR] Testnet verification failed: ${err.message}`);
    process.exit(1);
  }
}

verify();
