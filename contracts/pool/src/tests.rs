//! Unit tests for the pool. Each test names the RULES.md section it checks.
use super::*;
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::testing_env;

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const T_FILE: u64 = 1_000_000_000;
const T_COMMIT: u64 = T_FILE + 1;
const T_REVEAL: u64 = T_FILE + 91_000_000_000;
const T_RESOLVE: u64 = T_FILE + 181_000_000_000;

fn config() -> Config {
    Config {
        epoch_ns: U64(600_000_000_000),
        base_premium_bps: 100,
        min_stake_bps: 2000,
        max_cover: U128(NEAR),
        deductible_bps: 2000,
        max_payout_bps: 5000,
        claim_bond_bps: 1000,
        min_claim_bond: U128(NEAR / 20),
        jury_size: 4,
        commit_ns: U64(90_000_000_000),
        reveal_ns: U64(90_000_000_000),
        juror_fee_bps: 500,
        juror_slash_bps: 1000,
        posture_tolerance: 10,
    }
}

fn ctx(who: AccountId, deposit: u128, ts: u64) {
    let mut b = VMContextBuilder::new();
    b.predecessor_account_id(who)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(ts);
    testing_env!(b.build());
}

/// A pool with `n` members (accounts 0..n), each with 1 NEAR cover, score 100, 10 epochs paid.
fn pool_with(n: usize, funded: u128) -> Pool {
    ctx(accounts(5), 0, 0);
    let mut pool = Pool::new(config());
    for i in 0..n {
        ctx(accounts(i), NEAR, 0);
        pool.join(U128(NEAR), 100, 10, vec![]);
    }
    if funded > 0 {
        ctx(accounts(5), funded, 0);
        pool.fund_pool();
    }
    pool
}

fn file(pool: &mut Pool, who: usize, hash: &str, amount: u128) -> u32 {
    ctx(accounts(who), 0, T_FILE);
    pool.file_claim(hash.to_string(), U128(amount), "evidence".to_string())
}

fn jurors(pool: &Pool, id: u32) -> Vec<AccountId> {
    pool.get_claim(id).unwrap().jury.into_iter().map(|j| j.juror).collect()
}

fn commit(pool: &mut Pool, juror: &AccountId, id: u32, approve: bool, salt: &str) {
    ctx(juror.clone(), 0, T_COMMIT);
    let vote = if approve { "1" } else { "0" };
    let commitment = to_hex(&env::sha256(format!("{}:{}", vote, salt).as_bytes()));
    pool.commit_vote(id, commitment);
}

fn reveal(pool: &mut Pool, juror: &AccountId, id: u32, approve: bool, salt: &str) {
    ctx(juror.clone(), 0, T_REVEAL);
    pool.reveal_vote(id, approve, salt.to_string());
}

/// Every juror commits; the first `votes.len()` jurors reveal those votes; then the claim resolves.
fn run_round(pool: &mut Pool, id: u32, votes: &[bool]) -> Vec<AccountId> {
    let jury = jurors(pool, id);
    for (i, j) in jury.iter().enumerate() {
        commit(pool, j, id, *votes.get(i).unwrap_or(&true), "salt");
    }
    for (i, v) in votes.iter().enumerate() {
        reveal(pool, &jury[i], id, *v, "salt");
    }
    ctx(accounts(5), 0, T_RESOLVE);
    pool.resolve_claim(id);
    jury
}

fn stake_of(pool: &Pool, who: &AccountId) -> u128 {
    pool.get_member(who.clone()).unwrap().stake.0
}

// ---- RULES §4 premium, §5 membership ----

#[test]
fn premium_follows_the_posture_multiplier() {
    let pool = pool_with(0, 0);
    assert_eq!(pool.premium_per_epoch(U128(NEAR), 100).0, NEAR / 200); // 0.5x of 1%
    assert_eq!(pool.premium_per_epoch(U128(NEAR), 70).0, NEAR / 80); // 1.25x
    assert_eq!(pool.premium_per_epoch(U128(NEAR), 0).0, NEAR * 3 / 100); // 3x
}

#[test]
fn join_holds_stake_and_books_premium() {
    let pool = pool_with(1, 0);
    let m = pool.get_member(accounts(0)).unwrap();
    assert_eq!(m.stake.0, NEAR / 5);
    assert_eq!(m.paid_through_epoch, 9);
    assert_eq!(pool.get_pool_stats().pool_balance.0, NEAR / 200 * 10);
}

#[test]
#[should_panic(expected = "insufficient deposit")]
fn join_rejects_a_low_deposit() {
    let mut pool = pool_with(0, 0);
    ctx(accounts(0), NEAR / 5, 0); // stake only, no premium
    pool.join(U128(NEAR), 100, 1, vec![]);
}

#[test]
fn membership_lapses_and_pay_premium_restores_it() {
    let mut pool = pool_with(1, 0);
    ctx(accounts(0), NEAR, 10 * 600_000_000_000);
    assert!(!pool.is_active(accounts(0)));
    pool.pay_premium(2);
    assert_eq!(pool.get_member(accounts(0)).unwrap().paid_through_epoch, 11);
    assert!(pool.is_active(accounts(0)));
}

// ---- RULES §7 filing and jury draw ----

#[test]
fn file_claim_reserves_bond_and_draws_a_jury_without_the_claimant() {
    let mut pool = pool_with(5, 0);
    let id = file(&mut pool, 0, "tx1", NEAR / 5);
    let m = pool.get_member(accounts(0)).unwrap();
    assert_eq!(m.bond_reserved.0, NEAR / 20); // min bond beats 10% of 0.2
    assert_eq!(m.stake.0, NEAR / 5 - NEAR / 20);
    assert_eq!(m.open_claim, Some(id));
    let jury = jurors(&pool, id);
    assert_eq!(jury.len(), 4);
    assert!(!jury.contains(&accounts(0)));
}

#[test]
#[should_panic(expected = "not enough jurors")]
fn file_claim_needs_a_full_jury() {
    let mut pool = pool_with(4, 0);
    file(&mut pool, 0, "tx1", NEAR / 5);
}

#[test]
#[should_panic(expected = "transaction already claimed")]
fn a_loss_transaction_cannot_be_claimed_twice() {
    let mut pool = pool_with(5, 0);
    file(&mut pool, 0, "tx1", NEAR / 5);
    file(&mut pool, 1, "tx1", NEAR / 5);
}

#[test]
#[should_panic(expected = "already has open claim")]
fn one_open_claim_per_member() {
    let mut pool = pool_with(5, 0);
    file(&mut pool, 0, "tx1", NEAR / 5);
    file(&mut pool, 0, "tx2", NEAR / 5);
}

#[test]
#[should_panic(expected = "amount exceeds cover_remaining")]
fn claim_cannot_exceed_cover() {
    let mut pool = pool_with(5, 0);
    file(&mut pool, 0, "tx1", 2 * NEAR);
}

#[test]
#[should_panic(expected = "stake too small for bond")]
fn bond_must_fit_in_stake() {
    let mut pool = pool_with(5, 0);
    ctx(accounts(5), NEAR, 0);
    pool.join(U128(NEAR / 10), 100, 10, vec![]); // stake 0.02 < min bond 0.05
    ctx(accounts(5), 0, T_FILE);
    pool.file_claim("tx1".to_string(), U128(NEAR / 20), "evidence".to_string());
}

// ---- RULES §7 commit-reveal ----

#[test]
#[should_panic(expected = "commit deadline passed")]
fn commit_after_the_window_fails() {
    let mut pool = pool_with(5, 0);
    let id = file(&mut pool, 0, "tx1", NEAR / 5);
    let jury = jurors(&pool, id);
    ctx(jury[0].clone(), 0, T_REVEAL);
    pool.commit_vote(id, "00".to_string());
}

#[test]
#[should_panic(expected = "commit window still open")]
fn reveal_before_the_commit_window_closes_fails() {
    let mut pool = pool_with(5, 0);
    let id = file(&mut pool, 0, "tx1", NEAR / 5);
    let jury = jurors(&pool, id);
    commit(&mut pool, &jury[0], id, true, "salt");
    ctx(jury[0].clone(), 0, T_COMMIT + 1);
    pool.reveal_vote(id, true, "salt".to_string());
}

#[test]
#[should_panic(expected = "commitment mismatch")]
fn reveal_must_match_the_commitment() {
    let mut pool = pool_with(5, 0);
    let id = file(&mut pool, 0, "tx1", NEAR / 5);
    let jury = jurors(&pool, id);
    commit(&mut pool, &jury[0], id, true, "salt");
    reveal(&mut pool, &jury[0], id, false, "salt"); // flips the vote
}

#[test]
#[should_panic(expected = "not a juror")]
fn only_drawn_jurors_can_commit() {
    let mut pool = pool_with(5, 0);
    let id = file(&mut pool, 0, "tx1", NEAR / 5);
    commit(&mut pool, &accounts(0), id, true, "salt"); // the claimant
}

// ---- RULES §7 resolution ----

#[test]
fn approved_claim_pays_80_percent_rewards_coherent_jurors_and_slashes_the_absent_one() {
    let mut pool = pool_with(5, 3 * NEAR);
    let before = pool.get_pool_stats().pool_balance.0;
    let id = file(&mut pool, 0, "tx1", NEAR / 5);
    let jury = run_round(&mut pool, id, &[true, true, true]); // the 4th juror never reveals

    let claim = pool.get_claim(id).unwrap();
    let payout = NEAR / 5 * 8 / 10;
    let reward = payout * 5 / 100;
    let slash = NEAR / 5 / 10;
    assert_eq!(claim.status, ClaimStatus::Approved);
    assert_eq!(claim.payout.0, payout);

    let claimant = pool.get_member(accounts(0)).unwrap();
    assert_eq!(claimant.stake.0, NEAR / 5); // bond released
    assert_eq!(claimant.bond_reserved.0, 0);
    assert_eq!(claimant.cover_remaining.0, NEAR - payout);
    assert_eq!(claimant.open_claim, None);

    assert_eq!(stake_of(&pool, &jury[0]), NEAR / 5 + reward / 3);
    assert_eq!(stake_of(&pool, &jury[3]), NEAR / 5 - slash);
    assert_eq!(pool.get_pool_stats().pool_balance.0, before - payout - reward + slash);
}

#[test]
fn payout_is_capped_at_half_the_pool() {
    let mut pool = pool_with(5, 0); // premiums only: 0.25 NEAR in the pool
    let before = pool.get_pool_stats().pool_balance.0;
    let id = file(&mut pool, 0, "tx1", NEAR / 5);
    run_round(&mut pool, id, &[true, true, true, true]);
    assert_eq!(pool.get_claim(id).unwrap().payout.0, before / 2);
}

#[test]
fn rejected_claim_forfeits_the_bond_half_to_coherent_jurors() {
    let mut pool = pool_with(5, 3 * NEAR);
    let id = file(&mut pool, 0, "tx1", NEAR / 5);
    let jury = run_round(&mut pool, id, &[false, false, false]);

    let claim = pool.get_claim(id).unwrap();
    assert_eq!(claim.status, ClaimStatus::Rejected);
    assert_eq!(claim.payout.0, 0);
    let bond = NEAR / 20;
    let claimant = pool.get_member(accounts(0)).unwrap();
    assert_eq!(claimant.stake.0, NEAR / 5 - bond);
    assert_eq!(claimant.bond_reserved.0, 0);
    assert_eq!(claimant.cover_remaining.0, NEAR);
    assert_eq!(stake_of(&pool, &jury[0]), NEAR / 5 + bond / 2 / 3);
    assert_eq!(stake_of(&pool, &jury[3]), NEAR / 5 * 9 / 10);
}

#[test]
fn a_tie_is_rejected() {
    let mut pool = pool_with(5, 3 * NEAR);
    let id = file(&mut pool, 0, "tx1", NEAR / 5);
    run_round(&mut pool, id, &[true, true, false, false]);
    assert_eq!(pool.get_claim(id).unwrap().status, ClaimStatus::Rejected);
}

#[test]
fn under_quorum_is_void_refunds_the_bond_and_slashes_only_non_revealers() {
    let mut pool = pool_with(5, 3 * NEAR);
    let id = file(&mut pool, 0, "tx1", NEAR / 5);
    let jury = run_round(&mut pool, id, &[true]); // 1 reveal < quorum of 2

    assert_eq!(pool.get_claim(id).unwrap().status, ClaimStatus::Void);
    let claimant = pool.get_member(accounts(0)).unwrap();
    assert_eq!(claimant.stake.0, NEAR / 5);
    assert_eq!(claimant.open_claim, None);
    assert_eq!(stake_of(&pool, &jury[0]), NEAR / 5);
    for j in &jury[1..] {
        assert_eq!(stake_of(&pool, j), NEAR / 5 * 9 / 10);
    }
}

#[test]
#[should_panic(expected = "reveal window not closed")]
fn resolve_waits_for_the_reveal_window() {
    let mut pool = pool_with(5, 0);
    let id = file(&mut pool, 0, "tx1", NEAR / 5);
    ctx(accounts(5), 0, T_REVEAL);
    pool.resolve_claim(id);
}

// ---- RULES §5 leave ----

#[test]
#[should_panic(expected = "juror on open claim")]
fn a_juror_cannot_leave_during_an_open_claim() {
    let mut pool = pool_with(5, 0);
    let id = file(&mut pool, 0, "tx1", NEAR / 5);
    let jury = jurors(&pool, id);
    ctx(jury[0].clone(), 0, T_COMMIT);
    pool.leave();
}

#[test]
fn leave_removes_the_member() {
    let mut pool = pool_with(2, 0);
    ctx(accounts(1), 0, 1);
    pool.leave();
    assert!(pool.get_member(accounts(1)).is_none());
    assert_eq!(pool.get_pool_stats().members, 1);
}
