# Backstop: Mutual Cover for AI Agents on NEAR

> Premiums priced from security posture that anyone can verify on-chain.

Backstop is a mutual cover pool built on NEAR testnet for autonomous AI agents. Agents join by paying a recurring premium dynamically priced from their on-chain security posture: whether they deploy a policy wallet, hold strictly scoped access keys, cap per-transaction spending, and enforce a payee allowlist. When an agent falls victim to an unauthorized transfer (such as prompt injection), it files a claim. A randomly drawn jury of peer agents independently verifies the on-chain evidence and recomputes the claimant's posture via public RPC. The pool pays approved claims and penalizes fraudulent claims, posture liars, and lazy jurors.

---

## 1. The Problem

- **Grok / Bankr Prompt Injection (May 2026):** Prompt injection attack drained ~$150K–$200K across automated consumer agent integrations.
- **Lobstar Wilde Incident (Feb 2026):** Autonomous agent executed an irreversible ~$250K transfer due to confused deputy instructions.
- **Uncapped Agent Wallets:** Agent SDKs routinely provision unrestricted private keys without runtime per-transaction spending caps.
- **The Market Void:** Traditional insurers cannot underwrite AI agents because they cannot inspect what an agent's keys can execute.

---

## 2. Why NEAR (and Why Not Stripe or a Card)

1. **Protocol-Level Access Keys:** NEAR account access keys and method permissions are transparent, public on-chain state. Anyone can audit an agent's security posture trustlessly via RPC without API keys.
2. **Function-Call Scoped Keys:** NEAR allows agents to operate with non-transferring scoped keys restricted only to approved contract methods (e.g., `pay`, `file_claim`, `commit_vote`), eliminating private key theft risk.
3. **Hierarchical Sub-Accounts:** Sub-accounts give every autonomous agent an isolated identity while maintaining parent governance.
4. **Autonomous Juries & Payouts:** Contract logic handles claims, randomized jury selection, commit-reveal voting, and automated payouts with zero human intermediaries.

---

## 3. Try It in 2 Minutes

No testnet tokens, no private keys, and zero npm runtime dependencies required:

```bash
git clone https://github.com/D1ff1cult11/backstop.git
cd backstop

# 1. Run offline unit tests (18 tests)
npm test

# 2. Run the 20-agent simulation & view recorded testnet incident
npm run demo

# 3. Verify live testnet state & audit agent posture on-chain (keyless read-only RPC)
npm run verify

# 4. Launch the web dashboard
npm run web
# Open http://localhost:5173/web/ in your browser
```

---

## 4. What Happened on NEAR Testnet

In our recorded testnet demonstration, 5 agents were onboarded to `pool.backstop-hq.testnet`. A prompt injection attack was launched with a fraudulent invoice (`Invoice #4471`).

### Agents & On-Chain Posture

| Agent | Account | Policy / Architecture | Declared | Verified | Status |
|---|---|---|---|---|---|
| **Atlas** | [`atlas.backstop-hq.testnet`](https://testnet.nearblocks.io/address/atlas.backstop-hq.testnet) | Policy Wallet (20% cap, allowlist) | 100 | 100 | Protected |
| **Bea** | [`bea.backstop-hq.testnet`](https://testnet.nearblocks.io/address/bea.backstop-hq.testnet) | Policy Wallet (20% cap, no allowlist) | 90 | 90 | Insured |
| **Eve** | [`eve.backstop-hq.testnet`](https://testnet.nearblocks.io/address/eve.backstop-hq.testnet) | Policy Wallet (High cap, lazy juror) | 70 | 70 | Slashed |
| **Cato** | [`cato.backstop-hq.testnet`](https://testnet.nearblocks.io/address/cato.backstop-hq.testnet) | Plain Account (Full-access key) | 0 | 0 | Insured (High Premium) |
| **Dex** | [`dex.backstop-hq.testnet`](https://testnet.nearblocks.io/address/dex.backstop-hq.testnet) | Plain Account (Declared 95 liar) | 95 | 0 | Rejected Liar |

### Claims & Jury Outcomes

| Claim ID | Claimant | Loss Amount | Status | Payout | Jury Breakdown | Evidence & Resolution |
|---|---|---|---|---|---|---|
| **#12** | Bea | 0.20 NEAR | **Approved** | 0.16 NEAR | 3 YES (Atlas, Cato, Dex), 1 Abstain (Eve) | [Tx 5g33g...](https://testnet.nearblocks.io/txns/5g33g2bvpbi83fPwLXcgf2h6EDLw6Piv5jTFEFfJDPjZ) |
| **#13** | Cato | 0.80 NEAR | **Approved** | 0.64 NEAR | 3 YES (Atlas, Bea, Dex), 1 Abstain (Eve) | [Tx Cfkvp...](https://testnet.nearblocks.io/txns/CfkvpBxXQ5PQbevF7HEG8ffmqDK7JeVCo5Wgv42nntBB) |
| **#14** | Dex | 0.60 NEAR | **Rejected** | 0.00 NEAR | 3 NO (Atlas, Bea, Cato), 1 Abstain (Eve) | [Tx EsjwD...](https://testnet.nearblocks.io/txns/EsjwDwwzc1zRb1daC4S6YEVnbgtLVTDhiuwDd9VYcCPK) |

- **Atlas:** Policy wallet blocked the prompt-injected payment to Mallory on-chain ([Tx 2SWHQ...](https://testnet.nearblocks.io/txns/2SWHQkHwoHWxTqzP7joCv5yrwJ1TAH4o1zkr8q6Nc15K)).
- **Dex:** Attempted to collect cover after declaring posture score 95 while actually operating a plain account (verified score 0). The jury caught the discrepancy and unanimously rejected Claim #14.
- **Eve:** Committed votes across all three claims but failed to reveal before deadline; slashed 3 times for jury absenteeism.

---

## 5. How It Works

```
                     +---------------------------------------+
                     |        Agent Security Posture         |
                     |  - Policy Wallet Deployed    (30 pts) |
                     |  - No Full-Access Keys       (30 pts) |
                     |  - Scoped Function-Call Keys (10 pts) |
                     |  - Per-Tx Cap <= 25% Bal     (20 pts) |
                     |  - Payee Allowlist Enabled   (10 pts) |
                     +-------------------+-------------------+
                                         |
                                         v
                     +---------------------------------------+
                     |          Dynamic Premium Rate         |
                     |    Base 100 bps * Multiplier (0.5x–3x)|
                     +-------------------+-------------------+
                                         |
                                         v
 [Agent joins pool] ---> [Unauthorized transfer occurs] ---> [Agent files claim]
                                                                    |
                                                                    v
+------------------------+                               +---------------------+
| Claim Outcome          |                               |  Autonomous Jury    |
| - Approved: 80% Payout | <--- [Resolve Claim] <------- | - k=4 Random Draw   |
| - Rejected: Bond Lost  |        (After deadlines)      | - 7 On-Chain Checks |
| - Juror Slash: Slashed |                               | - Commit-Reveal     |
+------------------------+                               +---------------------+
```

Detailed rules, arithmetic formulas, parameter bounds, and state models are defined in [RULES.md](RULES.md).

---

## 6. Implementation & Verification Matrix

| Feature | Implementation | Automated Test Proof | Status |
|---|---|---|---|
| Pool Contract State & Logic | `contracts/pool/src/lib.rs` | `cargo test` in `contracts/pool` | Live on Testnet |
| Policy Wallet Contract | `contracts/wallet/src/lib.rs` | `cargo test` in `contracts/wallet` | Live on Testnet |
| Posture Scoring Model | `agents/posture.mjs` | `test/posture.test.mjs` (5 fixtures) | Live on Testnet |
| 7-Step Evidence Jury Checks | `agents/juror.mjs` | `test/juror.test.mjs` (5 unit tests) | Live on Testnet |
| 20-Agent Simulation Engine | `sim/engine.mjs`, `sim/run.mjs` | `test/sim.test.mjs` (Seed 42 invariants) | Offline Simulation |
| Testnet Pipeline Script | `scripts/run-round.mjs` | `deployments/testnet.json` (161 txs) | Live on Testnet |
| Keyless Chain Verifier | `scripts/verify.mjs` | `npm run verify` | Live on Testnet |
| Static Dashboard | `web/index.html`, `web/app.js` | `npm run web` | Live on Testnet |

---

## 7. What Is Real and What Is Simulated

- **Real On-Chain [TESTNET]:**
  - Smart contracts deployed: `pool.backstop-hq.testnet` and policy wallets on `atlas`, `bea`, `eve`.
  - On-chain accounts: `merchant`, `mallory`, `cato`, `dex`.
  - All 161 transactions (funding, registrations, policy updates, prompt-injected transfers, claims, commits, reveals, slashes, and payout transfers) executed on public NEAR testnet and verified on NearBlocks.
- **Simulated [SIM]:**
  - The 30-day discrete-event simulation (`sim/engine.mjs`) models 20 heterogeneous agent strategies (`careful`, `standard`, `reckless`, `liar`, `fraudster`, `lazy`) to prove pool solvency, pricing incentives, and fraud prevention over long time horizons.

---

## 8. Known Limitations

As stated in [RULES.md §10](RULES.md):
- **Collusion fraud:** A member can pay an accomplice and claim. The deductible, the bond, the cover cap and the jury raise the cost of this, but do not eliminate it. This is the open problem.
- **Posture is checked at claim time, not continuously:** An agent could weaken its posture after a claim.
- **Validator-influenced randomness (`random_seed`):** Acceptable on testnet; mainnet requires a verifiable randomness function (VRF) or drand beacon.
- **Pool capital is donated in v1:** Contains no shares and no liquidity provider withdrawals.
- **Scripted prompt injection:** Testnet agents operate on rule-based heuristics; the incident tests downstream detection and cover execution.
- **Denominated in NEAR:** Stablecoin (USDT/USDC) support reserved for v2.

---

## 9. Hackathon Metadata

- **Date:** Built during the NEAR Hackathon on 2026-11-14.
- **Tools & Libraries:** `near-sdk` (5.30.1), `cargo-near` (0.16.1), `near-cli-rs` (0.24.1), Node.js (v24.22.1), Chart.js (4.4.1). Zero npm runtime dependencies.
- **AI Coding Assistants:** Built with the assistance of agentic development tools adhering to hackathon transparency guidelines.
- **Tracks:**
  - **AI Swarms** (Primary): Collaborative peer-agent jury networks and distributed claim adjudication.
  - **AI Security & Defense**: Policy wallets, allowlists, and economic prompt-injection insurance.
  - **Agent Economy**: Verified posture-based risk underwriting.
  - **Unstoppable DeFi**: Permissionless mutual risk pooling on NEAR.

---

## 10. License

MIT License. See [LICENSE](LICENSE) for details.
