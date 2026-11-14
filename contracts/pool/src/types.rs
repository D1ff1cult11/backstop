use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId};

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    pub epoch_ns: U64,
    pub base_premium_bps: u32,
    pub min_stake_bps: u32,
    pub max_cover: U128,
    pub deductible_bps: u32,
    pub max_payout_bps: u32,
    pub claim_bond_bps: u32,
    pub min_claim_bond: U128,
    pub jury_size: u32,
    pub commit_ns: U64,
    pub reveal_ns: U64,
    pub juror_fee_bps: u32,
    pub juror_slash_bps: u32,
    pub posture_tolerance: u8,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Payee {
    pub account: AccountId,
    pub added_at: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Member {
    pub account: AccountId,
    pub cover: U128,
    pub cover_remaining: U128,
    pub stake: U128,
    pub bond_reserved: U128,
    pub declared_score: u8,
    pub joined_at: U64,
    pub paid_through_epoch: u64,
    pub payees: Vec<Payee>,
    pub open_claim: Option<u32>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub enum ClaimStatus {
    Open,
    Approved,
    Rejected,
    Void,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct JurorVote {
    pub juror: AccountId,
    pub commitment: Option<String>,
    pub revealed: Option<bool>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Claim {
    pub id: u32,
    pub claimant: AccountId,
    pub loss_tx_hash: String,
    pub amount: U128,
    pub evidence: String,
    pub bond: U128,
    pub filed_at: U64,
    pub commit_deadline: U64,
    pub reveal_deadline: U64,
    pub jury: Vec<JurorVote>,
    pub status: ClaimStatus,
    pub payout: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PoolStats {
    pub pool_balance: U128,
    pub total_stake: U128,
    pub members: u32,
    pub active_members: u32,
    pub total_cover_remaining: U128,
    pub solvency_bps: u32,
    pub claims: u32,
    pub current_epoch: u64,
}
