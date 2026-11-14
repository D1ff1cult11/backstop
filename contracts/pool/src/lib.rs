use near_sdk::json_types::{U128, U64};
use near_sdk::store::{IterableMap, LookupSet, Vector};
use near_sdk::{
    env, near, require, serde_json, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise,
};

mod types;
pub use types::*;

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Members,
    Claims,
    ClaimedTx,
}

fn emit(event: &str, data: serde_json::Value) {
    let event_json = serde_json::json!({
        "standard": "backstop",
        "version": "1.0.0",
        "event": event,
        "data": [data]
    });
    env::log_str(&format!("EVENT_JSON:{}", event_json));
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Pool {
    config: Config,
    genesis_ns: u64,
    pool_balance: u128,
    members: IterableMap<AccountId, Member>,
    claims: Vector<Claim>,
    claimed_tx: LookupSet<String>,
}

#[near]
impl Pool {
    #[init]
    pub fn new(config: Config) -> Self {
        require!(config.base_premium_bps <= 10000, "invalid base_premium_bps");
        require!(config.min_stake_bps <= 10000, "invalid min_stake_bps");
        require!(config.deductible_bps <= 10000, "invalid deductible_bps");
        require!(config.max_payout_bps <= 10000, "invalid max_payout_bps");
        require!(config.claim_bond_bps <= 10000, "invalid claim_bond_bps");
        require!(config.juror_fee_bps <= 10000, "invalid juror_fee_bps");
        require!(config.juror_slash_bps <= 10000, "invalid juror_slash_bps");
        require!(config.jury_size >= 1, "jury_size must be >= 1");
        require!(config.epoch_ns.0 > 0, "epoch_ns must be > 0");

        Self {
            config,
            genesis_ns: env::block_timestamp(),
            pool_balance: 0,
            members: IterableMap::new(StorageKey::Members),
            claims: Vector::new(StorageKey::Claims),
            claimed_tx: LookupSet::new(StorageKey::ClaimedTx),
        }
    }

    pub fn get_config(&self) -> Config {
        self.config.clone()
    }

    pub fn current_epoch(&self) -> u64 {
        let now = env::block_timestamp();
        if now < self.genesis_ns { 0 } else { (now - self.genesis_ns) / self.config.epoch_ns.0 }
    }

    pub fn premium_per_epoch(&self, cover: U128, score: u8) -> U128 {
        let mult = (30000u32.saturating_sub(250u32 * (score as u32))) as u128;
        let prem = cover.0.checked_mul(self.config.base_premium_bps as u128).expect("ovf")
            .checked_mul(mult).expect("ovf") / 10000 / 10000;
        U128(prem)
    }

    pub fn is_active_member(&self, member: &Member) -> bool {
        member.paid_through_epoch >= self.current_epoch()
    }

    fn refund_excess(&self, required: u128) {
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached >= required, "insufficient deposit");
        let excess = attached - required;
        if excess > 0 {
            let _ = Promise::new(env::predecessor_account_id()).transfer(NearToken::from_yoctonear(excess));
        }
    }

    #[payable]
    pub fn join(&mut self, cover: U128, declared_score: u8, epochs: u32, payees: Vec<AccountId>) {
        let account = env::predecessor_account_id();
        require!(!self.members.contains_key(&account), "already a member");
        require!(cover.0 <= self.config.max_cover.0, "cover exceeds max_cover");
        require!(declared_score <= 100, "declared_score must be <= 100");
        require!(epochs >= 1, "epochs must be >= 1");

        let stake = cover.0 * (self.config.min_stake_bps as u128) / 10000;
        let prem = self.premium_per_epoch(cover, declared_score).0 * (epochs as u128);
        self.refund_excess(stake + prem);
        self.pool_balance += prem;

        let now = env::block_timestamp();
        let paid_through = self.current_epoch() + (epochs as u64) - 1;
        let p_list = payees.into_iter().map(|a| Payee { account: a, added_at: U64(now) }).collect();

        self.members.insert(account.clone(), Member {
            account: account.clone(), cover, cover_remaining: cover, stake: U128(stake),
            bond_reserved: U128(0), declared_score, joined_at: U64(now),
            paid_through_epoch: paid_through, payees: p_list, open_claim: None,
        });

        emit("member_joined", serde_json::json!({
            "account": account, "cover": cover, "declared_score": declared_score,
            "stake": U128(stake), "paid_through_epoch": paid_through
        }));
    }

    #[payable]
    pub fn pay_premium(&mut self, epochs: u32) {
        let account = env::predecessor_account_id();
        let mut m = self.members.get(&account).cloned().expect("not a member");
        require!(epochs >= 1, "epochs must be >= 1");

        let prem = self.premium_per_epoch(m.cover, m.declared_score).0 * (epochs as u128);
        self.refund_excess(prem);
        self.pool_balance += prem;

        let cur = self.current_epoch();
        let new_pt = if m.paid_through_epoch >= cur { m.paid_through_epoch + (epochs as u64) } else { cur + (epochs as u64) - 1 };
        m.paid_through_epoch = new_pt;
        self.members.insert(account.clone(), m);

        emit("premium_paid", serde_json::json!({ "account": account, "epochs": epochs, "paid_through_epoch": new_pt, "premium": U128(prem) }));
    }

    pub fn register_payee(&mut self, account: AccountId) {
        let caller = env::predecessor_account_id();
        let mut m = self.members.get(&caller).cloned().expect("not a member");
        if !m.payees.iter().any(|p| p.account == account) {
            m.payees.push(Payee { account: account.clone(), added_at: U64(env::block_timestamp()) });
            self.members.insert(caller.clone(), m);
            emit("payee_registered", serde_json::json!({ "account": caller, "payee": account }));
        }
    }

    pub fn leave(&mut self) {
        let caller = env::predecessor_account_id();
        let m = self.members.get(&caller).cloned().expect("not a member");
        require!(m.open_claim.is_none(), "open claim exists");
        for c in self.claims.iter() {
            if c.status == ClaimStatus::Open {
                for j in &c.jury { require!(j.juror != caller, "juror on open claim"); }
            }
        }
        let stake = m.stake.0;
        self.members.remove(&caller);
        let _ = Promise::new(caller.clone()).transfer(NearToken::from_yoctonear(stake));
        emit("member_left", serde_json::json!({ "account": caller, "stake_returned": U128(stake) }));
    }

    #[payable]
    pub fn fund_pool(&mut self) {
        let deposit = env::attached_deposit().as_yoctonear();
        require!(deposit > 0, "deposit must be positive");
        self.pool_balance += deposit;
        emit("pool_funded", serde_json::json!({ "funder": env::predecessor_account_id(), "amount": U128(deposit) }));
    }

    pub fn file_claim(&mut self, loss_tx_hash: String, amount: U128, evidence: String) -> u32 {
        let claimant = env::predecessor_account_id();
        let mut member = self.members.get(&claimant).cloned().expect("not a member");

        require!(self.is_active_member(&member), "claimant is not active");
        require!(member.open_claim.is_none(), "already has open claim");
        require!(amount.0 <= member.cover_remaining.0, "amount exceeds cover_remaining");
        require!(!self.claimed_tx.contains(&loss_tx_hash), "transaction already claimed");

        let bond_bps = amount.0 * (self.config.claim_bond_bps as u128) / 10000;
        let bond = std::cmp::max(bond_bps, self.config.min_claim_bond.0);
        require!(member.stake.0 >= bond, "stake too small for bond");

        member.stake.0 -= bond;
        member.bond_reserved.0 += bond;

        let jury = self.draw_jury(&claimant);
        let now = env::block_timestamp();
        let commit_deadline = now + self.config.commit_ns.0;
        let reveal_deadline = commit_deadline + self.config.reveal_ns.0;
        let claim_id = self.claims.len();

        let jury_votes = jury.into_iter().map(|juror| JurorVote { juror, commitment: None, revealed: None }).collect();
        self.claims.push(Claim {
            id: claim_id, claimant: claimant.clone(), loss_tx_hash: loss_tx_hash.clone(), amount,
            evidence, bond: U128(bond), filed_at: U64(now), commit_deadline: U64(commit_deadline),
            reveal_deadline: U64(reveal_deadline), jury: jury_votes, status: ClaimStatus::Open, payout: U128(0),
        });

        self.claimed_tx.insert(loss_tx_hash);
        member.open_claim = Some(claim_id);
        self.members.insert(claimant.clone(), member);

        emit("claim_filed", serde_json::json!({
            "claim_id": claim_id, "claimant": claimant, "amount": amount, "bond": U128(bond)
        }));

        claim_id
    }

    pub fn commit_vote(&mut self, claim_id: u32, commitment: String) {
        let caller = env::predecessor_account_id();
        let mut claim = self.claims.get(claim_id).cloned().expect("claim not found");
        require!(claim.status == ClaimStatus::Open, "claim is not open");
        require!(env::block_timestamp() < claim.commit_deadline.0, "commit deadline passed");

        let juror_vote = claim.jury.iter_mut().find(|j| j.juror == caller).expect("not a juror");
        require!(juror_vote.commitment.is_none(), "already committed");
        juror_vote.commitment = Some(commitment);

        self.claims.replace(claim_id, claim);
        emit("vote_committed", serde_json::json!({ "claim_id": claim_id, "juror": caller }));
    }

    pub fn reveal_vote(&mut self, claim_id: u32, approve: bool, salt: String) {
        let caller = env::predecessor_account_id();
        let mut claim = self.claims.get(claim_id).cloned().expect("claim not found");
        require!(claim.status == ClaimStatus::Open, "claim is not open");
        let now = env::block_timestamp();
        require!(now >= claim.commit_deadline.0, "commit window still open");
        require!(now < claim.reveal_deadline.0, "reveal deadline passed");

        let juror_vote = claim.jury.iter_mut().find(|j| j.juror == caller).expect("not a juror");
        let commitment = juror_vote.commitment.as_ref().expect("no commitment found");
        require!(juror_vote.revealed.is_none(), "already revealed");

        let vote_str = if approve { "1" } else { "0" };
        let expected_hash = to_hex(&env::sha256(format!("{}:{}", vote_str, salt).as_bytes()));
        require!(&expected_hash == commitment, "commitment mismatch");

        juror_vote.revealed = Some(approve);
        self.claims.replace(claim_id, claim);
        emit("vote_revealed", serde_json::json!({ "claim_id": claim_id, "juror": caller, "approve": approve }));
    }

    fn draw_jury(&self, claimant: &AccountId) -> Vec<AccountId> {
        let mut eligible: Vec<AccountId> = Vec::new();
        for (acct, m) in self.members.iter() {
            if acct != claimant && self.is_active_member(m) { eligible.push(acct.clone()); }
        }
        require!(eligible.len() >= self.config.jury_size as usize, "not enough jurors");

        let seed = env::random_seed_array();
        for i in (1..eligible.len()).rev() {
            let offset = (i * 4) % 28;
            let bytes: [u8; 4] = seed[offset..offset + 4].try_into().unwrap();
            let j = (u32::from_le_bytes(bytes) as usize) % (i + 1);
            eligible.swap(i, j);
        }
        eligible.into_iter().take(self.config.jury_size as usize).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::json_types::{U128, U64};
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn sample_config() -> Config {
        Config {
            epoch_ns: U64(600_000_000_000), base_premium_bps: 100, min_stake_bps: 2000,
            max_cover: U128(1_000_000_000_000_000_000_000_000), deductible_bps: 2000, max_payout_bps: 5000,
            claim_bond_bps: 1000, min_claim_bond: U128(50_000_000_000_000_000_000_000), jury_size: 4,
            commit_ns: U64(90_000_000_000), reveal_ns: U64(90_000_000_000), juror_fee_bps: 500,
            juror_slash_bps: 1000, posture_tolerance: 10,
        }
    }

    fn setup_pool_for_voting() -> (Pool, u32) {
        let mut pool = Pool::new(sample_config());
        let one_near = 1_000_000_000_000_000_000_000_000u128;
        for i in 0..5 {
            let mut ctx = VMContextBuilder::new();
            ctx.predecessor_account_id(accounts(i)).attached_deposit(NearToken::from_yoctonear(one_near));
            testing_env!(ctx.build());
            pool.join(U128(one_near), 100, 10, vec![]);
        }
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(accounts(0)).block_timestamp(1_000).random_seed([7u8; 32]);
        testing_env!(ctx.build());
        let cid = pool.file_claim("tx_loss".to_string(), U128(one_near), "ev".to_string());
        (pool, cid)
    }

    fn make_commitment(approve: bool, salt: &str) -> String {
        to_hex(&env::sha256(format!("{}:{}", if approve { "1" } else { "0" }, salt).as_bytes()))
    }

    #[test]
    fn test_commit_and_reveal_vote_success() {
        let (mut pool, cid) = setup_pool_for_voting();
        let j0 = pool.claims.get(cid).unwrap().jury[0].juror.clone();

        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(j0.clone()).block_timestamp(1_500);
        testing_env!(ctx.build());
        pool.commit_vote(cid, make_commitment(true, "salt_123"));

        let t_reveal = 1_000 + 90_000_000_000 + 100;
        ctx.block_timestamp(t_reveal);
        testing_env!(ctx.build());
        pool.reveal_vote(cid, true, "salt_123".to_string());

        let claim = pool.claims.get(cid).unwrap();
        assert_eq!(claim.jury[0].revealed, Some(true));
    }

    #[test]
    #[should_panic(expected = "commitment mismatch")]
    fn test_wrong_salt_panics() {
        let (mut pool, cid) = setup_pool_for_voting();
        let j0 = pool.claims.get(cid).unwrap().jury[0].juror.clone();
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(j0.clone()).block_timestamp(1_500);
        testing_env!(ctx.build());
        pool.commit_vote(cid, make_commitment(true, "salt_real"));

        ctx.block_timestamp(1_000 + 90_000_000_000 + 100);
        testing_env!(ctx.build());
        pool.reveal_vote(cid, true, "salt_fake".to_string());
    }

    #[test]
    #[should_panic(expected = "commit window still open")]
    fn test_reveal_before_deadline_panics() {
        let (mut pool, cid) = setup_pool_for_voting();
        let j0 = pool.claims.get(cid).unwrap().jury[0].juror.clone();
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(j0.clone()).block_timestamp(1_500);
        testing_env!(ctx.build());
        pool.commit_vote(cid, make_commitment(true, "salt"));
        pool.reveal_vote(cid, true, "salt".to_string());
    }
}
