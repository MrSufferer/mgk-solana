use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    None,
    Long,
    Short,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum OracleType {
    None,
    Custom,
    Pyth,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum FeesMode {
    Fixed,
    Linear,
    Optimal,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum AumCalcMode {
    Min,
    Max,
    Last,
    EMA,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct Permissions {
    pub allow_swap: bool,
    pub allow_add_liquidity: bool,
    pub allow_remove_liquidity: bool,
    pub allow_open_position: bool,
    pub allow_close_position: bool,
    pub allow_pnl_withdrawal: bool,
    pub allow_collateral_withdrawal: bool,
    pub allow_size_change: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct OracleParams {
    pub oracle_account: Pubkey,
    pub oracle_type: OracleType,
    pub oracle_authority: Pubkey,
    pub max_price_error: u64,
    pub max_price_age_sec: u32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct PricingParams {
    pub use_ema: bool,
    pub use_unrealized_pnl_in_aum: bool,
    pub trade_spread_long: u64,
    pub trade_spread_short: u64,
    pub swap_spread: u64,
    pub min_initial_leverage: u64,
    pub max_initial_leverage: u64,
    pub max_leverage: u64,
    pub max_payoff_mult: u64,
    pub max_utilization: u64,
    pub max_position_locked_usd: u64,
    pub max_total_locked_usd: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct Fees {
    pub mode: FeesMode,
    pub ratio_mult: u64,
    pub utilization_mult: u64,
    pub swap_in: u64,
    pub swap_out: u64,
    pub stable_swap_in: u64,
    pub stable_swap_out: u64,
    pub add_liquidity: u64,
    pub remove_liquidity: u64,
    pub open_position: u64,
    pub close_position: u64,
    pub liquidation: u64,
    pub protocol_share: u64,
    pub fee_max: u64,
    pub fee_optimal: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct BorrowRateParams {
    pub base_rate: u64,
    pub slope1: u64,
    pub slope2: u64,
    pub optimal_utilization: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct Assets {
    pub collateral: u64,
    pub protocol_fees: u64,
    pub owned: u64,
    pub locked: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct FeesStats {
    pub swap_usd: u64,
    pub add_liquidity_usd: u64,
    pub remove_liquidity_usd: u64,
    pub open_position_usd: u64,
    pub close_position_usd: u64,
    pub liquidation_usd: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct VolumeStats {
    pub swap_usd: u64,
    pub add_liquidity_usd: u64,
    pub remove_liquidity_usd: u64,
    pub open_position_usd: u64,
    pub close_position_usd: u64,
    pub liquidation_usd: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct TradeStats {
    pub profit_usd: u64,
    pub loss_usd: u64,
    pub oi_long_usd: u64,
    pub oi_short_usd: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct PositionStats {
    pub open_positions: u64,
    pub collateral_usd: u64,
    pub size_usd: u64,
    pub borrow_size_usd: u64,
    pub locked_amount: u64,
    pub weighted_price: u128,
    pub total_quantity: u128,
    pub cumulative_interest_usd: u64,
    pub cumulative_interest_snapshot: u128,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct BorrowRateState {
    pub current_rate: u64,
    pub cumulative_interest: u128,
    pub last_update: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct TokenRatios {
    pub target: u64,
    pub min: u64,
    pub max: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct OraclePrice {
    pub price: u64,
    pub exponent: i32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct PriceAndFee {
    pub price: u64,
    pub fee: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct AmountAndFee {
    pub amount: u64,
    pub fee: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct NewPositionPricesAndFee {
    pub entry_price: u64,
    pub liquidation_price: u64,
    pub fee: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct SwapAmountAndFees {
    pub amount_out: u64,
    pub fee_in: u64,
    pub fee_out: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct ProfitAndLoss {
    pub profit: u64,
    pub loss: u64,
}

#[account]
pub struct Perpetuals {
    pub permissions: Permissions,
    pub pools: Vec<Pubkey>,
    pub transfer_authority_bump: u8,
    pub perpetuals_bump: u8,
    pub inception_time: i64,
}

#[account]
pub struct Pool {
    pub name: String,
    pub custodies: Vec<Pubkey>,
    pub ratios: Vec<TokenRatios>,
    pub aum_usd: u128,
    pub bump: u8,
    pub lp_token_bump: u8,
    pub inception_time: i64,
}

#[account]
pub struct Custody {
    pub pool: Pubkey,
    pub mint: Pubkey,
    pub token_account: Pubkey,
    pub decimals: u8,
    pub is_stable: bool,
    pub is_virtual: bool,
    pub oracle: OracleParams,
    pub pricing: PricingParams,
    pub permissions: Permissions,
    pub fees: Fees,
    pub borrow_rate: BorrowRateParams,
    pub assets: Assets,
    pub collected_fees: FeesStats,
    pub volume_stats: VolumeStats,
    pub trade_stats: TradeStats,
    pub long_positions: PositionStats,
    pub short_positions: PositionStats,
    pub borrow_rate_state: BorrowRateState,
    pub bump: u8,
    pub token_account_bump: u8,
}

#[account]
pub struct Position {
    pub owner: Pubkey,
    pub pool: Pubkey,
    pub custody: Pubkey,
    pub collateral_custody: Pubkey,
    pub open_time: i64,
    pub update_time: i64,
    pub side: Side,
    pub price: u64,
    pub size_usd: u64,
    pub borrow_size_usd: u64,
    pub collateral_usd: u64,
    pub unrealized_profit_usd: u64,
    pub unrealized_loss_usd: u64,
    pub cumulative_interest_snapshot: u128,
    pub locked_amount: u64,
    pub collateral_amount: u64,
    pub size_usd_encrypted: [u8; 32],
    pub collateral_usd_encrypted: [u8; 32],
    pub bump: u8,
}

#[account]
pub struct Multisig {
    pub num_signers: u8,
    pub num_signed: u8,
    pub min_signatures: u8,
    pub instruction_accounts_len: u8,
    pub instruction_data_len: u16,
    pub instruction_hash: u64,
    pub signers: [Pubkey; 6],
    pub signed: [u8; 6],
    pub bump: u8,
}

#[account]
pub struct CustomOracle {
    pub price: u64,
    pub expo: i32,
    pub conf: u64,
    pub ema: u64,
    pub publish_time: i64,
}
