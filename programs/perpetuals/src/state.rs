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

// Legacy position layout kept for documentation/reference only.
// Not used as an Anchor account; the live on-chain `Position` account
// is defined in `lib.rs`.
pub struct PositionState {
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

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OpenPositionPublicParams {
    pub price: u64,
    pub collateral: u64,
    pub size: u64,
    pub side: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AddCollateralPublicParams {
    pub collateral: u64,
}

/// Parameters for removing collateral in the public (non–encrypted) path.
/// Mirrors `AddCollateralPublicParams` but for decreasing collateral.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RemoveCollateralPublicParams {
    /// Amount of collateral tokens to remove (token units, not USD).
    pub collateral: u64,
}

// ============================================================================
// Order Matching DEX Types and Account Structures
// ============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum OrderSide {
    Buy = 0,
    Sell = 1,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum OrderType {
    Limit = 0,
    Market = 1,
    IOC = 2,        // Immediate Or Cancel
    PostOnly = 3,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum TimeInForce {
    GTT = 0,        // Good Till Time
    IOC = 1,        // Immediate Or Cancel
    PostOnly = 2,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum MarketStatus {
    Active = 0,
    Paused = 1,
    Expired = 2,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum MarginMode {
    Cross = 0,
    Isolated = 1,
}

/// MarketState account - Per-market configuration and encrypted engine state
#[account]
pub struct MarketState {
    // Market identification
    pub market_id: u16,
    pub base_asset_mint: Pubkey,        // e.g., BTC (or synthetic)
    pub quote_asset_mint: Pubkey,       // USDC (Confidential SPL)
    
    // Market configuration (public)
    pub tick_size: u64,                 // Minimum price increment (e.g., 1 = $0.01)
    pub min_order_size: u64,            // Minimum order size in base units
    pub max_order_size: u64,            // Maximum order size in base units
    pub maker_fee_bps: u16,             // Maker fee in basis points (e.g., 2 = 0.02%)
    pub taker_fee_bps: u16,             // Taker fee in basis points (e.g., 5 = 0.05%)
    
    // Encrypted engine state (Enc<Mxe, EngineState> serialized)
    // Max size: ~10KB (Solana account limit considerations)
    pub engine_state_ciphertext: Vec<u8>,
    pub engine_state_version: u64,     // Version for state updates
    
    // Public market data
    pub mark_price: u64,                // Current mark price (from oracle)
    pub index_price: u64,               // Index price (from oracle)
    pub funding_rate: i64,              // Current funding rate (scaled by 1e6)
    pub last_funding_update_slot: u64,
    
    // Epoch management
    pub current_epoch_id: u64,
    pub epoch_start_slot: u64,
    pub epoch_duration_slots: u64,     // Default: 150 slots (~1.5 seconds)
    
    // Market status
    pub status: MarketStatus,          // Active, Paused, Expired
    
    // PDA bump
    pub bump: u8,
}

/// TraderState account - Per-trader encrypted risk state and Confidential SPL account references
#[account]
pub struct TraderState {
    pub trader: Pubkey,
    
    // Encrypted risk state (Enc<Mxe, TraderRiskState>)
    pub risk_state_ciphertext: Vec<u8>, // ~5KB max
    pub risk_state_version: u64,
    
    // Public metadata
    pub margin_mode: MarginMode,        // Cross or Isolated
    pub has_open_positions: bool,       // Quick check flag
    pub last_update_slot: u64,
    
    // Confidential SPL Token accounts
    pub collateral_account: Pubkey,     // Confidential SPL account for collateral
    pub isolated_margin_accounts: Vec<Pubkey>, // Per-market isolated margin (optional)
    
    pub bump: u8,
}

/// EpochState account - Per-epoch order batch and settlement status
#[account]
pub struct EpochState {
    pub market_id: u16,
    pub epoch_id: u64,
    pub start_slot: u64,
    pub end_slot: u64,
    
    // Encrypted order batch (Enc<Mxe, OrderBatch>)
    pub order_batch_ciphertext: Vec<u8>, // ~50KB max (for 1000+ orders)
    
    // Public price ticks observed in this epoch
    pub price_ticks: Vec<u64>,            // Sorted list of prices with orders
    
    // Settlement status
    pub is_settled: bool,
    pub settlement_slot: Option<u64>,
    
    pub bump: u8,
}

/// FillEvent account - Public fill metadata (trader, market, side, price)
#[account]
pub struct FillEvent {
    pub market_id: u16,
    pub epoch_id: u64,
    pub taker: Pubkey,                     // Public
    pub maker: Pubkey,                     // Public
    pub side: OrderSide,                   // Public (Buy/Sell)
    pub price: u64,                        // Public
    // Size is NOT stored (private)
    pub slot: u64,
}

// ============================================================================
// Mixer Pool Architecture - Peer-to-Mixer-Pool
// ============================================================================

/// Position reference in mixer pool (encrypted, only owner can decrypt)
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PositionRef {
    pub trader: Pubkey,                    // Public (for decryption key lookup)
    pub position_ciphertext: Vec<u8>,       // Enc<Shared, Position> - only trader can decrypt
    pub nonce: u128,                       // Nonce for decryption
}

/// MixerPoolState - Aggregated position pool with privacy
#[account]
pub struct MixerPoolState {
    pub market_id: u16,
    
    // Aggregated encrypted state (Enc<Mxe, AggregatedPositions>)
    pub aggregated_state_ciphertext: Vec<u8>,  // ~10KB max
    
    // Individual position references (encrypted, per-trader)
    // Each trader's position is encrypted, only they can decrypt
    pub position_registry: Vec<PositionRef>,  // Max 1000 positions per mixer
    
    // Public aggregate metrics (can be revealed for transparency)
    pub net_open_interest: i64,              // Net long/short (revealed)
    pub total_collateral: u128,              // Total collateral (revealed)
    pub position_count: u16,                 // Number of active positions
    
    // Pool interaction
    pub pool: Pubkey,                       // Reference to liquidity pool
    pub last_mix_slot: u64,
    pub mix_interval_slots: u64,            // How often to mix (e.g., per epoch)
    
    // Market reference
    pub base_asset_mint: Pubkey,
    pub quote_asset_mint: Pubkey,
    
    pub bump: u8,
}
