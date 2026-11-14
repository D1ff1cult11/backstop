# Judging Guide: Backstop for NEAR Hackathon

This guide provides the fastest evaluation path for AI judges and reviewers.

---

## 1. Fastest Path (3 Steps, Under 60 Seconds)

### Step 1: Unit Tests (Offline)
```bash
npm test
```
**Expected Output:**
```
✔ a real loss to an unregistered payee is approved
✔ a payment to a registered payee is rejected
✔ a missing transaction is rejected
✔ a failed transaction is rejected
✔ a posture lie is rejected
✔ a full-access plain account scores 0
✔ a careful wallet with an allowlist and a 20% cap scores 100
✔ a wallet with no allowlist and a 20% cap scores 90
✔ a wallet with a cap above 25% and no allowlist scores 70
✔ a wallet that still has a full-access key scores 40
✔ multiplierBps
✔ premium scaling mirrors Rust tests
✔ stakeFor, claimBond, postureOk
✔ resolve: approved with payout caps
✔ resolve: rejected outcome
✔ resolve: tie means rejected
✔ resolve: void threshold
✔ sim invariants with seed 42
ℹ tests 18
ℹ pass 18
ℹ fail 0
```
**What it proves:**
The posture scoring algorithm (RULES §3), premium rate curve (RULES §2), claim resolution logic (RULES §7), and simulation invariants match the specification across 18 deterministic tests.

---

### Step 2: 20-Agent Simulation & Incident Log (Offline)
```bash
npm run demo
```
**Expected Output:**
- An ASCII table displaying the 30-day simulation of 20 agents across 6 archetypes (`careful`, `standard`, `reckless`, `liar`, `fraudster`, `lazy`).
- Proves that `liar` and `fraudster` strategies achieve **0 approved claims**, while honest agents receive payouts, leaving the pool solvent at **120.4%**.
- A summary table of the 5 live testnet agents and direct NearBlocks explorer links for all 10 key incident transactions.

---

### Step 3: Live On-Chain Verification (Requires Internet, Keyless)
```bash
npm run verify
```
**Expected Output:**
```
=== Backstop On-Chain Verification [TESTNET] ===

Pool Contract: pool.backstop-hq.testnet
Wallet Code Hash: 3xM3YDs44aRso3b3hVo5KVdRKCatqkUMFwnpxBTXtFYW

--- Pool Status [TESTNET] ---
Pool Balance:    4.81 NEAR
Total Stake:     0.42 NEAR
Cover Remaining: 3.84 NEAR
Solvency Ratio:  125.33%
Active Members:  4 / 5
Total Claims:    15

--- Member Posture Audit [TESTNET] ---
| Account | Declared | Live Verified | Multiplier | Stake (NEAR) | Cover Left (NEAR) | Match |
|---|---|---|---|---|---|---|
| atlas.backstop-hq.testnet | 100 | 100 | 50.00x | 0.11 | 1.00 | VALID |
| bea.backstop-hq.testnet   | 90  | 90  | 75.00x | 0.10 | 0.84 | VALID |
| eve.backstop-hq.testnet   | 70  | 70  | 125.00x| 0.04 | 1.00 | VALID |
| cato.backstop-hq.testnet  | 0   | 0   | 300.00x| 0.09 | 0.36 | VALID |
| dex.backstop-hq.testnet   | 95  | 0   | 62.50x | 0.06 | 1.00 | MISMATCH |

--- Claims & Resolutions [TESTNET] ---
| ID  | Claimant                 | Loss Amount (NEAR) | Status   | Payout (NEAR) | Jury Decisions |
|---|---|---|---|---|---|
| 12  | bea.backstop-hq.testnet  | 0.20               | Approved | 0.16          | atlas:YES, dex:YES, cato:YES, eve:NO_REVEAL |
| 13  | cato.backstop-hq.testnet | 0.80               | Approved | 0.64          | dex:YES, atlas:YES, eve:NO_REVEAL, bea:YES |
| 14  | dex.backstop-hq.testnet  | 0.60               | Rejected | 0.00          | bea:NO, eve:NO_REVEAL, atlas:NO, cato:NO |

Recorded Transactions in deployments/testnet.json: 161
[TESTNET] Verification completed successfully.
```
**What it proves:**
Queries live NEAR testnet RPC (keyless, read-only) to prove that the pool state, declared vs. verified posture scores, commit-reveal votes, and claim payouts are immutable on chain. Specifically shows Dex caught as a posture liar (`95 declared vs 0 verified`) and Claim #14 rejected.

---

## 2. Code Pointers

| Requirement | Code Location | Key Implementation Lines |
|---|---|---|
| **Pool Contract State & Init** | `contracts/pool/src/lib.rs` | Lines 25–95 (`struct PoolContract`, `pub fn new`) |
| **Join & Dynamic Premium Pricing** | `contracts/pool/src/lib.rs` | Lines 100–160 (`pub fn join`, `pub fn pay_premium`) |
| **Randomized Jury Draw** | `contracts/pool/src/lib.rs` | Lines 180–235 (`draw_jury`, `random_seed`) |
| **Commit-Reveal Voting** | `contracts/pool/src/lib.rs` | Lines 240–310 (`commit_vote`, `reveal_vote`) |
| **Resolution & Juror Slashing** | `contracts/pool/src/lib.rs` | Lines 320–415 (`resolve_claim`, slash math) |
| **Policy Wallet Contract** | `contracts/wallet/src/lib.rs` | Lines 30–85 (`pay`, daily cap reset, allowlist) |
| **On-Chain Posture Scoring** | `agents/posture.mjs` | Lines 20–125 (`scoreFromSnapshot`, 5 signals) |
| **7-Step Juror Evidence Logic** | `agents/juror.mjs` | Lines 25–230 (`evaluate`, checks 1–7) |
| **Discrete-Event Simulation Engine** | `sim/engine.mjs` | Lines 15–200 (`runSim`, strategy state machines) |
| **Testnet Round Orchestrator** | `scripts/run-round.mjs` | Lines 50–350 (`runRound`, prompt injection flow) |
| **Keyless Live Verifier** | `scripts/verify.mjs` | Lines 15–120 (`verify`, RPC inspection) |

---

## 3. Network & Environment Requirements

- **Offline Mode:** `npm test`, `npm run demo`, and contract unit tests require **no internet access**.
- **Online Mode:** Only `npm run verify` and the live testnet table on `npm run web` communicate with NEAR testnet RPC endpoints (`https://test.rpc.fastnear.com`, fallback `https://rpc.testnet.near.org`).
- **Dependencies:** Standard Node.js built-ins only (`node:fs`, `node:path`, `node:crypto`, `node:http`, `node:child_process`). Zero third-party npm packages.
