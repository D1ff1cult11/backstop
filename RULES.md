# Backstop rules

This file is the single source of truth for how Backstop works. The contract (`contracts/pool`), the simulator (`sim/`) and the agents (`agents/`) must all implement exactly these rules with exactly these parameter names. If code and this file disagree, the code is wrong.

Backstop is a mutual cover pool for AI agents on NEAR. Agents pay a premium priced from their security posture, which anyone can check from public chain state. When an agent loses funds to an unauthorized transfer, it files a claim, a jury of other member agents checks the evidence, and the pool pays out. Agents that lie, fake claims or skip jury duty lose money.

Backstop is a mutual cover pool, not a regulated insurance product. v1 runs on NEAR testnet and is denominated in NEAR.

## 1. Roles

| Role | Who | What they do |
|---|---|---|
| Member | Any NEAR account running an agent | Pays premiums, posts a stake, files claims, serves on juries |
| Juror | A member drawn for a claim | Checks the evidence, votes with commit-reveal |
| Funder | Anyone | Adds capital with `fund_pool` (a donation in v1; no shares) |
| Resolver | Anyone | Calls `resolve_claim` after the reveal window closes |

There is no admin. All parameters are fixed at `init` and readable with `get_config`. Nothing can change them later. On testnet the pool account has no access keys, so the code cannot be redeployed either.

## 2. Parameters

All amounts are yoctoNEAR (1 NEAR = 10^24). All `_bps` values are basis points (10000 = 100%). All times are nanoseconds.

| Name | Meaning | Testnet value | Sim value |
|---|---|---|---|
| `epoch_ns` | Length of one premium period | 600000000000 (10 min) | 1 day (abstract) |
| `base_premium_bps` | Premium per epoch as a share of cover, before the posture multiplier | 100 | 40 |
| `min_stake_bps` | Stake required as a share of cover | 2000 | 2000 |
| `max_cover` | Largest cover one member may buy | 1 NEAR | 100 units |
| `deductible_bps` | Share of each approved loss the claimant bears | 2000 | 2000 |
| `max_payout_bps` | Largest payout as a share of the pool balance at resolution | 5000 | 5000 |
| `claim_bond_bps` | Claim bond as a share of the claimed amount | 1000 | 1000 |
| `min_claim_bond` | Smallest claim bond | 0.05 NEAR | 0.5 units |
| `jury_size` | Jurors drawn per claim | 4 | 5 |
| `commit_ns` | Commit window after filing | 90000000000 (90 s) | 1 step |
| `reveal_ns` | Reveal window after the commit window | 90000000000 (90 s) | 1 step |
| `juror_fee_bps` | Reward for coherent jurors on an approved claim, as a share of the payout, split equally | 500 | 500 |
| `juror_slash_bps` | Share of stake a juror loses for voting against the majority or not revealing | 1000 | 1000 |
| `posture_tolerance` | How far a declared score may exceed the verified score before a claim fails | 10 | 10 |

Testnet `jury_size` is 4 because the demo has 5 members, so every non-claimant serves. The simulator uses 5 out of 20 to show random selection.

## 3. Posture score

The posture score is an integer from 0 to 100 computed from public chain state only. It is computed off-chain by `agents/posture.mjs` because a NEAR contract cannot read another account's access keys. Anyone can recompute it with `npm run verify`.

| Signal | Points | How it is checked |
|---|---|---|
| Policy wallet deployed | 30 | `view_account.code_hash` equals the code hash of the committed `wasm/wallet.wasm` |
| No full-access keys | 30 | `view_access_key_list` contains no `FullAccess` permission |
| Agent keys tightly scoped | 10 | Every `FunctionCall` key is either (a) `receiver_id` = the account itself with `method_names` = `["pay"]`, or (b) `receiver_id` = the Backstop pool contract with `method_names` a non-empty subset of `["file_claim","commit_vote","reveal_vote","register_payee","resolve_claim","leave"]` |
| Per-transaction cap of at most 25% of balance | 20 | Wallet `get_policy().per_tx_cap` ≤ 25% of the account balance |
| Payee allowlist enabled | 10 | Wallet `get_policy().allowlist_enabled` is true |

Signals 3–5 count only if signal 1 holds. A plain account with a full-access key scores 0.

The member declares a score at `join`. The contract stores it and prices the premium from it, but does not verify it. Verification happens at claim time: jurors recompute the score, and a claim fails if `declared_score > verified_score + posture_tolerance`. Lying about posture buys a cheaper premium and makes the cover worthless when it matters.

## 4. Premium

```
multiplier_bps = 30000 - 250 * score             // score 100 -> 5000 (0.5x), score 0 -> 30000 (3x)
premium_per_epoch = cover * base_premium_bps * multiplier_bps / 10000 / 10000
```

Use integer arithmetic. Multiply before dividing. Use checked or u128 arithmetic so nothing overflows.

## 5. Membership

- `join(cover, declared_score, epochs, payees)` with an attached deposit.
  - `cover` ≤ `max_cover`, `declared_score` ≤ 100, `epochs` ≥ 1, not already a member.
  - `stake = cover * min_stake_bps / 10000`.
  - Required deposit = `stake + premium_per_epoch * epochs`. Panic if the deposit is lower and refund any excess.
  - The premiums go into `pool_balance`. The stake is held in the member record.
  - `paid_through_epoch = current_epoch + epochs - 1`.
  - `payees` is the initial list of known payees (see 6).
- `pay_premium(epochs)` extends `paid_through_epoch`. The same deposit and refund rules apply.
- A member is active while `paid_through_epoch >= current_epoch`.
- `register_payee(account)` adds an account to the member's known payees and records the time.
- `join`, `pay_premium` and `fund_pool` need an attached deposit, so a careful agent calls them before deleting its full-access key. Every other pool method needs no deposit and works with a scoped function-call key.
- `leave()` returns the stake, but only if the member has no open claim and is not a juror on an open claim. Unused premiums are not refunded.
- `current_epoch = (block_timestamp - genesis_ns) / epoch_ns`, where `genesis_ns` is set at `init`.

## 6. Covered loss

v1 covers one peril: an **unauthorized transfer**. That means a transfer of NEAR out of the member's account to a recipient that was not a registered payee at the time of the transfer. This is what a prompt-injected agent does: it pays someone it should never have paid.

A claim is valid only if every check passes. Jurors run these checks in `agents/juror.mjs`:

1. The loss transaction exists and succeeded.
2. Its signer is the claimant account.
3. It moved at least the claimed amount to a single recipient. Read either a `Transfer` action in the transaction, or a wallet `paid` event in the receipt logs.
4. The recipient was not in the claimant's payees at the transaction's block time.
5. The transaction happened after the member joined, while the member was active.
6. The verified posture score is no more than `posture_tolerance` below the declared score.
7. The same loss transaction has not been claimed before. The contract enforces this.

## 7. Claims

- `file_claim(loss_tx_hash, amount, evidence)`. No deposit is attached, because a careful agent holds only function-call keys and those cannot attach deposits.
  - The bond `claim_bond = max(amount * claim_bond_bps / 10000, min_claim_bond)` is **reserved from the member's stake**. Panic with `"stake too small for bond"` if the stake is lower.
  - "Refund the bond" below means release the reservation. "The bond is forfeited" means it is deducted from the stake.
  - The claimant must be active and have no other open claim.
  - `amount` must not exceed the member's `cover_remaining`.
  - `loss_tx_hash` must never have been claimed before.
- **Jury draw.**
  - Eligible jurors are active members other than the claimant.
  - Shuffle them with Fisher-Yates using `env::random_seed_array()` and take the first `jury_size`.
  - If fewer than `jury_size` are eligible, panic with `"not enough jurors"`.
- **Commit window**, from filing until `filed_at + commit_ns`.
  - Each juror calls `commit_vote(claim_id, commitment)`.
  - `commitment = hex(sha256(vote + ":" + salt))`, where `vote` is `"1"` to approve or `"0"` to reject.
- **Reveal window**, from the end of the commit window for `reveal_ns`.
  - Each juror calls `reveal_vote(claim_id, approve, salt)`.
  - The contract recomputes the hash and panics on a mismatch.
- **Resolution.** After the reveal window anyone calls `resolve_claim(claim_id)`. Let `R` be the number of revealed votes.
  - If `R < ceil(jury_size / 2)`, the claim is **Void**: the bond is refunded and every juror who did not reveal is slashed.
  - Otherwise, if approvals > rejections, the claim is **Approved**. A tie means **Rejected**.
  - **Approved:**
    - `payout = min(amount * (10000 - deductible_bps) / 10000, cover_remaining, pool_balance * max_payout_bps / 10000)`.
    - Pay `payout` to the claimant and refund the bond.
    - `juror_reward = payout * juror_fee_bps / 10000` comes from `pool_balance` and is split equally among the coherent jurors (those who voted approve).
    - Reduce `cover_remaining` by `payout`.
  - **Rejected:**
    - The bond is forfeited. Half goes to the coherent jurors (those who voted reject), split equally, and half goes to `pool_balance`.
  - In every outcome, a juror who voted against the majority or did not reveal loses `stake * juror_slash_bps / 10000` to `pool_balance`.
  - If there are no coherent jurors to pay, their share goes to `pool_balance`.
- Update all state before creating any transfer promise.

## 8. Events

Every state change logs one NEP-297 event: `EVENT_JSON:{"standard":"backstop","version":"1.0.0","event":"<name>","data":[{...}]}`.

Event names: `member_joined`, `premium_paid`, `payee_registered`, `member_left`, `pool_funded`, `claim_filed`, `vote_committed`, `vote_revealed`, `claim_resolved`, `juror_slashed`.

## 9. Policy wallet (`contracts/wallet`)

This is the contract a careful agent deploys on its own account. It is one input to the posture score, not part of the pool.

- `init(owner, per_tx_cap, daily_cap, allowlist_enabled, allowlist)`.
- `pay(to, amount)` can only be called by the account itself (`predecessor == current_account`), which means through the agent's function-call key.
  - Rejects `amount > per_tx_cap`.
  - Rejects a spend over the daily cap within one UTC day (`block_timestamp / 86400e9`).
  - Rejects `to` not on the allowlist when the allowlist is enabled.
  - On success, transfers and logs a `paid` event with `{to, amount}`.
- `set_policy(...)` and `allow(account)` are callable only by `owner`.
- `get_policy()` returns `{owner, per_tx_cap, daily_cap, allowlist_enabled, allowlist, spent_today}`.

## 10. Known limitations, stated up front

- **Collusion fraud.** A member can pay an accomplice and claim. The deductible, the bond, the cover cap and the jury raise the cost of this, but do not eliminate it. This is the open problem.
- **Posture is checked at claim time, not continuously.** An agent could weaken its posture after a claim.
- **The jury draw uses validator-influenced randomness** (`random_seed`). That is acceptable on testnet but not on mainnet.
- **Pool capital is donated in v1.** It has no shares and no withdrawals.
- **The testnet agents are rule-based and the prompt injection is scripted.** Backstop assumes the agent will be fooled. It is about what happens next.
- **No stablecoins yet.** v1 is denominated in NEAR.
- **Commitments are not bound to the juror.** A juror could copy another juror's commitment and reveal after them. The fix is `sha256(claim_id:juror:vote:salt)`.
- **A Void claim consumes its loss transaction.** The claimant cannot refile it. The fix is to release the transaction hash on Void.
- **No key rotation.** After the full-access key is deleted, an agent's function-call keys can exhaust their gas allowance and cannot be replaced. The fix is an owner-only `rotate_key` on the wallet.
