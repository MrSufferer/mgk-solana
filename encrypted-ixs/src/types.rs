// Types for encrypted state in order matching MPC instructions

// These types represent the encrypted state structures used in MPC computations
// They are serialized/deserialized when passed to/from MPC instructions

// Note: In actual Arcis implementation, these would use Enc<Mxe, T> types
// For now, we define the plaintext structures that get encrypted

/// Order batch containing encrypted orders
pub struct OrderBatch {
    pub orders: Vec<EncryptedOrder>,
}

/// Encrypted order (size is encrypted, other fields are public)
pub struct EncryptedOrder {
    pub trader_pubkey: [u8; 32],  // Public
    pub price: u64,                // Public
    pub side: u8,                  // Public (0=Buy, 1=Sell)
    pub size: u64,                 // Private (encrypted in actual implementation)
    pub order_type: u8,            // Public
    pub time_in_force: u8,         // Public
    pub submission_slot: u64,      // Public (for FIFO)
}

/// Engine state containing encrypted trader states and orderbook
pub struct EngineState {
    pub trader_states: Vec<TraderStateEntry>,  // HashMap<Pubkey, Enc<Mxe, TraderRiskState>>
    pub orderbook: OrderBookState,
    pub open_interest: u128,                    // Encrypted
    pub funding_rate_accumulator: i64,          // Encrypted
    pub last_funding_update_slot: u64,
}

/// Trader state entry (key-value pair for serialization)
pub struct TraderStateEntry {
    pub trader: [u8; 32],
    pub state: TraderRiskState,
}

/// Trader risk state (encrypted)
pub struct TraderRiskState {
    pub positions: Vec<Position>,  // Per-market positions
    pub collateral: u128,          // Encrypted
    pub allocated_margin: u128,    // Encrypted
    pub available_margin: u128,    // Encrypted
}

/// Position in a market
pub struct Position {
    pub market_id: u16,
    pub size: i64,                 // Encrypted (signed: long/short)
    pub entry_price: u64,          // Can be computed from PnL
    pub unrealized_pnl: i64,       // Encrypted
}

/// Orderbook state (encrypted)
pub struct OrderBookState {
    pub price_levels: Vec<PriceLevel>,
}

/// Price level with encrypted aggregate size
pub struct PriceLevel {
    pub price: u64,                // Public
    pub aggregate_size: u64,       // Encrypted
}

/// Revealed fills (public metadata only)
pub struct RevealedFills {
    pub fills: Vec<FillMetadata>,
}

/// Fill metadata (public only, size is NOT included)
pub struct FillMetadata {
    pub taker: [u8; 32],           // Public
    pub maker: [u8; 32],           // Public
    pub market_id: u16,            // Public
    pub side: u8,                  // Public
    pub price: u64,                // Public
    // size is NOT revealed
}

/// Risk check result
pub struct RiskCheckResult {
    pub is_valid: u8,                      // Revealed (0 or 1)
    pub new_collateral_requirement: u64,   // Revealed (for UI display)
    pub margin_utilization: u8,            // Revealed (0-100, approximate)
}

/// Liquidation result
pub struct LiquidationResult {
    pub is_liquidatable: u8,       // Revealed
    pub remaining_collateral: u64, // Revealed
    pub liquidation_penalty: u64,  // Revealed
}

// ============================================================================
// Mixer Pool Types
// ============================================================================

/// Individual position in mixer pool (encrypted)
pub struct MixerPosition {
    pub trader: [u8; 32],           // Public (for decryption lookup)
    pub size: i64,                  // Encrypted (signed: long/short)
    pub collateral: u128,           // Encrypted
    pub entry_price: u64,           // Can be public or encrypted
    pub unrealized_pnl: i64,       // Encrypted
}

/// Aggregated state after mixing positions
pub struct AggregatedState {
    pub net_open_interest: i64,     // Net long/short (can be revealed)
    pub total_collateral: u128,     // Total collateral (can be revealed)
    pub position_count: u16,        // Number of positions (can be revealed)
    // Individual positions remain encrypted in registry
}

