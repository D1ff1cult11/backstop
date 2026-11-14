import { spawnSync } from 'node:child_process';

/**
 * Run a near CLI command with an arguments array.
 * Never runs through a shell string.
 *
 * @param {string[]} args
 * @returns {{ ok: boolean, txHash: string | null, out: string }}
 */
export function runNear(args) {
  const res = spawnSync('near', args, {
    encoding: 'utf8',
    maxBuffer: 1e8,
  });

  const out = (res.stdout || '') + (res.stderr || '');
  const txMatch = out.match(/Transaction ID:\s*([1-9A-HJ-NP-Za-km-z]{43,44})/);
  const txHash = txMatch ? txMatch[1] : null;

  const hasError = res.status !== 0 || /error|failure|panicked/i.test(out);

  return {
    ok: !hasError,
    txHash,
    out,
  };
}

/**
 * Call a smart contract method as a transaction.
 * Syntax:
 * near contract call-function as-transaction <contract> <method> json-args '<json>' prepaid-gas '<gas>' attached-deposit '<deposit>' sign-as <signer> network-config testnet [sign-with-access-key-file <keyFile> | sign-with-legacy-keychain] send
 */
export function call(
  contract,
  method,
  args = {},
  { signer, deposit = '0 NEAR', gas = '100 Tgas', keyFile = null } = {}
) {
  const jsonArgs = typeof args === 'string' ? args : JSON.stringify(args);
  const signAs = signer || contract;

  const cmdArgs = [
    'contract',
    'call-function',
    'as-transaction',
    contract,
    method,
    'json-args',
    jsonArgs,
    'prepaid-gas',
    gas,
    'attached-deposit',
    deposit,
    'sign-as',
    signAs,
    'network-config',
    'testnet',
  ];

  if (keyFile) {
    cmdArgs.push('sign-with-access-key-file', keyFile, 'send');
  } else {
    cmdArgs.push('sign-with-legacy-keychain', 'send');
  }

  return runNear(cmdArgs);
}

/**
 * Call a view method on a smart contract.
 * Syntax:
 * near contract call-function as-read-only <contract> <method> json-args '<json>' network-config testnet now
 */
export function view(contract, method, args = {}) {
  const jsonArgs = typeof args === 'string' ? args : JSON.stringify(args);
  const cmdArgs = [
    'contract',
    'call-function',
    'as-read-only',
    contract,
    method,
    'json-args',
    jsonArgs,
    'network-config',
    'testnet',
    'now',
  ];
  return runNear(cmdArgs);
}

/**
 * Deploy a WASM contract to an account.
 * Syntax:
 * near contract deploy <account> use-file <wasmPath> without-init-call network-config testnet sign-with-legacy-keychain send
 */
export function deploy(account, wasmPath) {
  const cmdArgs = [
    'contract',
    'deploy',
    account,
    'use-file',
    wasmPath,
    'without-init-call',
    'network-config',
    'testnet',
    'sign-with-legacy-keychain',
    'send',
  ];
  return runNear(cmdArgs);
}

/**
 * Send NEAR tokens from one account to another.
 * Syntax:
 * near tokens <from> send-near <to> '<amount>' network-config testnet sign-with-legacy-keychain send
 */
export function sendNear(from, to, amount) {
  const amountStr = String(amount).includes('NEAR') ? String(amount) : `${amount} NEAR`;
  const cmdArgs = [
    'tokens',
    from,
    'send-near',
    to,
    amountStr,
    'network-config',
    'testnet',
    'sign-with-legacy-keychain',
    'send',
  ];
  return runNear(cmdArgs);
}

/**
 * Create and fund a sub-account under a parent account.
 * Syntax:
 * near account create-account fund-myself <subaccount> '<amount>' autogenerate-new-keypair save-to-legacy-keychain sign-as <parent> network-config testnet sign-with-legacy-keychain send
 */
export function createSubAccount(name, parent, amount) {
  const amountStr = String(amount).includes('NEAR') ? String(amount) : `${amount} NEAR`;
  const cmdArgs = [
    'account',
    'create-account',
    'fund-myself',
    name,
    amountStr,
    'autogenerate-new-keypair',
    'save-to-legacy-keychain',
    'sign-as',
    parent,
    'network-config',
    'testnet',
    'sign-with-legacy-keychain',
    'send',
  ];
  return runNear(cmdArgs);
}

/**
 * Add a function-call access key to an account.
 * Syntax:
 * near account add-key <account> grant-function-call-access --allowance '<allowance>' --contract-account-id <receiver> --function-names <methods> autogenerate-new-keypair save-to-legacy-keychain network-config testnet sign-with-legacy-keychain send
 */
export function addFunctionCallKey(account, receiver, methods, allowance = '0.5 NEAR') {
  const allowanceStr = String(allowance).includes('NEAR') ? String(allowance) : `${allowance} NEAR`;
  const methodsStr = Array.isArray(methods) ? methods.join(',') : String(methods);
  const cmdArgs = [
    'account',
    'add-key',
    account,
    'grant-function-call-access',
    '--allowance',
    allowanceStr,
    '--contract-account-id',
    receiver,
    '--function-names',
    methodsStr,
    'autogenerate-new-keypair',
    'save-to-legacy-keychain',
    'network-config',
    'testnet',
    'sign-with-legacy-keychain',
    'send',
  ];
  return runNear(cmdArgs);
}

/**
 * View the list of access keys for an account.
 * Syntax:
 * near account list-keys <account> network-config testnet now
 */
export function listKeys(account) {
  const cmdArgs = [
    'account',
    'list-keys',
    account,
    'network-config',
    'testnet',
    'now',
  ];
  return runNear(cmdArgs);
}

/**
 * Delete an access key from an account.
 * Syntax:
 * near account delete-keys <account> public-keys <publicKey> network-config testnet sign-with-legacy-keychain send
 */
export function deleteKey(account, publicKey) {
  const cmdArgs = [
    'account',
    'delete-keys',
    account,
    'public-keys',
    publicKey,
    'network-config',
    'testnet',
    'sign-with-legacy-keychain',
    'send',
  ];
  return runNear(cmdArgs);
}
