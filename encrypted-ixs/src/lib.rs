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
}
