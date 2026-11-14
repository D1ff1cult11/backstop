const POOL_ALLOWED_METHODS = new Set([
  'file_claim',
  'commit_vote',
  'reveal_vote',
  'register_payee',
  'resolve_claim',
  'leave',
]);

export function scoreFromSnapshot({
  account,
  codeHash,
  keys = [],
  policy = null,
  balance = '0',
  walletCodeHash,
  poolContract,
}) {
  const signals = [];

  // 1. Policy wallet deployed (30 pts)
  const isWalletDeployed = Boolean(codeHash && walletCodeHash && codeHash === walletCodeHash);
  signals.push({
    name: 'Policy wallet deployed',
    points: 30,
    ok: isWalletDeployed,
    detail: isWalletDeployed ? `Matches wallet code hash: ${codeHash}` : `Code hash: ${codeHash || 'none'}`,
  });

  // 2. No full-access keys (30 pts)
  const hasFullAccess = keys.some((k) => {
    const perm = k.permission || k.access_key?.permission;
    return perm === 'FullAccess' || (typeof perm === 'object' && perm !== null && 'FullAccess' in perm);
  });
  const noFullAccess = !hasFullAccess;
  signals.push({
    name: 'No full-access keys',
    points: 30,
    ok: noFullAccess,
    detail: noFullAccess ? 'Zero full-access keys detected' : 'Full-access key present on account',
  });

  // 3. Agent keys tightly scoped (10 pts) - requires signal 1
  let keysScoped = false;
  let keysDetail = 'Requires policy wallet';

  if (isWalletDeployed) {
    const functionCallKeys = keys.filter((k) => {
      const perm = k.permission || k.access_key?.permission;
      return typeof perm === 'object' && perm !== null && 'FunctionCall' in perm;
    });

    if (functionCallKeys.length > 0) {
      const allValid = functionCallKeys.every((k) => {
        const fc = (k.permission || k.access_key?.permission).FunctionCall;
        const receiver = fc.receiver_id;
        const methods = fc.method_names || [];

        if (receiver === account) {
          return methods.length === 1 && methods[0] === 'pay';
        }
        if (receiver === poolContract) {
          return methods.length > 0 && methods.every((m) => POOL_ALLOWED_METHODS.has(m));
        }
        return false;
      });

      keysScoped = allValid;
      keysDetail = allValid ? `${functionCallKeys.length} function-call key(s) tightly scoped` : 'Unrecognized receiver or methods';
    } else {
      keysDetail = 'No function-call keys present';
    }
  }

  signals.push({
    name: 'Agent keys tightly scoped',
    points: 10,
    ok: isWalletDeployed && keysScoped,
    detail: keysDetail,
  });

  // 4. Per-transaction cap <= 25% of balance (20 pts) - requires signal 1
  let capOk = false;
  let capDetail = 'Requires policy wallet';

  if (isWalletDeployed && policy) {
    try {
      const perTx = BigInt(policy.per_tx_cap || '0');
      const bal = BigInt(balance || '0');
      capOk = perTx * 4n <= bal;
      capDetail = capOk ? `Per-tx cap ${perTx} <= 25% of balance ${bal}` : `Per-tx cap ${perTx} exceeds 25% of balance ${bal}`;
    } catch {
      capDetail = 'Invalid balance or per-tx cap';
    }
  }

  signals.push({
    name: 'Per-transaction cap of at most 25% of balance',
    points: 20,
    ok: isWalletDeployed && capOk,
    detail: capDetail,
  });

  // 5. Payee allowlist enabled (10 pts) - requires signal 1
  const allowlistOk = Boolean(isWalletDeployed && policy && policy.allowlist_enabled === true);
  signals.push({
    name: 'Payee allowlist enabled',
    points: 10,
    ok: allowlistOk,
    detail: isWalletDeployed ? (allowlistOk ? 'Allowlist is enabled' : 'Allowlist is disabled') : 'Requires policy wallet',
  });

  const score = signals.reduce((sum, s) => sum + (s.ok ? s.points : 0), 0);
  return { score, signals };
}

export async function fetchSnapshot(accountId, { walletCodeHash, poolContract }, rpc) {
  const acct = await rpc.viewAccount(accountId);
  const keysRes = await rpc.viewKeys(accountId);
  const keys = keysRes.keys || [];
  const codeHash = acct.code_hash;
  const balance = acct.amount;

  let policy = null;
  if (codeHash === walletCodeHash) {
    try {
      policy = await rpc.viewCall(accountId, 'get_policy', {});
    } catch (e) {
      console.warn(`Could not fetch policy for ${accountId}:`, e.message);
    }
  }

  return scoreFromSnapshot({
    account: accountId,
    codeHash,
    keys,
    policy,
    balance,
    walletCodeHash,
    poolContract,
  });
}
