use arcis_imports::*;

#[encrypted]
mod circuits {
    use arcis_imports::*;

    pub struct PositionValueInput {
        pub size_usd: u64,       
        pub collateral_usd: u64,  
        pub entry_price: u64,     
        pub current_price: u64,   
        pub side: u8,           
    }

    pub struct PositionValueOutput {
        pub current_value: u64,  
        pub pnl: i64,            
        pub is_liquidatable: u8,
    }

    #[instruction]
    pub fn calculate_position_value(
        output_owner: Shared,
        size_ctxt: Enc<Shared, u64>,
        collateral_ctxt: Enc<Shared, u64>,
        entry_price: u64,
        current_price: u64,
        side: u8,
    ) -> Enc<Shared, PositionValueOutput> {
        let size_usd = size_ctxt.to_arcis();
        let collateral_usd = collateral_ctxt.to_arcis();

        let price_diff = if side == 0 {
            (current_price as i64) - (entry_price as i64)
        } else {
            (entry_price as i64) - (current_price as i64)
        };

        let pnl = ((size_usd as i64) * price_diff) / (entry_price as i64);

        let current_value = ((collateral_usd as i64) + pnl) as u64;

        let liquidation_threshold = size_usd / 20;
        let is_liquidatable = if current_value < liquidation_threshold {
            1
        } else {
            0
        };

        let output = PositionValueOutput {
            current_value,
            pnl,
            is_liquidatable,
        };

        output_owner.from_arcis(output)
    }

    #[instruction]
    pub fn open_position(
        size_ctxt: Enc<Shared, u64>,
        collateral_ctxt: Enc<Shared, u64>,
    ) -> (Enc<Shared, u64>, Enc<Shared, u64>) {
        let size = size_ctxt.to_arcis();
        let collateral = collateral_ctxt.to_arcis();

        let min_collateral = size / 20;
        let is_valid = collateral >= min_collateral;

        let final_size = if is_valid { size } else { 0 };
        let final_collateral = if is_valid { collateral } else { 0 };

        (
            size_ctxt.owner.from_arcis(final_size),
            collateral_ctxt.owner.from_arcis(final_collateral),
        )
    }

    pub struct ClosePositionOutput {
        pub realized_pnl: i64,        
        pub final_balance: u64,       
        pub can_close: u8,           
    }

    #[instruction]
    pub fn close_position(
        output_owner: Shared,
        size_ctxt: Enc<Shared, u64>,
        collateral_ctxt: Enc<Shared, u64>,
        entry_price: u64,
        current_price: u64,
        side: u8,
    ) -> Enc<Shared, ClosePositionOutput> {
        let size_usd = size_ctxt.to_arcis();
        let collateral_usd = collateral_ctxt.to_arcis();

        let price_diff = if side == 0 {
            (current_price as i64) - (entry_price as i64)
        } else {
            (entry_price as i64) - (current_price as i64)
        };

        let pnl = ((size_usd as i64) * price_diff) / (entry_price as i64);

        let final_balance_i64 = (collateral_usd as i64) + pnl;
        
        let can_close = if final_balance_i64 > 0 { 1 } else { 0 };
        let final_balance = if final_balance_i64 > 0 { 
            final_balance_i64 as u64 
        } else { 
            0 
        };

        let output = ClosePositionOutput {
            realized_pnl: pnl,
            final_balance,
            can_close,
        };

        output_owner.from_arcis(output)
    }

    pub struct AddCollateralOutput {
        pub new_total_collateral: u64,
        pub new_leverage: u64,
    }

    #[instruction]
    pub fn add_collateral(
        current_collateral_ctxt: Enc<Shared, u64>,
        additional_collateral_ctxt: Enc<Shared, u64>,
        size_ctxt: Enc<Shared, u64>,
    ) -> Enc<Shared, AddCollateralOutput> {
        let current_collateral = current_collateral_ctxt.to_arcis();
        let additional_collateral = additional_collateral_ctxt.to_arcis();
        let size = size_ctxt.to_arcis();

        let new_total_collateral = current_collateral + additional_collateral;

        let new_leverage = if new_total_collateral > 0 {
            size / new_total_collateral
        } else {
            0
        };

        let output = AddCollateralOutput {
            new_total_collateral,
            new_leverage,
        };

        current_collateral_ctxt.owner.from_arcis(output)
    }

    pub struct RemoveCollateralOutput {
        pub new_collateral: u64,     
        pub removed_amount: u64,       
        pub can_remove: u8,            
        pub new_leverage: u64,         
    }

    #[instruction]
    pub fn remove_collateral(
        current_collateral_ctxt: Enc<Shared, u64>,
        remove_amount_ctxt: Enc<Shared, u64>,
        size_ctxt: Enc<Shared, u64>,
    ) -> Enc<Shared, RemoveCollateralOutput> {
        let current_collateral = current_collateral_ctxt.to_arcis();
        let remove_amount = remove_amount_ctxt.to_arcis();
        let size = size_ctxt.to_arcis();

        let new_collateral = if current_collateral > remove_amount {
            current_collateral - remove_amount
        } else {
            0
        };

        let min_collateral = size / 20; 
        let can_remove = if new_collateral >= min_collateral { 1 } else { 0 };

        let final_collateral = if can_remove == 1 {
            new_collateral
        } else {
            current_collateral
        };

        let final_removed = if can_remove == 1 {
            remove_amount
        } else {
            0
        };

        let new_leverage = if final_collateral > 0 {
            size / final_collateral
        } else {
            0
        };

        let output = RemoveCollateralOutput {
            new_collateral: final_collateral,
            removed_amount: final_removed,
            can_remove,
            new_leverage,
        };

        current_collateral_ctxt.owner.from_arcis(output)
    }

    pub struct LiquidateOutput {
        pub is_liquidatable: u8,     
        pub remaining_collateral: u64, 
        pub liquidation_penalty: u64,  
    }

    #[instruction]
    pub fn liquidate(
        output_owner: Shared,
        size_ctxt: Enc<Shared, u64>,
        collateral_ctxt: Enc<Shared, u64>,
        entry_price: u64,
        current_price: u64,
        side: u8,
    ) -> Enc<Shared, LiquidateOutput> {
        let size_usd = size_ctxt.to_arcis();
        let collateral_usd = collateral_ctxt.to_arcis();

        let price_diff = if side == 0 {
            (current_price as i64) - (entry_price as i64)
        } else {
            (entry_price as i64) - (current_price as i64)
        };

        let pnl = ((size_usd as i64) * price_diff) / (entry_price as i64);

        let current_value_i64 = (collateral_usd as i64) + pnl;
        let current_value = if current_value_i64 > 0 { 
            current_value_i64 as u64 
        } else { 
            0 
        };

        let liquidation_threshold = size_usd / 20; // 5%
        let is_liquidatable = if current_value < liquidation_threshold { 1 } else { 0 };

        let liquidation_penalty = if is_liquidatable == 1 {
            current_value / 10 
        } else {
            0
        };

        let remaining_collateral = if is_liquidatable == 1 {
            if current_value > liquidation_penalty {
                current_value - liquidation_penalty
            } else {
                0
            }
        } else {
            current_value
        };

        let output = LiquidateOutput {
            is_liquidatable,
            remaining_collateral,
            liquidation_penalty,
        };

        output_owner.from_arcis(output)
    }

    // ============================================================================
    // Order Matching DEX MPC Instructions
    // ============================================================================

    /// Match batch of orders in an epoch (simplified version)
    /// 
    /// Input: Encrypted order sizes, public prices, mark price
    /// Output: Updated encrypted open interest, revealed fill count
    #[instruction]
    pub fn match_batch(
        mxe: Mxe,
        order_sizes: [Enc<Shared, u64>; 100],  // Fixed-size array of encrypted order sizes
        order_count: u16,                       // Actual number of orders
        public_prices: [u64; 100],              // Fixed-size array for prices
        price_count: u16,                       // Actual number of prices
        mark_price: u64,
    ) -> (Enc<Mxe, u128>, u16) {
        // Simplified matching: sum all order sizes as open interest
        // In full implementation, would:
        // 1. Group orders by price (public)
        // 2. Sort by submission_slot (FIFO)
        // 3. Match asks vs bids iteratively
        // 4. Update encrypted positions/margins
        // 5. Check risk constraints
        
        let mut total_size = 0u128;
        
        // Fixed-size loop (compile-time known bound)
        // Only process orders up to order_count
        for i in 0..100u64 {
            let idx = i as usize;
            let should_process = (i < order_count as u64) as u8;
            if should_process == 1 {
                let size = order_sizes[idx].to_arcis();
                total_size += size as u128;
            }
        }
        
        let open_interest = mxe.from_arcis(total_size);
        let fill_count = 0u16;  // Placeholder: would compute actual fill count
        
        (open_interest, fill_count)
    }

    /// Apply funding rate payments to all open positions
    #[instruction]
    pub fn apply_funding(
        mxe: Mxe,
        open_interest: Enc<Mxe, u128>,
        funding_rate_accumulator: Enc<Mxe, i64>,
        mark_price: u64,
        index_price: u64,
        time_elapsed_slots: u64,
    ) -> (Enc<Mxe, u128>, Enc<Mxe, i64>) {
        // Compute funding rate: (mark_price - index_price) / index_price * funding_rate_multiplier
        let price_diff = mark_price as i64 - index_price as i64;
        let funding_rate = if index_price > 0 {
            (price_diff * 1000000) / (index_price as i64)
        } else {
            0
        };
        
        // Update funding rate accumulator
        let current_accumulator = funding_rate_accumulator.to_arcis();
        let new_accumulator = current_accumulator + funding_rate;
        
        (open_interest, mxe.from_arcis(new_accumulator))
    }

    /// Check if a trader's position is liquidatable
    #[instruction]
    pub fn check_liquidation(
        collateral: Enc<Mxe, u128>,
        position_size: Enc<Mxe, i64>,
        unrealized_pnl: Enc<Mxe, i64>,
        mark_price: u64,
        maintenance_margin_fraction: u16,
    ) -> u8 {
        // Compute total account value
        let collateral_val = collateral.to_arcis();
        let pnl_val = unrealized_pnl.to_arcis();
        let total_value_i64 = collateral_val as i128 + pnl_val as i128;
        let total_value = if total_value_i64 > 0 {
            total_value_i64 as u128
        } else {
            0
        };
        
        // Compute margin requirement
        let position_size_abs = if position_size.to_arcis() < 0 {
            (-(position_size.to_arcis() as i128)) as u128
        } else {
            position_size.to_arcis() as u128
        };
        let position_notional = position_size_abs * mark_price as u128;
        let margin_requirement = (position_notional * maintenance_margin_fraction as u128) / 10000;
        
        // Check if liquidatable
        let is_liquidatable = if total_value < margin_requirement { 1u8 } else { 0u8 };
        
        is_liquidatable.reveal()
    }

    /// Validate that a new position delta would not violate margin requirements
    #[instruction]
    pub fn compute_risk(
        available_margin: Enc<Mxe, u128>,
        current_position: Enc<Mxe, i64>,
        new_position_delta: Enc<Shared, i64>,
        mark_price: u64,
        initial_margin_fraction: u16,
    ) -> (u8, u64, u8) {
        let delta = new_position_delta.to_arcis();
        
        // Compute new position size
        let current_pos = current_position.to_arcis();
        let new_position = current_pos + delta;
        
        // Compute margin requirement for new position
        let position_size_abs = if new_position < 0 {
            (-new_position) as u128
        } else {
            new_position as u128
        };
        let position_notional = position_size_abs * mark_price as u128;
        let margin_requirement = (position_notional * initial_margin_fraction as u128) / 10000;
        
        // Check if trader has sufficient margin
        let available = available_margin.to_arcis();
        let is_valid = if available >= margin_requirement { 1u8 } else { 0u8 };
        
        // Compute margin utilization (approximate, for UI display)
        let margin_utilization = if margin_requirement > 0 {
            ((available * 100) / margin_requirement).min(100) as u8
        } else {
            0u8
        };
        
        (is_valid.reveal(), (margin_requirement as u64).reveal(), margin_utilization.reveal())
    }

    /// Update trader collateral (for deposits/withdrawals)
    #[instruction]
    pub fn update_collateral(
        output_owner: Shared,
        current_collateral: Enc<Mxe, u128>,
        allocated_margin: Enc<Mxe, u128>,
        delta: Enc<Shared, u64>,
    ) -> Enc<Shared, u128> {
        let delta_value = delta.to_arcis();
        
        // Update collateral
        let collateral_val = current_collateral.to_arcis();
        let new_collateral = collateral_val + delta_value as u128;
        
        // Update available margin
        let allocated = allocated_margin.to_arcis();
        let new_available_margin = if new_collateral > allocated {
            new_collateral - allocated
        } else {
            0
        };
        
        // Return new collateral amount
        output_owner.from_arcis(new_collateral)
    }

    // ============================================================================
    // Mixer Pool Instructions
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
    }

    /// Mix positions: Aggregate individual positions into encrypted mixer state
    /// This computes net open interest and total collateral while keeping individual positions private
    #[instruction]
    pub fn mix_positions(
        output_owner: Mxe,
        positions: [Enc<Shared, MixerPosition>; 1000],  // Fixed-size array of encrypted positions
        position_count: u16,  // Actual number of positions (0-1000)
    ) -> Enc<Mxe, AggregatedState> {
        const MAX_POSITIONS: u64 = 1000;
        
        let mut net_long: i128 = 0;
        let mut net_short: i128 = 0;
        let mut total_collateral: u128 = 0;
        let mut actual_count: u16 = 0;
        
        // Iterate through all positions (fixed loop bound)
        for i in 0..MAX_POSITIONS {
            if i < position_count as u64 {
                let pos = positions[i as usize].to_arcis();
                
                // Aggregate position sizes (signed: positive = long, negative = short)
                if pos.size > 0 {
                    net_long += pos.size as i128;
                } else if pos.size < 0 {
                    net_short += (-pos.size) as i128;
                }
                
                // Aggregate collateral
                total_collateral += pos.collateral;
                actual_count += 1;
            }
        }
        
        // Compute net open interest (long - short)
        let net_open_interest = net_long - net_short;
        
        // Create aggregated state
        let aggregated = AggregatedState {
            net_open_interest: net_open_interest as i64,
            total_collateral,
            position_count: actual_count,
        };
        
        // Return encrypted aggregated state
        output_owner.from_arcis(aggregated)
    }
}
