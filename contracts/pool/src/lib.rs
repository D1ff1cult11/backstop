use near_sdk::store::{IterableMap, LookupSet, Vector};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault};

mod types;
pub use types::*;

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Members,
    Claims,
    ClaimedTx,
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::json_types::{U128, U64};
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn sample_config() -> Config {
        Config {
            epoch_ns: U64(600_000_000_000),
            base_premium_bps: 100,
            min_stake_bps: 2000,
            max_cover: U128(1_000_000_000_000_000_000_000_000),
            deductible_bps: 2000,
            max_payout_bps: 5000,
            claim_bond_bps: 1000,
            min_claim_bond: U128(50_000_000_000_000_000_000_000),
            jury_size: 4,
            commit_ns: U64(90_000_000_000),
            reveal_ns: U64(90_000_000_000),
            juror_fee_bps: 500,
            juror_slash_bps: 1000,
            posture_tolerance: 10,
        }
    }

    #[test]
    fn test_init_stores_config() {
        let context = VMContextBuilder::new()
            .predecessor_account_id(accounts(0))
            .block_timestamp(1_000_000_000)
            .build();
        testing_env!(context);

        let cfg = sample_config();
        let pool = Pool::new(cfg.clone());
        assert_eq!(pool.get_config(), cfg);
        assert_eq!(pool.genesis_ns, 1_000_000_000);
        assert_eq!(pool.pool_balance, 0);
    }

    #[test]
    #[should_panic(expected = "invalid base_premium_bps")]
    fn test_invalid_bps_panics() {
        let mut cfg = sample_config();
        cfg.base_premium_bps = 10_001;
        Pool::new(cfg);
    }

    #[test]
    #[should_panic(expected = "jury_size must be >= 1")]
    fn test_invalid_jury_size_panics() {
        let mut cfg = sample_config();
        cfg.jury_size = 0;
        Pool::new(cfg);
    }

    #[test]
    #[should_panic(expected = "epoch_ns must be > 0")]
    fn test_invalid_epoch_ns_panics() {
        let mut cfg = sample_config();
        cfg.epoch_ns = U64(0);
        Pool::new(cfg);
    }
}
