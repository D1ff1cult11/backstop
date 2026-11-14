import { spawnSync } from 'node:child_process';
import { readdirSync, existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function bs58Encode(buffer) {
  const bytes = Uint8Array.from(buffer);
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits = [0];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      const x = digits[j] * 256 + carry;
      digits[j] = x % 58;
      carry = Math.floor(x / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let str = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) str += ALPHABET[digits[i]];
  return str;
}

const rootDir = resolve('.');
const contractsDir = join(rootDir, 'contracts');
const wasmDir = join(rootDir, 'wasm');

if (!existsSync(wasmDir)) {
  mkdirSync(wasmDir, { recursive: true });
}

const contractFolders = readdirSync(contractsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const sums = [];

for (const name of contractFolders) {
  const cDir = join(contractsDir, name);
  console.log(`Building contract ${name} in ${cDir}...`);

  const res = spawnSync(
    'cargo',
    ['near', 'build', 'non-reproducible-wasm', '--no-abi'],
    {
      cwd: cDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        AWS_LC_SYS_PREBUILT_NASM: '1',
        CARGO_INCREMENTAL: '0',
      },
    }
  );

  if (res.status !== 0) {
    console.error(`Build failed for ${name} with status ${res.status}`);
    process.exit(res.status || 1);
  }

  const srcWasm = join(cDir, 'target', 'near', `${name}.wasm`);
  if (!existsSync(srcWasm)) {
    console.error(`Expected wasm binary not found at ${srcWasm}`);
    process.exit(1);
  }

  const destWasm = join(wasmDir, `${name}.wasm`);
  copyFileSync(srcWasm, destWasm);

  const bytes = readFileSync(destWasm);
  const hash = createHash('sha256').update(bytes).digest();
  const hexHash = hash.toString('hex');
  const bs58Hash = bs58Encode(hash);

  console.log(`Contract: ${name}`);
  console.log(`  SHA-256 (hex) : ${hexHash}`);
  console.log(`  SHA-256 (bs58): ${bs58Hash}`);

  sums.push(`${hexHash}  ${name}.wasm`);
  sums.push(`${bs58Hash}  ${name}.wasm`);
}

const sumsPath = join(wasmDir, 'SHA256SUMS');
writeFileSync(sumsPath, sums.join('\n') + '\n', 'utf8');
console.log(`Wrote checksums to ${sumsPath}`);
