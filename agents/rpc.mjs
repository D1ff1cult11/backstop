const RPC_ENDPOINTS = [
  'https://test.rpc.fastnear.com',
  'https://rpc.testnet.near.org',
];

export async function rpcCall(method, params, timeoutMs = 20000) {
  let lastErr;
  for (const endpoint of RPC_ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'backstop-rpc',
          method,
          params,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${endpoint}`);

      const json = await res.json();
      if (json.error) {
        throw new Error(json.error.message || JSON.stringify(json.error));
      }
      return json.result;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
    }
  }
  throw lastErr || new Error('All RPC endpoints failed');
}

export async function viewAccount(accountId) {
  return rpcCall('query', {
    request_type: 'view_account',
    finality: 'final',
    account_id: accountId,
  });
}

export async function viewKeys(accountId) {
  return rpcCall('query', {
    request_type: 'view_access_key_list',
    finality: 'final',
    account_id: accountId,
  });
}

export async function viewCall(contractId, methodName, args = {}) {
  const argsBase64 = Buffer.from(JSON.stringify(args)).toString('base64');
  const res = await rpcCall('query', {
    request_type: 'call_function',
    finality: 'final',
    account_id: contractId,
    method_name: methodName,
    args_base64: argsBase64,
  });

  const bytes = Buffer.from(res.result);
  const text = bytes.toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function txStatus(txHash, senderAccountId) {
  return rpcCall('EXPERIMENTAL_tx_status', {
    tx_hash: txHash,
    sender_account_id: senderAccountId,
    wait_until: 'FINAL',
  });
}

export async function blockTimestampNs(blockHashOrHeight) {
  const params = blockHashOrHeight
    ? (typeof blockHashOrHeight === 'number'
        ? { block_id: blockHashOrHeight }
        : { block_id: blockHashOrHeight })
    : { finality: 'final' };
  const res = await rpcCall('block', params);
  const ts = res.header.timestamp_nanosec || `${res.header.timestamp}`;
  return BigInt(ts);
}
