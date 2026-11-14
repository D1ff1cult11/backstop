# Judging guide

The fastest way to check that Backstop does what the README says. Nothing here needs a key, a wallet, testnet funds or `npm install`. Node 20 or newer is enough.

## 1. Three commands

### `npm test` (offline, about 3 seconds)

Expect `tests 23`, `pass 23`, `fail 0`.

| File | Tests | What it proves |
|---|---|---|
| `test/rules.test.mjs` | 7 | The premium formula, stake, bond and resolution rules of RULES.md §4 and §7, mirrored from the contract |
| `test/posture.test.mjs` | 5 | The posture score of RULES.md §3 on five account fixtures: 0, 40, 70, 90, 100 |
| `test/juror.test.mjs` | 10 | The 7 evidence checks of RULES.md §6, including that RPC failures and unknown code hashes reject the claim |
| `test/sim.test.mjs` | 1 | Simulation invariants for seed 42 (conservation of funds, no approved fraud) |

### `npm run demo` (offline, about 5 seconds)

Expect, in order:

1. A `[SIM]` table of 6 strategies. The `liar` and `fraudster` rows show `0 / 3` and `0 / 6` approved / rejected.
2. A `[SIM]` 200-seed line: `fraud claims approved 0/1198, posture-lie claims approved 1/690, honest claims approved 2800/2800`, and lowest solvency `100.3%`.
3. A `[TESTNET-RECORDED]` section printed from `deployments/testnet.json`: the 5 agents, the atlas transaction blocked by its allowlist, and all 5 jury rounds (claims 0–14). Round 5 shows claim 12 Approved 0.16, claim 13 Approved 0.64, claim 14 Rejected, each with explorer links.

### `npm run verify` (needs network; read-only calls to `https://test.rpc.fastnear.com`)

Expect:

```
--- Deployed code vs this repo [TESTNET] ---
  MATCH    pool.backstop-hq.testnet  code_hash EDWJAJnJgCKtRxdg1Sns1onoWvQdfepAUEdGw46F5zFa  == sha256(wasm/pool.wasm)
  MATCH    atlas.backstop-hq.testnet  code_hash 3xM3YDs44aRso3b3hVo5KVdRKCatqkUMFwnpxBTXtFYW  == sha256(wasm/wallet.wasm)
  ...
  LOCKED   pool.backstop-hq.testnet has 0 access keys: nobody can upgrade it or move its funds.
--- Member posture: declared vs recomputed from chain state [TESTNET] ---
| atlas.backstop-hq.testnet | 100 | 100 | 0.50x | ... | yes |
| bea.backstop-hq.testnet   |  90 |  90 | 0.75x | ... | yes |
| eve.backstop-hq.testnet   |  70 |  70 | 1.25x | ... | yes |
| cato.backstop-hq.testnet  |   0 |   0 | 3.00x | ... | yes |
| dex.backstop-hq.testnet   |  95 |   0 | 0.63x | ... | NO: declared > verified + 10 |
```

followed by all 15 claims grouped by round. Balances, stakes, the active-member count and the epoch are live values and will differ from any snapshot. Premiums were prepaid for a few hours, so members show as inactive after the demo window; posture and claims are unaffected.

`npm run verify -- --account <any.testnet>` scores any testnet account and prints the 5 signals and a premium quote.

## 2. Optional

- `npm run sweep`: the 200-seed stress test in full.
- `npm run web`, then http://localhost:5173/web/: the dashboard. The simulation charts work offline; the testnet panels and the "Score any account" box call the RPC from the browser.
- Contract unit tests: `cd contracts/pool && cargo test` (22 tests), `cd contracts/wallet && cargo test` (5 tests). The first build downloads crates. On Windows set `AWS_LC_SYS_PREBUILT_NASM=1`.
- `npm run build:contracts` rebuilds the wasm with cargo-near. The build is not reproducible bit-for-bit, so a rebuild will not match the deployed hash; the committed `wasm/` is what was deployed.
- `npm run testnet:setup` and `npm run testnet:round` created the recorded run. They need funded testnet keys and are not part of judging.

## 3. Where things are

| Claim | File | Symbol |
|---|---|---|
| Premium from posture | `contracts/pool/src/lib.rs` | `premium_per_epoch` |
| Join, stake, paid-through epoch | `contracts/pool/src/lib.rs` | `join`, `pay_premium` |
| Bond reserved from stake | `contracts/pool/src/lib.rs` | `file_claim` |
| Jury draw | `contracts/pool/src/lib.rs` | `draw_jury` |
| Commit-reveal | `contracts/pool/src/lib.rs` | `commit_vote`, `reveal_vote` |
| Payout caps, forfeits, slashing, Void | `contracts/pool/src/lib.rs` | `resolve_claim`, `slash_juror` |
| Pool unit tests | `contracts/pool/src/tests.rs` | 22 tests, grouped by RULES section |
| Policy wallet: caps and allowlist | `contracts/wallet/src/lib.rs` | `pay`, `set_policy` |
| Posture score | `agents/posture.mjs` | `scoreFromSnapshot`, `fetchSnapshot` |
| Juror evidence checks | `agents/juror.mjs` | `evaluate` |
| Simulation and sweep | `sim/engine.mjs`, `sim/sweep.mjs` | `runSim`, `sweep` |
| Recorded testnet run | `deployments/testnet.json` | `rounds`, `recordedClaims`, `txs` |
| Live verifier | `scripts/verify.mjs` | |

## 4. What to be sceptical about

We would rather you hear these from us:

- Four of the five testnet rounds failed because of our client scripts, not the contract. They are all on-chain and all listed in the README.
- The agents are rule-based and the prompt injection is scripted.
- Collusion fraud is not solved. The full list is in the README under Limitations and in RULES.md §10.
