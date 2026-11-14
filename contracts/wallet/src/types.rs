use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Policy {
    pub owner: AccountId,
    pub per_tx_cap: U128,
    pub daily_cap: U128,
    pub allowlist_enabled: bool,
    pub allowlist: Vec<AccountId>,
    pub spent_today: U128,
}
