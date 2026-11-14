use near_sdk::json_types::U128;
use near_sdk::store::Vector;
use near_sdk::{
    env, near, require, serde_json, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise,
};

mod types;
pub use types::*;

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Allowlist,
}

fn emit(event: &str, data: serde_json::Value) {
    let event_json = serde_json::json!({
        "standard": "backstop-wallet",
        "version": "1.0.0",
        "event": event,
        "data": [data]
    });
    env::log_str(&format!("EVENT_JSON:{}", event_json));
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Wallet {
    owner: AccountId,
    per_tx_cap: u128,
    daily_cap: u128,
    allowlist_enabled: bool,
    allowlist: Vector<AccountId>,
    spent_today: u128,
    last_day: u64,
}

#[near]
impl Wallet {
    #[init]
    pub fn new(
        owner: AccountId,
        per_tx_cap: U128,
        daily_cap: U128,
        allowlist_enabled: bool,
        allowlist: Vec<AccountId>,
    ) -> Self {
        let mut list = Vector::new(StorageKey::Allowlist);
        for a in allowlist {
            list.push(a);
        }
        let now = env::block_timestamp();
        let day = now / 86_400_000_000_000;

        Self {
            owner,
            per_tx_cap: per_tx_cap.0,
            daily_cap: daily_cap.0,
            allowlist_enabled,
            allowlist: list,
            spent_today: 0,
            last_day: day,
        }
    }

    pub fn pay(&mut self, to: AccountId, amount: U128) -> Promise {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "only self can call pay"
        );

        let now = env::block_timestamp();
        let current_day = now / 86_400_000_000_000;
        if current_day > self.last_day {
            self.spent_today = 0;
            self.last_day = current_day;
        }

        require!(amount.0 <= self.per_tx_cap, "amount exceeds per_tx_cap");
        require!(
            self.spent_today + amount.0 <= self.daily_cap,
            "amount exceeds daily_cap"
        );

        if self.allowlist_enabled {
            let is_allowed = self.allowlist.iter().any(|a| a == &to);
            require!(is_allowed, "recipient not on allowlist");
        }

        self.spent_today += amount.0;

        emit(
            "paid",
            serde_json::json!({
                "to": to,
                "amount": amount
            }),
        );

        Promise::new(to).transfer(NearToken::from_yoctonear(amount.0))
    }

    pub fn set_policy(
        &mut self,
        per_tx_cap: U128,
        daily_cap: U128,
        allowlist_enabled: bool,
    ) {
        require!(
            env::predecessor_account_id() == self.owner,
            "only owner can set policy"
        );
        self.per_tx_cap = per_tx_cap.0;
        self.daily_cap = daily_cap.0;
        self.allowlist_enabled = allowlist_enabled;
    }

    pub fn allow(&mut self, account: AccountId) {
        require!(
            env::predecessor_account_id() == self.owner,
            "only owner can allow accounts"
        );
        if !self.allowlist.iter().any(|a| a == &account) {
            self.allowlist.push(account);
        }
    }

    pub fn get_policy(&self) -> Policy {
        let now = env::block_timestamp();
        let current_day = now / 86_400_000_000_000;
        let spent = if current_day > self.last_day { 0 } else { self.spent_today };

        Policy {
            owner: self.owner.clone(),
            per_tx_cap: U128(self.per_tx_cap),
            daily_cap: U128(self.daily_cap),
            allowlist_enabled: self.allowlist_enabled,
            allowlist: self.allowlist.iter().cloned().collect(),
            spent_today: U128(spent),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn sample_wallet() -> Wallet {
        Wallet::new(
            accounts(0), // owner
            U128(200_000_000_000_000_000_000_000), // per_tx: 0.2 NEAR
            U128(500_000_000_000_000_000_000_000), // daily: 0.5 NEAR
            true,                                  // allowlist enabled
            vec![accounts(2)],                     // allowed: accounts(2)
        )
    }

    #[test]
    #[should_panic(expected = "only self can call pay")]
    fn test_call_from_another_account_panics() {
        let mut ctx = VMContextBuilder::new();
        ctx.current_account_id(accounts(1)).predecessor_account_id(accounts(0));
        testing_env!(ctx.build());
        let mut wallet = sample_wallet();
        let _ = wallet.pay(accounts(2), U128(100_000_000_000_000_000_000_000));
    }

    #[test]
    #[should_panic(expected = "amount exceeds per_tx_cap")]
    fn test_over_per_tx_cap_panics() {
        let mut ctx = VMContextBuilder::new();
        ctx.current_account_id(accounts(1)).predecessor_account_id(accounts(1));
        testing_env!(ctx.build());
        let mut wallet = sample_wallet();
        let _ = wallet.pay(accounts(2), U128(300_000_000_000_000_000_000_000)); // 0.3 > 0.2
    }

    #[test]
    #[should_panic(expected = "amount exceeds daily_cap")]
    fn test_over_daily_cap_panics() {
        let mut ctx = VMContextBuilder::new();
        ctx.current_account_id(accounts(1)).predecessor_account_id(accounts(1));
        testing_env!(ctx.build());
        let mut wallet = sample_wallet();
        let _ = wallet.pay(accounts(2), U128(200_000_000_000_000_000_000_000)); // 0.2 spent
        let _ = wallet.pay(accounts(2), U128(200_000_000_000_000_000_000_000)); // 0.4 spent
        let _ = wallet.pay(accounts(2), U128(200_000_000_000_000_000_000_000)); // 0.6 > 0.5 panics
    }

    #[test]
    #[should_panic(expected = "recipient not on allowlist")]
    fn test_recipient_off_allowlist_panics() {
        let mut ctx = VMContextBuilder::new();
        ctx.current_account_id(accounts(1)).predecessor_account_id(accounts(1));
        testing_env!(ctx.build());
        let mut wallet = sample_wallet();
        let _ = wallet.pay(accounts(3), U128(100_000_000_000_000_000_000_000)); // accounts(3) not allowed
    }

    #[test]
    fn test_valid_payment_succeeds_and_updates_spent() {
        let mut ctx = VMContextBuilder::new();
        ctx.current_account_id(accounts(1)).predecessor_account_id(accounts(1));
        testing_env!(ctx.build());
        let mut wallet = sample_wallet();
        let _ = wallet.pay(accounts(2), U128(150_000_000_000_000_000_000_000));
        assert_eq!(wallet.spent_today, 150_000_000_000_000_000_000_000);
        let policy = wallet.get_policy();
        assert_eq!(policy.spent_today.0, 150_000_000_000_000_000_000_000);
    }
}
