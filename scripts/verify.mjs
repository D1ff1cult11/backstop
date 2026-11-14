// Keyless, read-only verification against NEAR testnet.
//   npm run verify                      -> pool, bytecode, posture and claims
//   npm run verify -- --account <id>    -> posture score and premium quote for any account
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { viewCall, viewAccount, viewKeys } from '../agents/rpc.mjs';
import { fetchSnapshot } from '../agents/posture.mjs';
import { multiplierBps, premiumPerEpoch, postureOk } from '../sim/rules.mjs';

const DEPLOYMENTS_FILE = resolve('deployments/testnet.json');
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const rpc = { viewCall, viewAccount, viewKeys };

const toNear = (yocto, dp = 2) => (Number(BigInt(yocto || '0') / 10n ** 18n) / 1e6).toFixed(dp);
const short = (account) => account.split('.')[0];
const multLabel = (score) => `${(multiplierBps(score) / 10000).toFixed(2)}x`;

function base58(buf) {
  let n = BigInt(`0x${buf.toString('hex')}`);
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  return out;
}

// NEAR's code_hash is base58(sha256(wasm)), so the repo's wasm can be compared directly.
const wasmHash = (name) => base58(createHash('sha256').update(readFileSync(resolve(`wasm/${name}.wasm`))).digest());

async function scoreAccount(account, dep) {
  const cfg = JSON.parse(readFileSync(resolve('config/testnet.json'), 'utf8'));
  const snap = await fetchSnapshot(account, { walletCodeHash: dep.walletCodeHash, poolContract: dep.pool }, rpc);
  console.log(`=== Posture of ${account} [TESTNET] ===\n`);
  for (const s of snap.signals) {
    console.log(`  ${s.ok ? '[x]' : '[ ]'} ${String(s.ok ? s.points : 0).padStart(2)}/${s.points}  ${s.name} — ${s.detail}`);
  }
  const quote = premiumPerEpoch(1, snap.score, cfg);
  const worst = premiumPerEpoch(1, 0, cfg);
  console.log(`\n  Score: ${snap.score}/100   premium multiplier: ${multLabel(snap.score)}`);
  console.log(`  Quote for 1 NEAR of cover: ${quote.toFixed(4)} NEAR per epoch (a score-0 account pays ${worst.toFixed(4)})`);
}

async function verifyBytecode(dep) {
  console.log('--- Deployed code vs this repo [TESTNET] ---');
  const targets = [[dep.pool, 'pool'], ...dep.agents.filter((a) => a.wallet).map((a) => [a.account, 'wallet'])];
  let allOk = true;
  for (const [account, name] of targets) {
    const onChain = (await viewAccount(account)).code_hash;
    const ok = onChain === wasmHash(name);
    allOk &&= ok;
    console.log(`  ${ok ? 'MATCH   ' : 'MISMATCH'} ${account}  code_hash ${onChain}  ${ok ? '==' : '!='} sha256(wasm/${name}.wasm)`);
  }
  const poolKeys = (await viewKeys(dep.pool)).keys || [];
  console.log(
    poolKeys.length === 0
      ? `  LOCKED   ${dep.pool} has 0 access keys: nobody can upgrade it or move its funds.`
      : `  NOTE     ${dep.pool} has ${poolKeys.length} access key(s): the deployer can still upgrade it.`
  );
  console.log();
  return allOk;
}

async function verifyMembers(dep) {
  const members = await viewCall(dep.pool, 'get_members', { from_index: 0, limit: 50 });
  console.log('--- Member posture: declared vs recomputed from chain state [TESTNET] ---');
  console.log('| Account | Declared | Verified | Premium multiplier | Stake (NEAR) | Cover left (NEAR) | Claimable? |');
  console.log('|---|---|---|---|---|---|---|');
  for (const m of members) {
    let verified = 'ERR';
    let ok = false;
    try {
      const snap = await fetchSnapshot(m.account, { walletCodeHash: dep.walletCodeHash, poolContract: dep.pool }, rpc);
      verified = snap.score;
      ok = postureOk(m.declared_score, snap.score, 10);
    } catch {
      // An unreachable account is reported as ERR and never treated as valid.
    }
    console.log(
      `| ${m.account} | ${m.declared_score} | ${verified} | ${multLabel(m.declared_score)} | ${toNear(m.stake, 3)} | ${toNear(m.cover_remaining)} | ${ok ? 'yes' : 'NO: declared > verified + 10'} |`
    );
  }
  console.log();
}

function voteLabel(j) {
  if (j.revealed === true) return 'approve';
  if (j.revealed === false) return 'reject';
  return j.commitment ? 'no reveal' : 'no commit';
}

async function verifyClaims(dep) {
  const claims = await viewCall(dep.pool, 'get_claims', { from_index: 0, limit: 100 });
  const byId = new Map(claims.map((c) => [c.id, c]));
  console.log('--- Claims, all rounds [TESTNET] ---');
  for (const r of dep.rounds || [{ round: 1, claims: claims.map((c) => c.id), note: '' }]) {
    console.log(`Round ${r.round}: ${r.note}`);
    console.log('| Claim | Claimant | Loss (NEAR) | Status | Payout (NEAR) | Jury |');
    console.log('|---|---|---|---|---|---|');
    for (const id of r.claims) {
      const c = byId.get(id);
      if (!c) continue;
      const jury = c.jury.map((j) => `${short(j.juror)}: ${voteLabel(j)}`).join(', ');
      console.log(`| ${c.id} | ${short(c.claimant)} | ${toNear(c.amount)} | ${c.status} | ${toNear(c.payout)} | ${jury} |`);
    }
    console.log();
  }
  for (const note of dep.notes || []) console.log(`Note: ${note}`);
  console.log();
}

async function main() {
  if (!existsSync(DEPLOYMENTS_FILE)) throw new Error('deployments/testnet.json not found');
  const dep = JSON.parse(readFileSync(DEPLOYMENTS_FILE, 'utf8'));

  const flag = process.argv.indexOf('--account');
  if (flag !== -1) {
    if (!process.argv[flag + 1]) throw new Error('usage: npm run verify -- --account <account.testnet>');
    return scoreAccount(process.argv[flag + 1], dep);
  }

  console.log('=== Backstop on-chain verification [TESTNET] (read-only, no keys) ===\n');
  const stats = await viewCall(dep.pool, 'get_pool_stats', {});
  console.log(`--- Pool ${dep.pool} [TESTNET] ---`);
  console.log(`  Balance ${toNear(stats.pool_balance)} NEAR · stake held ${toNear(stats.total_stake)} NEAR · cover outstanding ${toNear(stats.total_cover_remaining)} NEAR`);
  console.log(`  Solvency ${(stats.solvency_bps / 100).toFixed(1)}% · active members ${stats.active_members}/${stats.members} · claims ${stats.claims} · epoch ${stats.current_epoch}\n`);

  const bytecodeOk = await verifyBytecode(dep);
  await verifyMembers(dep);
  await verifyClaims(dep);

  console.log(`Recorded transactions in deployments/testnet.json: ${dep.txs.length}`);
  console.log(bytecodeOk ? '[TESTNET] Verification completed.' : '[TESTNET] Verification completed with a bytecode MISMATCH.');
  if (!bytecodeOk) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\n[ERROR] Testnet verification failed: ${err.message}`);
  console.error('This command needs network access to https://test.rpc.fastnear.com');
  process.exit(1);
});
