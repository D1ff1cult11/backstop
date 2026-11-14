import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  call,
  deploy,
  sendNear,
  createSubAccount,
  addFunctionCallKey,
  listKeys,
  deleteKey,
} from '../agents/cli.mjs';
import { viewAccount, viewCall, viewKeys } from '../agents/rpc.mjs';
import { premiumPerEpoch, stakeFor } from '../sim/rules.mjs';

const ROOT = 'backstop-hq.testnet';
const FUNDER = 'backstop-fund.testnet';
const POOL = `pool.${ROOT}`;
const MERCHANT = `merchant.${ROOT}`;
const MALLORY = `mallory.${ROOT}`;
const NETWORK = 'testnet';

const AGENTS = [
  {
    name: 'atlas',
    account: `atlas.${ROOT}`,
    funding: '2.2',
    wallet: true,
    policy: {
      per_tx_cap: '200000000000000000000000', // 0.2 NEAR
      daily_cap: '500000000000000000000000',  // 0.5 NEAR
      allowlist_enabled: true,
      allowlist: [MERCHANT],
    },
    declared: 100,
    expectedVerified: 100,
  },
  {
    name: 'bea',
    account: `bea.${ROOT}`,
    funding: '2.2',
    wallet: true,
    policy: {
      per_tx_cap: '200000000000000000000000', // 0.2 NEAR
      daily_cap: '500000000000000000000000',  // 0.5 NEAR
      allowlist_enabled: false,
      allowlist: [],
    },
    declared: 90,
    expectedVerified: 90,
  },
  {
    name: 'eve',
    account: `eve.${ROOT}`,
    funding: '2.2',
    wallet: true,
    policy: {
      per_tx_cap: '1000000000000000000000000', // 1.0 NEAR
      daily_cap: '2000000000000000000000000',  // 2.0 NEAR
      allowlist_enabled: false,
      allowlist: [],
    },
    declared: 70,
    expectedVerified: 70,
  },
  {
    name: 'cato',
    account: `cato.${ROOT}`,
    funding: '1.4',
    wallet: false,
    policy: null,
    declared: 0,
    expectedVerified: 0,
  },
  {
    name: 'dex',
    account: `dex.${ROOT}`,
    funding: '1.4',
    wallet: false,
    policy: null,
    declared: 95,
    expectedVerified: 0, // liar
  },
];

const POOL_WASM = resolve('wasm/pool.wasm');
const WALLET_WASM = resolve('wasm/wallet.wasm');
const CONFIG_FILE = resolve('config/testnet.json');
const DEPLOYMENTS_DIR = resolve('deployments');
const DEPLOYMENTS_FILE = join(DEPLOYMENTS_DIR, 'testnet.json');

function loadDeployments() {
  if (existsSync(DEPLOYMENTS_FILE)) {
    try {
      return JSON.parse(readFileSync(DEPLOYMENTS_FILE, 'utf8'));
    } catch {
      // fallback
    }
  }
  return {
    network: NETWORK,
    root: ROOT,
    pool: POOL,
    merchant: MERCHANT,
    mallory: MALLORY,
    agents: AGENTS.map((a) => ({
      account: a.account,
      declared: a.declared,
      wallet: a.wallet,
    })),
    walletCodeHash: '3xM3YDs44aRso3b3hVo5KVdRKCatqkUMFwnpxBTXtFYW',
    poolCodeHash: 'EDWJAJnJgCKtRxdg1Sns1onoWvQdfepAUEdGw46F5zFa',
    txs: [],
  };
}

function saveDeployments(dep) {
  if (!existsSync(DEPLOYMENTS_DIR)) {
    mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  }
  writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(dep, null, 2));
}

function recordTx(dep, label, hash) {
  if (!hash) return;
  const existing = dep.txs.find((t) => t.hash === hash);
  if (!existing) {
    dep.txs.push({
      label,
      hash,
      at: new Date().toISOString(),
    });
    saveDeployments(dep);
  }
}

async function accountExists(acct) {
  try {
    const info = await viewAccount(acct);
    return !!info;
  } catch {
    return false;
  }
}

async function getAccountBalanceNear(acct) {
  try {
    const info = await viewAccount(acct);
    return Number(BigInt(info.amount) / 10000000000000000000000n) / 100;
  } catch {
    return 0;
  }
}

export async function runSetup({ deleteFullAccess = false } = {}) {
  const dep = loadDeployments();
  const testnetCfg = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));

  console.log('--- Backstop Testnet Setup ---');

  // 1. Funding root if < 15 NEAR
  const rootBal = await getAccountBalanceNear(ROOT);
  console.log(`Root ${ROOT} balance: ~${rootBal.toFixed(2)} NEAR`);
  if (rootBal < 15) {
    console.log(`Sending 9.5 NEAR from funder ${FUNDER} to ${ROOT}...`);
    const res = sendNear(FUNDER, ROOT, '9.5');
    if (!res.ok) throw new Error(`Failed to fund root: ${res.out}`);
    console.log(`[TESTNET] Funded root: tx ${res.txHash}`);
    recordTx(dep, 'fund_root', res.txHash);
  }

  // 2. Create pool account and deploy pool contract
  const poolExists = await accountExists(POOL);
  if (!poolExists) {
    console.log(`Creating pool account ${POOL}...`);
    const res = createSubAccount(POOL, ROOT, '3');
    if (!res.ok) throw new Error(`Failed to create pool account: ${res.out}`);
    console.log(`[TESTNET] Created pool account: tx ${res.txHash}`);
    recordTx(dep, 'create_pool_account', res.txHash);
  }

  // Check if pool contract deployed
  const poolInfo = await viewAccount(POOL);
  if (poolInfo.code_hash === '11111111111111111111111111111111') {
    console.log(`Deploying pool contract to ${POOL}...`);
    const dRes = deploy(POOL, POOL_WASM);
    if (!dRes.ok) throw new Error(`Failed to deploy pool: ${dRes.out}`);
    console.log(`[TESTNET] Deployed pool contract: tx ${dRes.txHash}`);
    recordTx(dep, 'deploy_pool', dRes.txHash);

    console.log(`Initializing pool contract with ${CONFIG_FILE}...`);
    const iRes = call(POOL, 'new', { config: testnetCfg }, { signer: ROOT });
    if (!iRes.ok) throw new Error(`Failed to initialize pool: ${iRes.out}`);
    console.log(`[TESTNET] Initialized pool: tx ${iRes.txHash}`);
    recordTx(dep, 'init_pool', iRes.txHash);
  }

  // 3. Fund pool with 3 NEAR
  try {
    const stats = await viewCall(POOL, 'get_pool_stats', {});
    const balance = BigInt(stats.pool_balance);
    if (balance === 0n) {
      console.log(`Funding pool with 3 NEAR from ${ROOT}...`);
      const fRes = call(POOL, 'fund_pool', {}, { signer: ROOT, deposit: '3 NEAR' });
      if (!fRes.ok) throw new Error(`Failed to fund pool: ${fRes.out}`);
      console.log(`[TESTNET] Funded pool: tx ${fRes.txHash}`);
      recordTx(dep, 'fund_pool', fRes.txHash);
    } else {
      console.log(`Pool already funded with ${stats.pool_balance} yocto`);
    }
  } catch (err) {
    console.warn(`Could not check pool balance: ${err.message}`);
  }

  // 4. Create merchant and mallory accounts
  for (const acct of [MERCHANT, MALLORY]) {
    const exists = await accountExists(acct);
    if (!exists) {
      console.log(`Creating subaccount ${acct}...`);
      const res = createSubAccount(acct, ROOT, '0.1');
      if (!res.ok) throw new Error(`Failed to create ${acct}: ${res.out}`);
      console.log(`[TESTNET] Created ${acct}: tx ${res.txHash}`);
      recordTx(dep, `create_${acct}`, res.txHash);
    }
  }

  // 5. Create agent accounts
  for (const agent of AGENTS) {
    const exists = await accountExists(agent.account);
    if (!exists) {
      console.log(`Creating agent account ${agent.account} with ${agent.funding} NEAR...`);
      const res = createSubAccount(agent.account, ROOT, agent.funding);
      if (!res.ok) throw new Error(`Failed to create agent ${agent.account}: ${res.out}`);
      console.log(`[TESTNET] Created agent ${agent.account}: tx ${res.txHash}`);
      recordTx(dep, `create_${agent.name}`, res.txHash);
    }
  }

  // 6. Deploy wallet contracts for wallet agents
  for (const agent of AGENTS) {
    if (!agent.wallet) continue;
    const info = await viewAccount(agent.account);
    if (info.code_hash === '11111111111111111111111111111111') {
      console.log(`Deploying wallet contract to ${agent.account}...`);
      const dRes = deploy(agent.account, WALLET_WASM);
      if (!dRes.ok) throw new Error(`Failed to deploy wallet on ${agent.account}: ${dRes.out}`);
      console.log(`[TESTNET] Deployed wallet to ${agent.account}: tx ${dRes.txHash}`);
      recordTx(dep, `deploy_wallet_${agent.name}`, dRes.txHash);

      console.log(`Initializing policy wallet on ${agent.account}...`);
      const initArgs = {
        owner: ROOT,
        per_tx_cap: agent.policy.per_tx_cap,
        daily_cap: agent.policy.daily_cap,
        allowlist_enabled: agent.policy.allowlist_enabled,
        allowlist: agent.policy.allowlist,
      };
      const iRes = call(agent.account, 'new', initArgs, { signer: ROOT });
      if (!iRes.ok) throw new Error(`Failed to init wallet on ${agent.account}: ${iRes.out}`);
      console.log(`[TESTNET] Initialized wallet on ${agent.account}: tx ${iRes.txHash}`);
      recordTx(dep, `init_wallet_${agent.name}`, iRes.txHash);
    }
  }

  // 7. Every agent calls join
  const coverYocto = 1000000000000000000000000; // 1 NEAR in yocto
  const epochs = 18;

  for (const agent of AGENTS) {
    let alreadyMember = false;
    try {
      const m = await viewCall(POOL, 'get_member', { account: agent.account });
      if (m) alreadyMember = true;
    } catch {
      // not a member
    }

    if (!alreadyMember) {
      console.log(`Agent ${agent.account} joining pool...`);
      const s = stakeFor(coverYocto, testnetCfg);
      const p = premiumPerEpoch(coverYocto, agent.declared, testnetCfg);
      const needed = s + p * epochs;
      // 1% headroom
      const depositYocto = BigInt(Math.ceil(needed * 1.01)).toString();

      const joinArgs = {
        cover: coverYocto.toString(),
        declared_score: agent.declared,
        epochs,
        payees: [MERCHANT],
      };

      const jRes = call(POOL, 'join', joinArgs, {
        signer: agent.account,
        deposit: `${depositYocto} yoctonear`,
      });
      if (!jRes.ok) throw new Error(`Failed to join pool for ${agent.account}: ${jRes.out}`);
      console.log(`[TESTNET] Agent ${agent.account} joined pool: tx ${jRes.txHash}`);
      recordTx(dep, `join_${agent.name}`, jRes.txHash);
    } else {
      console.log(`Agent ${agent.account} is already a member of pool.`);
    }
  }

  // 8. Add function-call keys for wallet agents
  const walletAgents = AGENTS.filter((a) => a.wallet);
  for (const agent of walletAgents) {
    const keysInfo = await viewKeys(agent.account);
    const keys = keysInfo.keys || [];

    const hasSelfKey = keys.some(
      (k) =>
        k.access_key.permission.FunctionCall &&
        k.access_key.permission.FunctionCall.receiver_id === agent.account
    );
    const hasPoolKey = keys.some(
      (k) =>
        k.access_key.permission.FunctionCall &&
        k.access_key.permission.FunctionCall.receiver_id === POOL
    );

    if (!hasSelfKey) {
      console.log(`Adding self function-call key to ${agent.account}...`);
      const res = addFunctionCallKey(agent.account, agent.account, ['pay'], '0.5');
      if (!res.ok) throw new Error(`Failed to add self key for ${agent.account}: ${res.out}`);
      console.log(`[TESTNET] Added self key to ${agent.account}: tx ${res.txHash}`);
      recordTx(dep, `add_self_key_${agent.name}`, res.txHash);
    }

    if (!hasPoolKey) {
      console.log(`Adding pool function-call key to ${agent.account}...`);
      const poolMethods = [
        'file_claim',
        'commit_vote',
        'reveal_vote',
        'register_payee',
        'resolve_claim',
        'leave',
      ];
      const res = addFunctionCallKey(agent.account, POOL, poolMethods, '0.5');
      if (!res.ok) throw new Error(`Failed to add pool key for ${agent.account}: ${res.out}`);
      console.log(`[TESTNET] Added pool key to ${agent.account}: tx ${res.txHash}`);
      recordTx(dep, `add_pool_key_${agent.name}`, res.txHash);
    }
  }

  // Check and report keys before deleting full-access keys
  console.log('\n--- Step 8 Access Keys Status ---');
  for (const agent of walletAgents) {
    const keysInfo = await viewKeys(agent.account);
    console.log(`Keys for ${agent.account}:`);
    for (const k of keysInfo.keys) {
      console.log(`  - Public Key: ${k.public_key}`);
      console.log(`    Permission: ${JSON.stringify(k.access_key.permission)}`);
    }
  }

  if (!deleteFullAccess) {
    console.log('\n[GATE] Reached C13 Step 8. Full-access keys exist alongside function-call keys.');
    console.log('Per Step 5(a), awaiting user confirmation before deleting full-access keys.');
    saveDeployments(dep);
    return { ok: true, awaitingConfirmation: true };
  }

  console.log('\nDeleting full-access keys as requested...');
  for (const agent of walletAgents) {
    const keysInfo = await viewKeys(agent.account);
    const fullAccessKeys = keysInfo.keys.filter(
      (k) => k.access_key.permission === 'FullAccess'
    );
    for (const fak of fullAccessKeys) {
      console.log(`Deleting FullAccess key ${fak.public_key} for ${agent.account}...`);
      const res = deleteKey(agent.account, fak.public_key);
      if (!res.ok) throw new Error(`Failed to delete full-access key: ${res.out}`);
      console.log(`[TESTNET] Deleted FullAccess key: tx ${res.txHash}`);
      recordTx(dep, `delete_fak_${agent.name}`, res.txHash);
    }
  }

  saveDeployments(dep);
  console.log('--- Testnet Setup Complete ---');
  return { ok: true, awaitingConfirmation: false };
}

if (process.argv[1] && process.argv[1].endsWith('setup-testnet.mjs')) {
  const deleteFullAccess = process.argv.includes('--delete-full-access-keys');
  runSetup({ deleteFullAccess })
    .then((res) => {
      if (res.awaitingConfirmation) {
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Error during testnet setup:', err);
      process.exit(1);
    });
}
