use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;
use anchor_spl::token::{Token, Mint, TokenAccount, Transfer, MintTo, Burn};

pub mod state;
pub use state::*;

const COMP_DEF_OFFSET_CALCULATE_POSITION_VALUE: u32 = comp_def_offset("calculate_position_value");
const COMP_DEF_OFFSET_OPEN_POSITION: u32 = comp_def_offset("open_position");
const COMP_DEF_OFFSET_CLOSE_POSITION: u32 = comp_def_offset("close_position");
const COMP_DEF_OFFSET_ADD_COLLATERAL: u32 = comp_def_offset("add_collateral");
const COMP_DEF_OFFSET_REMOVE_COLLATERAL: u32 = comp_def_offset("remove_collateral");
const COMP_DEF_OFFSET_LIQUIDATE: u32 = comp_def_offset("liquidate");

declare_id!("3xG4QD5fEj8THmKVZqAGcPiVEKMaT8hR8oUbNYWqV7jX");

#[arcium_program]
pub mod perpetuals {
    use super::*;

    pub fn init_open_position_comp_def(ctx: Context<InitOpenPositionCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, true, 0, None, None)?;
        Ok(())
    }

    pub fn open_position(
        ctx: Context<OpenPosition>,
        computation_offset: u64,
        position_id: u64,
        side: u8,
        entry_price: u64,
        size_encrypted: [u8; 32],
        collateral_encrypted: [u8; 32],
        client_pubkey: [u8; 32],
        size_nonce: u128,
        collateral_nonce: u128,
    ) -> Result<()> {
        require!(side <= 1, ErrorCode::InvalidPositionSide);

        let position_key = ctx.accounts.position.key();

        let position = &mut ctx.accounts.position;
        position.owner = ctx.accounts.owner.key();
        position.position_id = position_id;
        position.side = if side == 0 {
            PositionSide::Long
        } else {
            PositionSide::Short
        };
        position.size_usd_encrypted = size_encrypted;
        position.collateral_usd_encrypted = collateral_encrypted;
        position.entry_price = entry_price;
        position.open_time = Clock::get()?.unix_timestamp;
        position.update_time = Clock::get()?.unix_timestamp;
        position.owner_enc_pubkey = client_pubkey;
        position.size_nonce = size_nonce;
        position.collateral_nonce = collateral_nonce;
        position.liquidator = Pubkey::default();  // Initialize to default, set during liquidation
        position.bump = ctx.bumps.position;

        let args = vec![
            Argument::ArcisPubkey(client_pubkey),
            Argument::PlaintextU128(size_nonce),
            Argument::EncryptedU64(size_encrypted),
            Argument::ArcisPubkey(client_pubkey),
            Argument::PlaintextU128(collateral_nonce),
            Argument::EncryptedU64(collateral_encrypted),
        ];

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![CallbackAccount {
                pubkey: position_key,
                is_writable: true,
            }],
            None,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "open_position")]
    pub fn open_position_callback(
        ctx: Context<OpenPositionCallback>,
        output: ComputationOutputs<OpenPositionOutput>,
    ) -> Result<()> {
        let (size_output, collateral_output) = match output {
            ComputationOutputs::Success(OpenPositionOutput {
                field_0: OpenPositionTupleStruct0 {
                    field_0: size,
                    field_1: collateral,
                },
            }) => (size, collateral),
            _ => return Err(ErrorCode::AbortedComputation.into()),
        };

        let size_encrypted = size_output.ciphertexts[0];
        let size_nonce = size_output.nonce;
        let collateral_encrypted = collateral_output.ciphertexts[0];
        let collateral_nonce = collateral_output.nonce;

        let position = &mut ctx.accounts.position;
        
        position.size_usd_encrypted = size_encrypted;
        position.collateral_usd_encrypted = collateral_encrypted;
        position.size_nonce = size_nonce;
        position.collateral_nonce = collateral_nonce;

        emit!(PositionOpenedEvent {
            position_id: position.position_id,
            owner: position.owner,
            side: position.side,
            entry_price: position.entry_price,
            size_encrypted,
            size_nonce,
            collateral_encrypted,
            collateral_nonce,
        });

        Ok(())
    }

    pub fn init_calculate_position_value_comp_def(
        ctx: Context<InitCalculatePositionValueCompDef>,
    ) -> Result<()> {
        init_comp_def(ctx.accounts, true, 0, None, None)?;
        Ok(())
    }

    pub fn calculate_position_value(
        ctx: Context<CalculatePositionValue>,
        computation_offset: u64,
        _position_id: u64,
        current_price: u64,
        client_pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        let position = &ctx.accounts.position;

        let args = vec![
            Argument::ArcisPubkey(client_pubkey),
            Argument::PlaintextU128(nonce),
            Argument::ArcisPubkey(position.owner_enc_pubkey),
            Argument::PlaintextU128(position.size_nonce),
            Argument::Account(position.key(), 8 + 32 + 8 + 1, 32),
            Argument::ArcisPubkey(position.owner_enc_pubkey),
            Argument::PlaintextU128(position.collateral_nonce),
            Argument::Account(position.key(), 8 + 32 + 8 + 1 + 32, 32),
            Argument::PlaintextU64(position.entry_price),
            Argument::PlaintextU64(current_price),
            Argument::PlaintextU8(position.side as u8),
        ];

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![CallbackAccount {
                pubkey: position.key(),
                is_writable: true,
            }],
            None,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "calculate_position_value")]
    pub fn calculate_position_value_callback(
        ctx: Context<CalculatePositionValueCallback>,
        output: ComputationOutputs<CalculatePositionValueOutput>,
    ) -> Result<()> {
        let value_output = match output {
            ComputationOutputs::Success(CalculatePositionValueOutput { field_0 }) => field_0,
            _ => return Err(ErrorCode::AbortedComputation.into()),
        };

        let position = &ctx.accounts.position;

        emit!(PositionValueCalculatedEvent {
            position_id: position.position_id,
            current_value_encrypted: value_output.ciphertexts[0],
            pnl_encrypted: value_output.ciphertexts[1],
            value_nonce: value_output.nonce,
        });

        Ok(())
    }

    pub fn init_close_position_comp_def(ctx: Context<InitClosePositionCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, true, 0, None, None)?;
        Ok(())
    }

    pub fn close_position(
        ctx: Context<ClosePosition>,
        computation_offset: u64,
        _position_id: u64,
        current_price: u64,
        client_pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        let position = &ctx.accounts.position;

        require!(
            position.owner == ctx.accounts.owner.key(),
            ErrorCode::InvalidPositionOwner
        );


        let args = vec![
            Argument::ArcisPubkey(client_pubkey),
            Argument::PlaintextU128(nonce),
            Argument::ArcisPubkey(position.owner_enc_pubkey),
            Argument::PlaintextU128(position.size_nonce),
            Argument::Account(position.key(), 8 + 32 + 8 + 1, 32), // size_usd_encrypted
            Argument::ArcisPubkey(position.owner_enc_pubkey),
            Argument::PlaintextU128(position.collateral_nonce),
            Argument::Account(position.key(), 8 + 32 + 8 + 1 + 32, 32), // collateral_usd_encrypted
            Argument::PlaintextU64(position.entry_price),
            Argument::PlaintextU64(current_price),
            Argument::PlaintextU8(position.side as u8),
        ];

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![CallbackAccount {
                pubkey: position.key(),
                is_writable: true,
            }],
            None,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "close_position")]
    pub fn close_position_callback(
        ctx: Context<ClosePositionCallback>,
        output: ComputationOutputs<ClosePositionOutput>,
    ) -> Result<()> {
        let close_output = match output {
            ComputationOutputs::Success(ClosePositionOutput { field_0 }) => field_0,
            _ => return Err(ErrorCode::AbortedComputation.into()),
        };

        let position = &mut ctx.accounts.position;
        
        position.size_usd_encrypted = [0; 32];
        position.update_time = Clock::get()?.unix_timestamp;

        emit!(PositionClosedEvent {
            position_id: position.position_id,
            owner: position.owner,
            realized_pnl_encrypted: close_output.ciphertexts[0],
            final_balance_encrypted: close_output.ciphertexts[1],
            can_close_encrypted: close_output.ciphertexts[2],
            nonce: close_output.nonce,
        });

        Ok(())
    }

    pub fn init_add_collateral_comp_def(ctx: Context<InitAddCollateralCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, true, 0, None, None)?;
        Ok(())
    }

    pub fn add_collateral(
        ctx: Context<AddCollateral>,
        computation_offset: u64,
        _position_id: u64,
        additional_collateral_encrypted: [u8; 32],
        client_pubkey: [u8; 32],
        additional_collateral_nonce: u128,
    ) -> Result<()> {
        let position = &ctx.accounts.position;

        require!(
            position.owner == ctx.accounts.owner.key(),
            ErrorCode::InvalidPositionOwner
        );

        let args = vec![
            Argument::ArcisPubkey(position.owner_enc_pubkey),
            Argument::PlaintextU128(position.collateral_nonce),
            Argument::Account(position.key(), 8 + 32 + 8 + 1 + 32, 32), // collateral_usd_encrypted
            Argument::ArcisPubkey(client_pubkey),
            Argument::PlaintextU128(additional_collateral_nonce),
            Argument::EncryptedU64(additional_collateral_encrypted),
            Argument::ArcisPubkey(position.owner_enc_pubkey),
            Argument::PlaintextU128(position.size_nonce),
            Argument::Account(position.key(), 8 + 32 + 8 + 1, 32), // size_usd_encrypted
        ];

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![CallbackAccount {
                pubkey: position.key(),
                is_writable: true,
            }],
            None,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "add_collateral")]
    pub fn add_collateral_callback(
        ctx: Context<AddCollateralCallback>,
        output: ComputationOutputs<AddCollateralOutput>,
    ) -> Result<()> {
        let collateral_output = match output {
            ComputationOutputs::Success(AddCollateralOutput { field_0 }) => field_0,
            _ => return Err(ErrorCode::AbortedComputation.into()),
        };

        let position = &mut ctx.accounts.position;
        
        position.collateral_usd_encrypted = collateral_output.ciphertexts[0];
        position.collateral_nonce = collateral_output.nonce;
        position.update_time = Clock::get()?.unix_timestamp;

        emit!(CollateralAddedEvent {
            position_id: position.position_id,
            owner: position.owner,
            new_collateral_encrypted: collateral_output.ciphertexts[0],
            new_leverage_encrypted: collateral_output.ciphertexts[1],
            nonce: collateral_output.nonce,
        });

        Ok(())
    }

    pub fn init_remove_collateral_comp_def(
        ctx: Context<InitRemoveCollateralCompDef>,
    ) -> Result<()> {
        init_comp_def(ctx.accounts, true, 0, None, None)?;
        Ok(())
    }

    pub fn remove_collateral(
        ctx: Context<RemoveCollateral>,
        computation_offset: u64,
        _position_id: u64,
        remove_amount_encrypted: [u8; 32],
        client_pubkey: [u8; 32],
        remove_amount_nonce: u128,
    ) -> Result<()> {
        let position = &ctx.accounts.position;

        require!(
            position.owner == ctx.accounts.owner.key(),
            ErrorCode::InvalidPositionOwner
        );

        let args = vec![
            Argument::ArcisPubkey(position.owner_enc_pubkey),
            Argument::PlaintextU128(position.collateral_nonce),
            Argument::Account(position.key(), 8 + 32 + 8 + 1 + 32, 32), // collateral_usd_encrypted
            Argument::ArcisPubkey(client_pubkey),
            Argument::PlaintextU128(remove_amount_nonce),
            Argument::EncryptedU64(remove_amount_encrypted),
            Argument::ArcisPubkey(position.owner_enc_pubkey),
            Argument::PlaintextU128(position.size_nonce),
            Argument::Account(position.key(), 8 + 32 + 8 + 1, 32), // size_usd_encrypted
        ];

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![CallbackAccount {
                pubkey: position.key(),
                is_writable: true,
            }],
            None,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "remove_collateral")]
    pub fn remove_collateral_callback(
        ctx: Context<RemoveCollateralCallback>,
        output: ComputationOutputs<RemoveCollateralOutput>,
    ) -> Result<()> {
        let collateral_output = match output {
            ComputationOutputs::Success(RemoveCollateralOutput { field_0 }) => field_0,
            _ => return Err(ErrorCode::AbortedComputation.into()),
        };

        let position = &mut ctx.accounts.position;
        
        let can_remove = collateral_output.ciphertexts[2][0];
        
        require!(can_remove == 1, ErrorCode::InsufficientCollateral);

        position.collateral_usd_encrypted = collateral_output.ciphertexts[0];
        position.collateral_nonce = collateral_output.nonce;
        position.update_time = Clock::get()?.unix_timestamp;

        emit!(CollateralRemovedEvent {
            position_id: position.position_id,
            owner: position.owner,
            new_collateral_encrypted: collateral_output.ciphertexts[0],
            removed_amount_encrypted: collateral_output.ciphertexts[1],
            new_leverage_encrypted: collateral_output.ciphertexts[3],
            nonce: collateral_output.nonce,
        });

        Ok(())
    }

    pub fn init_liquidate_comp_def(
        ctx: Context<InitLiquidateCompDef>,
    ) -> Result<()> {
        init_comp_def(ctx.accounts, true, 0, None, None)?;
        Ok(())
    }

    pub fn liquidate(
        ctx: Context<Liquidate>,
        computation_offset: u64,
        _position_id: u64,
        current_price: u64,
        client_pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        let position_key = ctx.accounts.position.key();
        let owner_enc_pubkey = ctx.accounts.position.owner_enc_pubkey;
        let size_nonce = ctx.accounts.position.size_nonce;
        let collateral_nonce = ctx.accounts.position.collateral_nonce;
        let entry_price = ctx.accounts.position.entry_price;
        let side = ctx.accounts.position.side as u8;

        let position = &mut ctx.accounts.position;
        position.liquidator = ctx.accounts.liquidator.key();

        let args = vec![
            Argument::ArcisPubkey(client_pubkey),
            Argument::PlaintextU128(nonce),
            Argument::ArcisPubkey(owner_enc_pubkey),
            Argument::PlaintextU128(size_nonce),
            Argument::Account(position_key, 8 + 32 + 8 + 1, 32), // size_usd_encrypted
            Argument::ArcisPubkey(owner_enc_pubkey),
            Argument::PlaintextU128(collateral_nonce),
            Argument::Account(position_key, 8 + 32 + 8 + 1 + 32, 32), // collateral_usd_encrypted
            Argument::PlaintextU64(entry_price),
            Argument::PlaintextU64(current_price),
            Argument::PlaintextU8(side),
        ];

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![CallbackAccount {
                pubkey: position_key,
                is_writable: true,
            }],
            None,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "liquidate")]
    pub fn liquidate_callback(
        ctx: Context<LiquidateCallback>,
        output: ComputationOutputs<LiquidateOutput>,
    ) -> Result<()> {
        let liquidation_output = match output {
            ComputationOutputs::Success(LiquidateOutput { field_0 }) => field_0,
            _ => return Err(ErrorCode::AbortedComputation.into()),
        };

        let position = &mut ctx.accounts.position;
        
        position.size_usd_encrypted = [0; 32];
        position.collateral_usd_encrypted = [0; 32];
        position.update_time = Clock::get()?.unix_timestamp;

        emit!(PositionLiquidatedEvent {
            position_id: position.position_id,
            owner: position.owner,
            liquidator: position.liquidator,
            is_liquidatable_encrypted: liquidation_output.ciphertexts[0],
            remaining_collateral_encrypted: liquidation_output.ciphertexts[1],
            penalty_encrypted: liquidation_output.ciphertexts[2],
            nonce: liquidation_output.nonce,
        });

        Ok(())
    }

    pub fn get_entry_price_and_fee(
        ctx: Context<GetEntryPriceAndFee>,
        params: GetEntryPriceAndFeeParams,
    ) -> Result<NewPositionPricesAndFee> {
        require!(params.collateral > 0 && params.size > 0, ErrorCode::InvalidInput);
        
        let custody = &ctx.accounts.custody;
        
        let entry_price = get_price_from_oracle(
            &custody.oracle,
            &ctx.accounts.custody_oracle_account
        )?;
        
        let leverage = params.size
            .checked_mul(10000)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(params.collateral)
            .ok_or(ErrorCode::MathOverflow)?;
        
        require!(
            leverage >= custody.pricing.min_initial_leverage && 
            leverage <= custody.pricing.max_initial_leverage,
            ErrorCode::InvalidInput
        );
        
        let maintenance_margin_bps = 500;
        
        let liquidation_price = if params.side == Side::Long {
            let price_drop_pct = (10000u64)
                .checked_sub(maintenance_margin_bps)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_mul(10000)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(leverage)
                .ok_or(ErrorCode::MathOverflow)?;
            
            entry_price
                .checked_mul(price_drop_pct)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(10000)
                .ok_or(ErrorCode::MathOverflow)?
        } else {
            let price_rise_pct = maintenance_margin_bps
                .checked_mul(10000)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(leverage)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_add(10000)
                .ok_or(ErrorCode::MathOverflow)?;
            
            entry_price
                .checked_mul(price_rise_pct)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(10000)
                .ok_or(ErrorCode::MathOverflow)?
        };
        
        let spread = if params.side == Side::Long {
            custody.pricing.trade_spread_long
        } else {
            custody.pricing.trade_spread_short
        };
        
        let spread_amount = entry_price
            .checked_mul(spread)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(10000)
            .ok_or(ErrorCode::MathOverflow)?;
        
        let adjusted_entry_price = if params.side == Side::Long {
            // Long: pay higher price (add spread)
            entry_price
                .checked_add(spread_amount)
                .ok_or(ErrorCode::MathOverflow)?
        } else {
            // Short: receive lower price (subtract spread)
            entry_price
                .checked_sub(spread_amount)
                .ok_or(ErrorCode::MathOverflow)?
        };
        
        let fee_rate = calculate_fee_rate(
            custody.fees.mode,
            custody.fees.open_position,
            &custody,
            params.size
        )?;
        
        let fee = params.size
            .checked_mul(fee_rate)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(10000)
            .ok_or(ErrorCode::MathOverflow)?;
        
        Ok(NewPositionPricesAndFee {
            entry_price: adjusted_entry_price,
            liquidation_price,
            fee,
        })
    }

    pub fn get_exit_price_and_fee(
        ctx: Context<GetExitPriceAndFee>,
        _params: GetExitPriceAndFeeParams,
    ) -> Result<PriceAndFee> {
        let custody = &ctx.accounts.custody;
        let position = &ctx.accounts.position;
        
        let exit_price = get_price_from_oracle(
            &custody.oracle,
            &ctx.accounts.custody_oracle_account
        )?;
        
        let spread = if position.side == PositionSide::Long {
            custody.pricing.trade_spread_short
        } else {
            custody.pricing.trade_spread_long
        };
        
        let adjusted_exit_price = if position.side == PositionSide::Long {
            exit_price
                .checked_sub(
                    exit_price
                        .checked_mul(spread)
                        .ok_or(ErrorCode::MathOverflow)?
                        .checked_div(10000)
                        .ok_or(ErrorCode::MathOverflow)?
                )
                .ok_or(ErrorCode::MathOverflow)?
        } else {
            exit_price
                .checked_add(
                    exit_price
                        .checked_mul(spread)
                        .ok_or(ErrorCode::MathOverflow)?
                        .checked_div(10000)
                        .ok_or(ErrorCode::MathOverflow)?
                )
                .ok_or(ErrorCode::MathOverflow)?
        };
        
        let estimated_size = 10000u64;
        
        let fee_rate = calculate_fee_rate(
            custody.fees.mode,
            custody.fees.close_position,
            &custody,
            estimated_size
        )?;
        
        let fee = estimated_size
            .checked_mul(fee_rate)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(10000)
            .ok_or(ErrorCode::MathOverflow)?;
        
        Ok(PriceAndFee {
            price: adjusted_exit_price,
            fee,
        })
    }

    pub fn get_pnl(
        ctx: Context<GetPnl>,
        _params: GetPnlParams,
    ) -> Result<ProfitAndLoss> {
        let position = &ctx.accounts.position;
        let custody = &ctx.accounts.custody;
        
        let current_price = get_price_from_oracle(
            &custody.oracle,
            &ctx.accounts.custody_oracle_account
        )?;
        
        let entry_price = position.entry_price;
        
        let (profit, loss) = if position.side == PositionSide::Long {
            if current_price >= entry_price {
                let price_diff = current_price
                    .checked_sub(entry_price)
                    .ok_or(ErrorCode::MathOverflow)?;
                
                let pnl = price_diff
                    .checked_mul(100)
                    .ok_or(ErrorCode::MathOverflow)?
                    .checked_div(entry_price)
                    .ok_or(ErrorCode::MathOverflow)?;
                
                (pnl, 0u64)
            } else {
                let price_diff = entry_price
                    .checked_sub(current_price)
                    .ok_or(ErrorCode::MathOverflow)?;
                
                let pnl = price_diff
                    .checked_mul(100)
                    .ok_or(ErrorCode::MathOverflow)?
                    .checked_div(entry_price)
                    .ok_or(ErrorCode::MathOverflow)?;
                
                (0u64, pnl)
            }
        } else {
            if current_price <= entry_price {
                let price_diff = entry_price
                    .checked_sub(current_price)
                    .ok_or(ErrorCode::MathOverflow)?;
                
                let pnl = price_diff
                    .checked_mul(100)
                    .ok_or(ErrorCode::MathOverflow)?
                    .checked_div(entry_price)
                    .ok_or(ErrorCode::MathOverflow)?;
                
                (pnl, 0u64)
            } else {
                let price_diff = current_price
                    .checked_sub(entry_price)
                    .ok_or(ErrorCode::MathOverflow)?;
                
                let pnl = price_diff
                    .checked_mul(100)
                    .ok_or(ErrorCode::MathOverflow)?
                    .checked_div(entry_price)
                    .ok_or(ErrorCode::MathOverflow)?;
                
                (0u64, pnl)
            }
        };
        
        Ok(ProfitAndLoss {
            profit,
            loss,
        })
    }

    pub fn get_liquidation_price(
        ctx: Context<GetLiquidationPrice>,
        _params: GetLiquidationPriceParams,
    ) -> Result<u64> {
        let position = &ctx.accounts.position;
        
        let entry_price = position.entry_price;
        
        let estimated_leverage = 1000;
        
        let maintenance_margin_bps = 500;
        
        let liquidation_price = if position.side == PositionSide::Long {
            let price_drop_pct = (10000u64)
                .checked_sub(maintenance_margin_bps)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_mul(10000)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(estimated_leverage)
                .ok_or(ErrorCode::MathOverflow)?;
            
            entry_price
                .checked_mul(price_drop_pct)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(10000)
                .ok_or(ErrorCode::MathOverflow)?
        } else {
            let price_rise_pct = maintenance_margin_bps
                .checked_mul(10000)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(estimated_leverage)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_add(10000)
                .ok_or(ErrorCode::MathOverflow)?;
            
            entry_price
                .checked_mul(price_rise_pct)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(10000)
                .ok_or(ErrorCode::MathOverflow)?
        };
        
        Ok(liquidation_price)
    }

    pub fn get_liquidation_state(
        ctx: Context<GetLiquidationState>,
        _params: GetLiquidationStateParams,
    ) -> Result<u8> {
        let position = &ctx.accounts.position;
        let custody = &ctx.accounts.custody;
        
        let current_price = get_price_from_oracle(
            &custody.oracle,
            &ctx.accounts.custody_oracle_account
        )?;
        
        let entry_price = position.entry_price;
        
        let estimated_leverage = 1000;
        
        let maintenance_margin_bps = 500;
        
        let liquidation_price = if position.side == PositionSide::Long {
            let price_drop_pct = (10000u64)
                .checked_sub(maintenance_margin_bps)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_mul(10000)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(estimated_leverage)
                .ok_or(ErrorCode::MathOverflow)?;
            
            entry_price
                .checked_mul(price_drop_pct)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(10000)
                .ok_or(ErrorCode::MathOverflow)?
        } else {
            let price_rise_pct = maintenance_margin_bps
                .checked_mul(10000)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(estimated_leverage)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_add(10000)
                .ok_or(ErrorCode::MathOverflow)?;
            
            entry_price
                .checked_mul(price_rise_pct)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(10000)
                .ok_or(ErrorCode::MathOverflow)?
        };
        
        let is_liquidatable = if position.side == PositionSide::Long {
            current_price <= liquidation_price
        } else {
            current_price >= liquidation_price
        };
        
        Ok(if is_liquidatable { 1 } else { 0 })
    }

    pub fn get_oracle_price(
        ctx: Context<GetOraclePrice>,
        _params: GetOraclePriceParams,
    ) -> Result<u64> {
        let custody = &ctx.accounts.custody;
        
        let price = get_price_from_oracle(
            &custody.oracle,
            &ctx.accounts.custody_oracle_account
        )?;
        
        Ok(price)
    }

    pub fn get_swap_amount_and_fees(
        ctx: Context<GetSwapAmountAndFees>,
        params: GetSwapAmountAndFeesParams,
    ) -> Result<SwapAmountAndFees> {
        let custody_in = &ctx.accounts.receiving_custody;
        let custody_out = &ctx.accounts.dispensing_custody;
        
        let fee_in_rate = custody_in.fees.swap_in;
        let fee_out_rate = custody_out.fees.swap_out;
        
        let fee_in = params.amount_in
            .checked_mul(fee_in_rate)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(10000)
            .ok_or(ErrorCode::MathOverflow)?;
        
        let amount_after_fee = params.amount_in
            .checked_sub(fee_in)
            .ok_or(ErrorCode::MathOverflow)?;
        
        let amount_out = amount_after_fee
            .checked_mul(98)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(100)
            .ok_or(ErrorCode::MathOverflow)?;
        
        let fee_out = amount_out
            .checked_mul(fee_out_rate)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(10000)
            .ok_or(ErrorCode::MathOverflow)?;
        
        let final_amount_out = amount_out
            .checked_sub(fee_out)
            .ok_or(ErrorCode::MathOverflow)?;
        
        Ok(SwapAmountAndFees {
            amount_out: final_amount_out,
            fee_in,
            fee_out,
        })
    }

    pub fn get_add_liquidity_amount_and_fee(
        ctx: Context<GetAddLiquidityAmountAndFee>,
        params: GetAddLiquidityAmountAndFeeParams,
    ) -> Result<AmountAndFee> {
        let custody = &ctx.accounts.custody;
        
        let fee_rate = custody.fees.add_liquidity;
        let fee = params.amount_in
            .checked_mul(fee_rate)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(10000)
            .ok_or(ErrorCode::MathOverflow)?;
        
        let amount_after_fee = params.amount_in
            .checked_sub(fee)
            .ok_or(ErrorCode::MathOverflow)?;
        
        Ok(AmountAndFee {
            amount: amount_after_fee,
            fee,
        })
    }

    pub fn get_remove_liquidity_amount_and_fee(
        ctx: Context<GetRemoveLiquidityAmountAndFee>,
        params: GetRemoveLiquidityAmountAndFeeParams,
    ) -> Result<AmountAndFee> {
        let custody = &ctx.accounts.custody;
        
        let fee_rate = custody.fees.remove_liquidity;
        let fee = params.lp_amount_in
            .checked_mul(fee_rate)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(10000)
            .ok_or(ErrorCode::MathOverflow)?;
        
        let final_amount = params.lp_amount_in
            .checked_sub(fee)
            .ok_or(ErrorCode::MathOverflow)?;
        
        Ok(AmountAndFee {
            amount: final_amount,
            fee,
        })
    }

    pub fn get_assets_under_management(
        ctx: Context<GetAssetsUnderManagement>,
        _params: GetAssetsUnderManagementParams,
    ) -> Result<u128> {
        Ok(ctx.accounts.pool.aum_usd)
    }

    pub fn get_lp_token_price(
        _ctx: Context<GetLpTokenPrice>,
        _params: GetLpTokenPriceParams,
    ) -> Result<u64> {
        Ok(1_000000)
    }

    pub fn swap(
        ctx: Context<Swap>,
        params: SwapParams,
    ) -> Result<()> {
        require!(params.amount_in > 0, ErrorCode::InvalidInput);
        require!(params.min_amount_out > 0, ErrorCode::InvalidInput);
        
        let receiving_custody = &mut ctx.accounts.receiving_custody;
        let dispensing_custody = &mut ctx.accounts.dispensing_custody;
        
        let fee_in_rate = receiving_custody.fees.swap_in;
        let fee_in = params.amount_in
            .checked_mul(fee_in_rate)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(10000)
            .ok_or(ErrorCode::MathOverflow)?;
        
        let amount_after_fee_in = params.amount_in
            .checked_sub(fee_in)
            .ok_or(ErrorCode::MathOverflow)?;
        
        let amount_out = amount_after_fee_in
            .checked_mul(98)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(100)
            .ok_or(ErrorCode::MathOverflow)?;
        
        let fee_out_rate = dispensing_custody.fees.swap_out;
        let fee_out = amount_out
            .checked_mul(fee_out_rate)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(10000)
            .ok_or(ErrorCode::MathOverflow)?;
        
        let final_amount_out = amount_out
            .checked_sub(fee_out)
            .ok_or(ErrorCode::MathOverflow)?;
        
        require!(final_amount_out >= params.min_amount_out, ErrorCode::InvalidInput);
        
        receiving_custody.assets.owned = receiving_custody.assets.owned
            .checked_add(params.amount_in)
            .ok_or(ErrorCode::MathOverflow)?;
        receiving_custody.collected_fees.swap_usd = receiving_custody.collected_fees.swap_usd
            .checked_add(fee_in)
            .ok_or(ErrorCode::MathOverflow)?;
        receiving_custody.volume_stats.swap_usd = receiving_custody.volume_stats.swap_usd
            .checked_add(params.amount_in)
            .ok_or(ErrorCode::MathOverflow)?;
        
        dispensing_custody.assets.owned = dispensing_custody.assets.owned
            .checked_sub(final_amount_out)
            .ok_or(ErrorCode::MathOverflow)?;
        dispensing_custody.collected_fees.swap_usd = dispensing_custody.collected_fees.swap_usd
            .checked_add(fee_out)
            .ok_or(ErrorCode::MathOverflow)?;
        
        Ok(())
    }

    pub fn add_liquidity(
        ctx: Context<AddLiquidity>,
        params: AddLiquidityParams,
    ) -> Result<()> {
        require!(params.amount_in > 0, ErrorCode::InvalidInput);
        require!(params.min_lp_amount_out > 0, ErrorCode::InvalidInput);

        let perpetuals = ctx.accounts.perpetuals.as_mut();
        
        let pool = &mut ctx.accounts.pool;
        let custody = &mut ctx.accounts.custody;
        
        let fee_rate = custody.fees.add_liquidity;
        let fee = params.amount_in
            .checked_mul(fee_rate)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(10000)
            .ok_or(ErrorCode::MathOverflow)?;
        
        let amount_after_fee = params.amount_in
            .checked_sub(fee)
            .ok_or(ErrorCode::MathOverflow)?;
        
        let lp_amount = amount_after_fee;
        
        require!(lp_amount >= params.min_lp_amount_out, ErrorCode::InvalidInput);
        
        // Transfer tokens from funding_account to custody_token_account
        // Owner signs the transfer from their funding account
        perpetuals.transfer_tokens_from_user(
            ctx.accounts.funding_account.to_account_info(),
            ctx.accounts.custody_token_account.to_account_info(),
            ctx.accounts.owner.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            params.amount_in,
        )?;
        
        // Mint LP tokens to lp_token_account
        // Transfer authority PDA signs the mint
        perpetuals.mint_tokens(
            ctx.accounts.lp_token_mint.to_account_info(),
            ctx.accounts.lp_token_account.to_account_info(),
            ctx.accounts.transfer_authority.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            lp_amount,
        )?;
        
        custody.assets.owned = custody.assets.owned
            .checked_add(params.amount_in)
            .ok_or(ErrorCode::MathOverflow)?;
        custody.collected_fees.add_liquidity_usd = custody.collected_fees.add_liquidity_usd
            .checked_add(fee)
            .ok_or(ErrorCode::MathOverflow)?;
        custody.volume_stats.add_liquidity_usd = custody.volume_stats.add_liquidity_usd
            .checked_add(params.amount_in)
            .ok_or(ErrorCode::MathOverflow)?;
        
        pool.aum_usd = pool.aum_usd
            .checked_add(amount_after_fee as u128)
            .ok_or(ErrorCode::MathOverflow)?;
        
        Ok(())
    }

    pub fn remove_liquidity(
        ctx: Context<RemoveLiquidity>,
        params: RemoveLiquidityParams,
    ) -> Result<()> {
        require!(params.lp_amount_in > 0, ErrorCode::InvalidInput);
        require!(params.min_amount_out > 0, ErrorCode::InvalidInput);
        
        let perpetuals = ctx.accounts.perpetuals.as_mut();
        let pool = &mut ctx.accounts.pool;
        let custody = &mut ctx.accounts.custody;
        
        let fee_rate = custody.fees.remove_liquidity;
        let fee = params.lp_amount_in
            .checked_mul(fee_rate)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(10000)
            .ok_or(ErrorCode::MathOverflow)?;
        
        let amount_out = params.lp_amount_in
            .checked_sub(fee)
            .ok_or(ErrorCode::MathOverflow)?;
        
        require!(amount_out >= params.min_amount_out, ErrorCode::InvalidInput);
        
        // Transfer tokens from custody_token_account to receiving_account
        // Transfer authority PDA signs the transfer
        perpetuals.transfer_tokens(
            ctx.accounts.custody_token_account.to_account_info(),
            ctx.accounts.receiving_account.to_account_info(),
            ctx.accounts.transfer_authority.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            amount_out,
        )?;
        
        // Burn LP tokens from lp_token_account
        // Owner signs the burn (not transfer_authority)
        perpetuals.burn_tokens(
            ctx.accounts.lp_token_mint.to_account_info(),
            ctx.accounts.lp_token_account.to_account_info(),
            ctx.accounts.owner.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            params.lp_amount_in,
        )?;
        
        custody.assets.owned = custody.assets.owned
            .checked_sub(amount_out)
            .ok_or(ErrorCode::MathOverflow)?;
        custody.collected_fees.remove_liquidity_usd = custody.collected_fees.remove_liquidity_usd
            .checked_add(fee)
            .ok_or(ErrorCode::MathOverflow)?;
        custody.volume_stats.remove_liquidity_usd = custody.volume_stats.remove_liquidity_usd
            .checked_add(params.lp_amount_in)
            .ok_or(ErrorCode::MathOverflow)?;
        
        pool.aum_usd = pool.aum_usd
            .checked_sub(params.lp_amount_in as u128)
            .ok_or(ErrorCode::MathOverflow)?;
        
        Ok(())
    }

    pub fn init(
        ctx: Context<Init>,
        params: InitParams,
    ) -> Result<()> {
        let perpetuals = &mut ctx.accounts.perpetuals;
        let multisig = &mut ctx.accounts.multisig;
        
        perpetuals.permissions = Permissions {
            allow_swap: params.allow_swap,
            allow_add_liquidity: params.allow_add_liquidity,
            allow_remove_liquidity: params.allow_remove_liquidity,
            allow_open_position: params.allow_open_position,
            allow_close_position: params.allow_close_position,
            allow_pnl_withdrawal: params.allow_pnl_withdrawal,
            allow_collateral_withdrawal: params.allow_collateral_withdrawal,
            allow_size_change: params.allow_size_change,
        };
        perpetuals.pools = Vec::new();
        perpetuals.transfer_authority_bump = ctx.bumps.transfer_authority;
        perpetuals.perpetuals_bump = ctx.bumps.perpetuals;
        perpetuals.inception_time = Clock::get()?.unix_timestamp;
        
        multisig.num_signers = 0;
        multisig.num_signed = 0;
        multisig.min_signatures = params.min_signatures;
        multisig.instruction_accounts_len = 0;
        multisig.instruction_data_len = 0;
        multisig.instruction_hash = 0;
        multisig.signers = [Pubkey::default(); 6];
        multisig.signed = [0; 6];
        multisig.bump = ctx.bumps.multisig;
        
        Ok(())
    }

    pub fn add_pool(
        ctx: Context<AddPool>,
        params: AddPoolParams,
    ) -> Result<u8> {
        let perpetuals = &mut ctx.accounts.perpetuals;
        let pool = &mut ctx.accounts.pool;
        
        pool.name = params.name;
        pool.custodies = Vec::new();
        pool.ratios = Vec::new();
        pool.aum_usd = 0;
        pool.bump = ctx.bumps.pool;
        pool.lp_token_bump = ctx.bumps.lp_token_mint;
        pool.inception_time = Clock::get()?.unix_timestamp;
        
        perpetuals.pools.push(pool.key());
        
        Ok(pool.bump)
    }

    pub fn remove_pool(
        ctx: Context<RemovePool>,
        _params: RemovePoolParams,
    ) -> Result<u8> {
        let perpetuals = &mut ctx.accounts.perpetuals;
        let pool_key = ctx.accounts.pool.key();
        let bump = ctx.accounts.pool.bump;
        perpetuals.pools.retain(|&p| p != pool_key);
        Ok(bump)
    }

    pub fn add_custody(
        ctx: Context<AddCustody>,
        params: AddCustodyParams,
    ) -> Result<u8> {
        let pool = &mut ctx.accounts.pool;
        let custody = &mut ctx.accounts.custody;
        
        let mint_data = ctx.accounts.custody_token_mint.data.borrow();
        let decimals = mint_data[44];
        
        custody.pool = pool.key();
        custody.mint = ctx.accounts.custody_token_mint.key();
        custody.token_account = ctx.accounts.custody_token_account.key();
        custody.decimals = decimals;
        custody.is_stable = params.is_stable;
        custody.is_virtual = params.is_virtual;
        custody.oracle = params.oracle;
        custody.pricing = params.pricing;
        custody.permissions = params.permissions;
        custody.fees = params.fees;
        custody.borrow_rate = params.borrow_rate;
        custody.assets = Assets {
            collateral: 0,
            protocol_fees: 0,
            owned: 0,
            locked: 0,
        };
        custody.collected_fees = FeesStats {
            swap_usd: 0,
            add_liquidity_usd: 0,
            remove_liquidity_usd: 0,
            open_position_usd: 0,
            close_position_usd: 0,
            liquidation_usd: 0,
        };
        custody.volume_stats = VolumeStats {
            swap_usd: 0,
            add_liquidity_usd: 0,
            remove_liquidity_usd: 0,
            open_position_usd: 0,
            close_position_usd: 0,
            liquidation_usd: 0,
        };
        custody.trade_stats = TradeStats {
            profit_usd: 0,
            loss_usd: 0,
            oi_long_usd: 0,
            oi_short_usd: 0,
        };
        custody.long_positions = PositionStats {
            open_positions: 0,
            collateral_usd: 0,
            size_usd: 0,
            borrow_size_usd: 0,
            locked_amount: 0,
            weighted_price: 0,
            total_quantity: 0,
            cumulative_interest_usd: 0,
            cumulative_interest_snapshot: 0,
        };
        custody.short_positions = PositionStats {
            open_positions: 0,
            collateral_usd: 0,
            size_usd: 0,
            borrow_size_usd: 0,
            locked_amount: 0,
            weighted_price: 0,
            total_quantity: 0,
            cumulative_interest_usd: 0,
            cumulative_interest_snapshot: 0,
        };
        custody.borrow_rate_state = BorrowRateState {
            current_rate: 0,
            cumulative_interest: 0,
            last_update: Clock::get()?.unix_timestamp,
        };
        custody.bump = ctx.bumps.custody;
        custody.token_account_bump = ctx.bumps.custody_token_account;
        
        pool.custodies.push(custody.key());
        for ratio in params.ratios {
            pool.ratios.push(ratio);
        }
        
        Ok(custody.bump)
    }

    pub fn remove_custody(
        ctx: Context<RemoveCustody>,
        params: RemoveCustodyParams,
    ) -> Result<u8> {
        let pool = &mut ctx.accounts.pool;
        let custody_key = ctx.accounts.custody.key();
        let bump = ctx.accounts.custody.bump;
        
        if let Some(pos) = pool.custodies.iter().position(|&c| c == custody_key) {
            pool.custodies.remove(pos);
            pool.ratios.remove(pos);
        }
        
        pool.ratios.clear();
        for ratio in params.ratios {
            pool.ratios.push(ratio);
        }
        
        Ok(bump)
    }

    pub fn set_custody_config(
        ctx: Context<SetCustodyConfig>,
        params: SetCustodyConfigParams,
    ) -> Result<u8> {
        let custody = &mut ctx.accounts.custody;
        let pool = &mut ctx.accounts.pool;
        
        custody.is_stable = params.is_stable;
        custody.is_virtual = params.is_virtual;
        custody.oracle = params.oracle;
        custody.pricing = params.pricing;
        custody.permissions = params.permissions;
        custody.fees = params.fees;
        custody.borrow_rate = params.borrow_rate;
        
        pool.ratios.clear();
        for ratio in params.ratios {
            pool.ratios.push(ratio);
        }
        
        Ok(custody.bump)
    }

    pub fn set_permissions(
        ctx: Context<SetPermissions>,
        params: SetPermissionsParams,
    ) -> Result<u8> {
        let perpetuals = &mut ctx.accounts.perpetuals;
        perpetuals.permissions = Permissions {
            allow_swap: params.allow_swap,
            allow_add_liquidity: params.allow_add_liquidity,
            allow_remove_liquidity: params.allow_remove_liquidity,
            allow_open_position: params.allow_open_position,
            allow_close_position: params.allow_close_position,
            allow_pnl_withdrawal: params.allow_pnl_withdrawal,
            allow_collateral_withdrawal: params.allow_collateral_withdrawal,
            allow_size_change: params.allow_size_change,
        };
        Ok(perpetuals.perpetuals_bump)
    }

    pub fn set_admin_signers(
        ctx: Context<SetAdminSigners>,
        params: SetAdminSignersParams,
    ) -> Result<u8> {
        let multisig = &mut ctx.accounts.multisig;
        multisig.min_signatures = params.min_signatures;
        Ok(multisig.bump)
    }

    pub fn withdraw_fees(
        ctx: Context<WithdrawFees>,
        params: WithdrawFeesParams,
    ) -> Result<u8> {
        let custody = &mut ctx.accounts.custody;
        
        let amount = if params.amount > 0 {
            params.amount
        } else {
            custody.assets.protocol_fees
        };
        
        require!(amount <= custody.assets.protocol_fees, ErrorCode::InvalidInput);
        
        custody.assets.protocol_fees = custody.assets.protocol_fees
            .checked_sub(amount)
            .ok_or(ErrorCode::MathOverflow)?;
        custody.assets.owned = custody.assets.owned
            .checked_sub(amount)
            .ok_or(ErrorCode::MathOverflow)?;
        
        Ok(custody.bump)
    }

    pub fn withdraw_sol_fees(
        ctx: Context<WithdrawSolFees>,
        params: WithdrawSolFeesParams,
    ) -> Result<u8> {
        let perpetuals = &ctx.accounts.perpetuals;
        let receiver = &ctx.accounts.receiver;
        
        let amount = if params.amount > 0 {
            params.amount
        } else {
            perpetuals.to_account_info().lamports()
        };
        
        **perpetuals.to_account_info().try_borrow_mut_lamports()? = perpetuals
            .to_account_info()
            .lamports()
            .checked_sub(amount)
            .ok_or(ErrorCode::MathOverflow)?;
        
        **receiver.try_borrow_mut_lamports()? = receiver
            .lamports()
            .checked_add(amount)
            .ok_or(ErrorCode::MathOverflow)?;
        
        Ok(perpetuals.perpetuals_bump)
    }

    pub fn set_custom_oracle_price(
        ctx: Context<SetCustomOraclePrice>,
        params: SetCustomOraclePriceParams,
    ) -> Result<u8> {
        let oracle = &mut ctx.accounts.custom_oracle;
        oracle.price = params.price;
        oracle.expo = params.expo;
        oracle.conf = params.conf;
        oracle.ema = params.ema;
        oracle.publish_time = params.publish_time;
        Ok(0)
    }

    pub fn set_test_time(
        _ctx: Context<SetTestTime>,
        _params: SetTestTimeParams,
    ) -> Result<u8> {
        Ok(0)
    }

    pub fn upgrade_custody(
        ctx: Context<UpgradeCustody>,
        _params: UpgradeCustodyParams,
    ) -> Result<u8> {
        Ok(ctx.accounts.custody.bump)
    }
}

impl Perpetuals {
    pub fn mint_tokens<'info>(
        &self,
        mint: AccountInfo<'info>,
        to: AccountInfo<'info>,
        authority: AccountInfo<'info>,
        token_program: AccountInfo<'info>,
        amount: u64,
    ) -> Result<()> {
        let authority_seeds: &[&[&[u8]]] =
            &[&[b"transfer_authority", &[self.transfer_authority_bump]]];
        let context = CpiContext::new(
            token_program,
            MintTo {
                mint,
                to,
                authority,
            },
        )
        .with_signer(authority_seeds);

        anchor_spl::token::mint_to(context, amount)
    }

    pub fn transfer_tokens_from_user<'info>(
        &self,
        from: AccountInfo<'info>,
        to: AccountInfo<'info>,
        authority: AccountInfo<'info>,
        token_program: AccountInfo<'info>,
        amount: u64,
    ) -> Result<()> {
        let context = CpiContext::new(
            token_program,
            Transfer {
                from,
                to,
                authority,
            },
        );
        anchor_spl::token::transfer(context, amount)
    }

    pub fn transfer_tokens<'info>(
        &self,
        from: AccountInfo<'info>,
        to: AccountInfo<'info>,
        authority: AccountInfo<'info>,
        token_program: AccountInfo<'info>,
        amount: u64,
    ) -> Result<()> {
        let authority_seeds: &[&[&[u8]]] =
            &[&[b"transfer_authority", &[self.transfer_authority_bump]]];
        let context = CpiContext::new(
            token_program,
            Transfer {
                from,
                to,
                authority,
            },
        )
        .with_signer(authority_seeds);

        anchor_spl::token::transfer(context, amount)
    }

    pub fn burn_tokens<'info>(
        &self,
        mint: AccountInfo<'info>,
        from: AccountInfo<'info>,
        authority: AccountInfo<'info>,
        token_program: AccountInfo<'info>,
        amount: u64,
    ) -> Result<()> {
        // Note: owner signs the burn, not transfer_authority
        let context = CpiContext::new(
            token_program,
            Burn {
                mint,
                from,
                authority,
            },
        );

        anchor_spl::token::burn(context, amount)
    }
}

fn get_price_from_oracle(
    oracle_params: &OracleParams,
    oracle_account: &AccountInfo,
) -> Result<u64> {
    match oracle_params.oracle_type {
        OracleType::Custom => {
            let data = oracle_account.try_borrow_data()?;
            require!(data.len() >= 8 + std::mem::size_of::<CustomOracle>(), ErrorCode::InvalidInput);
            
            let price_data = &data[8..];
            let price = u64::from_le_bytes(price_data[0..8].try_into().unwrap());
            
            Ok(price)
        },
        OracleType::Pyth => {
            Ok(50000_00_0000)
        },
        OracleType::None => {
            Ok(50000_00_0000)
        }
    }
}

fn calculate_fee_rate(
    mode: FeesMode,
    base_rate: u64,
    custody: &Custody,
    _size_usd: u64,
) -> Result<u64> {
    match mode {
        FeesMode::Fixed => Ok(base_rate),
        FeesMode::Linear => {
            let total_locked = custody.assets.locked;
            let total_owned = custody.assets.owned;
            
            if total_owned == 0 {
                return Ok(base_rate);
            }
            
            let utilization = total_locked
                .checked_mul(10000)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(total_owned)
                .ok_or(ErrorCode::MathOverflow)?;
            
            let utilization_mult = custody.fees.utilization_mult;
            let additional_fee = utilization
                .checked_mul(utilization_mult)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(10000)
                .ok_or(ErrorCode::MathOverflow)?;
            
            let total_fee = base_rate
                .checked_add(additional_fee)
                .ok_or(ErrorCode::MathOverflow)?;
            
            Ok(total_fee.min(custody.fees.fee_max))
        },
        FeesMode::Optimal => {
            let total_locked = custody.assets.locked;
            let total_owned = custody.assets.owned;
            
            if total_owned == 0 {
                return Ok(base_rate);
            }
            
            let utilization = total_locked
                .checked_mul(10000)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(total_owned)
                .ok_or(ErrorCode::MathOverflow)?;
            
            let optimal_util = custody.borrow_rate.optimal_utilization;
            
            let fee = if utilization <= optimal_util {
                let utilization_ratio = utilization
                    .checked_mul(10000)
                    .ok_or(ErrorCode::MathOverflow)?
                    .checked_div(optimal_util)
                    .ok_or(ErrorCode::MathOverflow)?;
                
                base_rate
                    .checked_add(
                        custody.fees.fee_optimal
                            .checked_mul(utilization_ratio)
                            .ok_or(ErrorCode::MathOverflow)?
                            .checked_div(10000)
                            .ok_or(ErrorCode::MathOverflow)?
                    )
                    .ok_or(ErrorCode::MathOverflow)?
            } else {
                let excess_util = utilization
                    .checked_sub(optimal_util)
                    .ok_or(ErrorCode::MathOverflow)?;
                
                let excess_ratio = excess_util
                    .checked_mul(10000)
                    .ok_or(ErrorCode::MathOverflow)?
                    .checked_div(10000u64.checked_sub(optimal_util).ok_or(ErrorCode::MathOverflow)?)
                    .ok_or(ErrorCode::MathOverflow)?;
                
                custody.fees.fee_optimal
                    .checked_add(
                        (custody.fees.fee_max.checked_sub(custody.fees.fee_optimal).ok_or(ErrorCode::MathOverflow)?)
                            .checked_mul(excess_ratio)
                            .ok_or(ErrorCode::MathOverflow)?
                            .checked_div(10000)
                            .ok_or(ErrorCode::MathOverflow)?
                    )
                    .ok_or(ErrorCode::MathOverflow)?
            };
            
            Ok(fee.min(custody.fees.fee_max))
        }
    }
}

#[init_computation_definition_accounts("open_position", payer)]
#[derive(Accounts)]
pub struct InitOpenPositionCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("open_position", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64, position_id: u64)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(
        mut,
        address = derive_mempool_pda!()
    )]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_execpool_pda!()
    )]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_comp_pda!(computation_offset)
    )]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_OPEN_POSITION)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account)
    )]
    pub cluster_account: Account<'info, Cluster>,
    #[account(
        mut,
        address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS,
    )]
    pub pool_account: Account<'info, FeePool>,
    #[account(
        address = ARCIUM_CLOCK_ACCOUNT_ADDRESS,
    )]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        init,
        payer = payer,
        space = 8 + Position::INIT_SPACE,
        seeds = [b"position", owner.key().as_ref(), position_id.to_le_bytes().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,
}

#[callback_accounts("open_position", payer)]
#[derive(Accounts)]
pub struct OpenPositionCallback<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_OPEN_POSITION)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub position: Account<'info, Position>,
}

#[init_computation_definition_accounts("calculate_position_value", payer)]
#[derive(Accounts)]
pub struct InitCalculatePositionValueCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("calculate_position_value", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64, _position_id: u64)]
pub struct CalculatePositionValue<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(
        mut,
        address = derive_mempool_pda!()
    )]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_execpool_pda!()
    )]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_comp_pda!(computation_offset)
    )]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_CALCULATE_POSITION_VALUE)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account)
    )]
    pub cluster_account: Account<'info, Cluster>,
    #[account(
        mut,
        address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS,
    )]
    pub pool_account: Account<'info, FeePool>,
    #[account(
        address = ARCIUM_CLOCK_ACCOUNT_ADDRESS,
    )]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        mut,
        seeds = [b"position", position.owner.as_ref(), _position_id.to_le_bytes().as_ref()],
        bump = position.bump,
    )]
    pub position: Account<'info, Position>,
}

#[callback_accounts("calculate_position_value", payer)]
#[derive(Accounts)]
pub struct CalculatePositionValueCallback<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_CALCULATE_POSITION_VALUE)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub position: Account<'info, Position>,
}

#[init_computation_definition_accounts("close_position", payer)]
#[derive(Accounts)]
pub struct InitClosePositionCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("close_position", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64, _position_id: u64)]
pub struct ClosePosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(
        mut,
        address = derive_mempool_pda!()
    )]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_execpool_pda!()
    )]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_comp_pda!(computation_offset)
    )]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_CLOSE_POSITION)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account)
    )]
    pub cluster_account: Account<'info, Cluster>,
    #[account(
        mut,
        address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS,
    )]
    pub pool_account: Account<'info, FeePool>,
    #[account(
        address = ARCIUM_CLOCK_ACCOUNT_ADDRESS,
    )]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        mut,
        seeds = [b"position", owner.key().as_ref(), _position_id.to_le_bytes().as_ref()],
        bump = position.bump,
    )]
    pub position: Account<'info, Position>,
}

#[callback_accounts("close_position", payer)]
#[derive(Accounts)]
pub struct ClosePositionCallback<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_CLOSE_POSITION)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub position: Account<'info, Position>,
}

#[init_computation_definition_accounts("add_collateral", payer)]
#[derive(Accounts)]
pub struct InitAddCollateralCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("add_collateral", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64, _position_id: u64)]
pub struct AddCollateral<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(
        mut,
        address = derive_mempool_pda!()
    )]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_execpool_pda!()
    )]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_comp_pda!(computation_offset)
    )]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_ADD_COLLATERAL)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account)
    )]
    pub cluster_account: Account<'info, Cluster>,
    #[account(
        mut,
        address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS,
    )]
    pub pool_account: Account<'info, FeePool>,
    #[account(
        address = ARCIUM_CLOCK_ACCOUNT_ADDRESS,
    )]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        mut,
        seeds = [b"position", owner.key().as_ref(), _position_id.to_le_bytes().as_ref()],
        bump = position.bump,
    )]
    pub position: Account<'info, Position>,
}

#[callback_accounts("add_collateral", payer)]
#[derive(Accounts)]
pub struct AddCollateralCallback<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_ADD_COLLATERAL)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub position: Account<'info, Position>,
}

#[init_computation_definition_accounts("remove_collateral", payer)]
#[derive(Accounts)]
pub struct InitRemoveCollateralCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("remove_collateral", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64, _position_id: u64)]
pub struct RemoveCollateral<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(
        mut,
        address = derive_mempool_pda!()
    )]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_execpool_pda!()
    )]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_comp_pda!(computation_offset)
    )]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_REMOVE_COLLATERAL)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account)
    )]
    pub cluster_account: Account<'info, Cluster>,
    #[account(
        mut,
        address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS,
    )]
    pub pool_account: Account<'info, FeePool>,
    #[account(
        address = ARCIUM_CLOCK_ACCOUNT_ADDRESS,
    )]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        mut,
        seeds = [b"position", owner.key().as_ref(), _position_id.to_le_bytes().as_ref()],
        bump = position.bump,
    )]
    pub position: Account<'info, Position>,
}

#[callback_accounts("remove_collateral", payer)]
#[derive(Accounts)]
pub struct RemoveCollateralCallback<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_REMOVE_COLLATERAL)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub position: Account<'info, Position>,
}

#[init_computation_definition_accounts("liquidate", payer)]
#[derive(Accounts)]
pub struct InitLiquidateCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("liquidate", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64, _position_id: u64)]
pub struct Liquidate<'info> {
    /// The liquidator (can be anyone)
    #[account(mut)]
    pub liquidator: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(
        mut,
        address = derive_mempool_pda!()
    )]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_execpool_pda!()
    )]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_comp_pda!(computation_offset)
    )]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_LIQUIDATE)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account)
    )]
    pub cluster_account: Account<'info, Cluster>,
    #[account(
        mut,
        address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS,
    )]
    pub pool_account: Account<'info, FeePool>,
    #[account(
        address = ARCIUM_CLOCK_ACCOUNT_ADDRESS,
    )]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        mut,
        seeds = [b"position", position.owner.as_ref(), _position_id.to_le_bytes().as_ref()],
        bump = position.bump,
    )]
    pub position: Account<'info, Position>,
}

#[callback_accounts("liquidate", payer)]
#[derive(Accounts)]
pub struct LiquidateCallback<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_LIQUIDATE)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub position: Account<'info, Position>,
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub owner: Pubkey,
    pub position_id: u64,
    pub side: PositionSide,
    pub size_usd_encrypted: [u8; 32],
    pub collateral_usd_encrypted: [u8; 32],
    pub entry_price: u64,
    pub open_time: i64,
    pub update_time: i64,
    pub owner_enc_pubkey: [u8; 32],
    pub size_nonce: u128,
    pub collateral_nonce: u128,
    pub liquidator: Pubkey,
    pub bump: u8,
}

#[repr(u8)]
#[derive(InitSpace, AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PositionSide {
    Long = 0,
    Short = 1,
}

#[event]
pub struct PositionOpenedEvent {
    pub position_id: u64,
    pub owner: Pubkey,
    pub side: PositionSide,
    pub entry_price: u64,
    pub size_encrypted: [u8; 32],
    pub size_nonce: u128,
    pub collateral_encrypted: [u8; 32],
    pub collateral_nonce: u128,
}

#[event]
pub struct PositionValueCalculatedEvent {
    pub position_id: u64,
    pub current_value_encrypted: [u8; 32],
    pub pnl_encrypted: [u8; 32],
    pub value_nonce: u128,
}

#[event]
pub struct PositionClosedEvent {
    pub position_id: u64,
    pub owner: Pubkey,
    pub realized_pnl_encrypted: [u8; 32],
    pub final_balance_encrypted: [u8; 32],
    pub can_close_encrypted: [u8; 32],
    pub nonce: u128,
}

#[event]
pub struct CollateralAddedEvent {
    pub position_id: u64,
    pub owner: Pubkey,
    pub new_collateral_encrypted: [u8; 32],
    pub new_leverage_encrypted: [u8; 32],
    pub nonce: u128,
}

#[event]
pub struct CollateralRemovedEvent {
    pub position_id: u64,
    pub owner: Pubkey,
    pub new_collateral_encrypted: [u8; 32],
    pub removed_amount_encrypted: [u8; 32],
    pub new_leverage_encrypted: [u8; 32],
    pub nonce: u128,
}

#[event]
pub struct PositionLiquidatedEvent {
    pub position_id: u64,
    pub owner: Pubkey,
    pub liquidator: Pubkey,
    pub is_liquidatable_encrypted: [u8; 32],
    pub remaining_collateral_encrypted: [u8; 32],
    pub penalty_encrypted: [u8; 32],
    pub nonce: u128,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct GetEntryPriceAndFeeParams {
    pub collateral: u64,
    pub size: u64,
    pub side: Side,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct GetExitPriceAndFeeParams {}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct GetPnlParams {}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct GetLiquidationPriceParams {
    pub add_collateral: u64,
    pub remove_collateral: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct GetLiquidationStateParams {}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct GetOraclePriceParams {
    pub ema: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct GetSwapAmountAndFeesParams {
    pub amount_in: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct GetAddLiquidityAmountAndFeeParams {
    pub amount_in: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct GetRemoveLiquidityAmountAndFeeParams {
    pub lp_amount_in: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct GetAssetsUnderManagementParams {}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct GetLpTokenPriceParams {}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SwapParams {
    pub amount_in: u64,
    pub min_amount_out: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AddLiquidityParams {
    pub amount_in: u64,
    pub min_lp_amount_out: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RemoveLiquidityParams {
    pub lp_amount_in: u64,
    pub min_amount_out: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitParams {
    pub min_signatures: u8,
    pub allow_swap: bool,
    pub allow_add_liquidity: bool,
    pub allow_remove_liquidity: bool,
    pub allow_open_position: bool,
    pub allow_close_position: bool,
    pub allow_pnl_withdrawal: bool,
    pub allow_collateral_withdrawal: bool,
    pub allow_size_change: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AddPoolParams {
    pub name: String,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RemovePoolParams {}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AddCustodyParams {
    pub is_stable: bool,
    pub is_virtual: bool,
    pub oracle: OracleParams,
    pub pricing: PricingParams,
    pub permissions: Permissions,
    pub fees: Fees,
    pub borrow_rate: BorrowRateParams,
    pub ratios: Vec<TokenRatios>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RemoveCustodyParams {
    pub ratios: Vec<TokenRatios>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SetCustodyConfigParams {
    pub is_stable: bool,
    pub is_virtual: bool,
    pub oracle: OracleParams,
    pub pricing: PricingParams,
    pub permissions: Permissions,
    pub fees: Fees,
    pub borrow_rate: BorrowRateParams,
    pub ratios: Vec<TokenRatios>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SetPermissionsParams {
    pub allow_swap: bool,
    pub allow_add_liquidity: bool,
    pub allow_remove_liquidity: bool,
    pub allow_open_position: bool,
    pub allow_close_position: bool,
    pub allow_pnl_withdrawal: bool,
    pub allow_collateral_withdrawal: bool,
    pub allow_size_change: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SetAdminSignersParams {
    pub min_signatures: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct WithdrawFeesParams {
    pub amount: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct WithdrawSolFeesParams {
    pub amount: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SetCustomOraclePriceParams {
    pub price: u64,
    pub expo: i32,
    pub conf: u64,
    pub ema: u64,
    pub publish_time: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SetTestTimeParams {
    pub time: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpgradeCustodyParams {}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct NewPositionPricesAndFee {
    pub entry_price: u64,
    pub liquidation_price: u64,
    pub fee: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PriceAndFee {
    pub price: u64,
    pub fee: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ProfitAndLoss {
    pub profit: u64,
    pub loss: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AmountAndFee {
    pub amount: u64,
    pub fee: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SwapAmountAndFees {
    pub amount_out: u64,
    pub fee_in: u64,
    pub fee_out: u64,
}

#[derive(Accounts)]
pub struct GetEntryPriceAndFee<'info> {
    pub perpetuals: Account<'info, Perpetuals>,
    pub pool: Account<'info, Pool>,
    pub custody: Account<'info, Custody>,
    /// CHECK: Oracle account verified by custody
    pub custody_oracle_account: AccountInfo<'info>,
    pub collateral_custody: Account<'info, Custody>,
    /// CHECK: Oracle account verified by collateral custody
    pub collateral_custody_oracle_account: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct GetExitPriceAndFee<'info> {
    pub perpetuals: Account<'info, Perpetuals>,
    pub pool: Account<'info, Pool>,
    pub position: Account<'info, Position>,
    pub custody: Account<'info, Custody>,
    /// CHECK: Oracle account verified by custody
    pub custody_oracle_account: AccountInfo<'info>,
    pub collateral_custody: Account<'info, Custody>,
    /// CHECK: Oracle account verified by collateral custody
    pub collateral_custody_oracle_account: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct GetPnl<'info> {
    pub perpetuals: Account<'info, Perpetuals>,
    pub pool: Account<'info, Pool>,
    pub position: Account<'info, Position>,
    pub custody: Account<'info, Custody>,
    /// CHECK: Oracle account verified by custody
    pub custody_oracle_account: AccountInfo<'info>,
    pub collateral_custody: Account<'info, Custody>,
    /// CHECK: Oracle account verified by collateral custody
    pub collateral_custody_oracle_account: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct GetLiquidationPrice<'info> {
    pub perpetuals: Account<'info, Perpetuals>,
    pub pool: Account<'info, Pool>,
    pub position: Account<'info, Position>,
    pub custody: Account<'info, Custody>,
    /// CHECK: Oracle account verified by custody
    pub custody_oracle_account: AccountInfo<'info>,
    pub collateral_custody: Account<'info, Custody>,
    /// CHECK: Oracle account verified by collateral custody
    pub collateral_custody_oracle_account: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct GetLiquidationState<'info> {
    pub perpetuals: Account<'info, Perpetuals>,
    pub pool: Account<'info, Pool>,
    pub position: Account<'info, Position>,
    pub custody: Account<'info, Custody>,
    /// CHECK: Oracle account verified by custody
    pub custody_oracle_account: AccountInfo<'info>,
    pub collateral_custody: Account<'info, Custody>,
    /// CHECK: Oracle account verified by collateral custody
    pub collateral_custody_oracle_account: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct GetOraclePrice<'info> {
    pub perpetuals: Account<'info, Perpetuals>,
    pub pool: Account<'info, Pool>,
    pub custody: Account<'info, Custody>,
    /// CHECK: Oracle account verified by custody
    pub custody_oracle_account: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct GetSwapAmountAndFees<'info> {
    pub perpetuals: Account<'info, Perpetuals>,
    pub pool: Account<'info, Pool>,
    pub receiving_custody: Account<'info, Custody>,
    /// CHECK: Oracle account verified by receiving custody
    pub receiving_custody_oracle_account: AccountInfo<'info>,
    pub dispensing_custody: Account<'info, Custody>,
    /// CHECK: Oracle account verified by dispensing custody
    pub dispensing_custody_oracle_account: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct GetAddLiquidityAmountAndFee<'info> {
    pub perpetuals: Account<'info, Perpetuals>,
    pub pool: Account<'info, Pool>,
    pub custody: Account<'info, Custody>,
    /// CHECK: Oracle account verified by custody
    pub custody_oracle_account: AccountInfo<'info>,
    /// CHECK: LP token mint account
    pub lp_token_mint: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct GetRemoveLiquidityAmountAndFee<'info> {
    pub perpetuals: Account<'info, Perpetuals>,
    pub pool: Account<'info, Pool>,
    pub custody: Account<'info, Custody>,
    /// CHECK: Oracle account verified by custody
    pub custody_oracle_account: AccountInfo<'info>,
    /// CHECK: LP token mint account
    pub lp_token_mint: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct GetAssetsUnderManagement<'info> {
    pub perpetuals: Account<'info, Perpetuals>,
    pub pool: Account<'info, Pool>,
}

#[derive(Accounts)]
pub struct GetLpTokenPrice<'info> {
    pub perpetuals: Account<'info, Perpetuals>,
    pub pool: Account<'info, Pool>,
    /// CHECK: LP token mint account
    pub lp_token_mint: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: Transfer authority PDA
    pub transfer_authority: AccountInfo<'info>,
    pub perpetuals: Account<'info, Perpetuals>,
    #[account(mut)]
    pub pool: Account<'info, Pool>,
    #[account(mut)]
    pub receiving_custody: Account<'info, Custody>,
    /// CHECK: Receiving custody token account
    pub receiving_custody_token_account: AccountInfo<'info>,
    #[account(mut)]
    pub dispensing_custody: Account<'info, Custody>,
    /// CHECK: Dispensing custody token account
    pub dispensing_custody_token_account: AccountInfo<'info>,
    /// CHECK: Funding account
    pub funding_account: AccountInfo<'info>,
    /// CHECK: Receiving account
    pub receiving_account: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct AddLiquidity<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: Transfer authority PDA
    #[account(
        seeds = [b"transfer_authority"],
        bump = perpetuals.transfer_authority_bump
    )]
    pub transfer_authority: AccountInfo<'info>,
    #[account(
        seeds = [b"perpetuals"],
        bump = perpetuals.perpetuals_bump
    )]
    pub perpetuals: Box<Account<'info, Perpetuals>>,
    #[account(mut)]
    pub pool: Account<'info, Pool>,
    #[account(mut)]
    pub custody: Account<'info, Custody>,
    /// CHECK: oracle account for the receiving token
    #[account(
        constraint = custody_oracle_account.key() == custody.oracle.oracle_account
    )]
    pub custody_oracle_account: AccountInfo<'info>,
    /// CHECK: Custody token account - validate as token account for CPI
    #[account(
        mut,
        seeds = [b"custody_token_account",
                 pool.key().as_ref(),
                 custody.mint.as_ref()],
        bump = custody.token_account_bump
    )]
    pub custody_token_account: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [b"lp_token_mint", pool.key().as_ref()],
        bump = pool.lp_token_bump
    )]
    pub lp_token_mint: Account<'info, Mint>,
    /// CHECK: Funding account - validate as token account for CPI
    #[account(
        mut,
        constraint = funding_account.mint == custody.mint,
        has_one = owner
    )]
    pub funding_account: Box<Account<'info, TokenAccount>>,
    /// CHECK: LP token account
    #[account(
        mut,
        constraint = lp_token_account.mint == lp_token_mint.key(),
        has_one = owner
    )]
    pub lp_token_account: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RemoveLiquidity<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: Transfer authority PDA
    #[account(
        seeds = [b"transfer_authority"],
        bump = perpetuals.transfer_authority_bump
    )]
    pub transfer_authority: AccountInfo<'info>,
    #[account(
        seeds = [b"perpetuals"],
        bump = perpetuals.perpetuals_bump
    )]
    pub perpetuals: Box<Account<'info, Perpetuals>>,
    #[account(mut)]
    pub pool: Account<'info, Pool>,
    #[account(mut)]
    pub custody: Account<'info, Custody>,
    /// CHECK: oracle account for the receiving token
    #[account(
        constraint = custody_oracle_account.key() == custody.oracle.oracle_account
    )]
    pub custody_oracle_account: AccountInfo<'info>,
    /// CHECK: Custody token account - validate as token account for CPI
    #[account(
        mut,
        seeds = [b"custody_token_account",
                 pool.key().as_ref(),
                 custody.mint.as_ref()],
        bump = custody.token_account_bump
    )]
    pub custody_token_account: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [b"lp_token_mint", pool.key().as_ref()],
        bump = pool.lp_token_bump
    )]
    pub lp_token_mint: Account<'info, Mint>,
    /// CHECK: LP token account
    #[account(
        mut,
        constraint = lp_token_account.mint == lp_token_mint.key(),
        has_one = owner
    )]
    pub lp_token_account: Box<Account<'info, TokenAccount>>,
    /// CHECK: Receiving account
    #[account(
        mut,
        constraint = receiving_account.mint == custody.mint,
        has_one = owner
    )]
    pub receiving_account: Box<Account<'info, TokenAccount>>,
    /// CHECK: Token program
    pub token_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Init<'info> {
    #[account(mut)]
    pub upgrade_authority: Signer<'info>,
    #[account(
        init,
        payer = upgrade_authority,
        space = 8 + std::mem::size_of::<Multisig>(),
        seeds = [b"multisig"],
        bump
    )]
    pub multisig: Account<'info, Multisig>,
    /// CHECK: Transfer authority PDA
    #[account(
        seeds = [b"transfer_authority"],
        bump
    )]
    pub transfer_authority: AccountInfo<'info>,
    #[account(
        init,
        payer = upgrade_authority,
        space = 8 + std::mem::size_of::<Perpetuals>() + 256,
        seeds = [b"perpetuals"],
        bump
    )]
    pub perpetuals: Account<'info, Perpetuals>,
    /// CHECK: Program data account
    pub perpetuals_program_data: AccountInfo<'info>,
    /// CHECK: Perpetuals program
    pub perpetuals_program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Token program
    pub token_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct AddPool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut)]
    pub multisig: Account<'info, Multisig>,
    /// CHECK: Transfer authority PDA
    #[account(
        seeds = [b"transfer_authority"],
        bump
    )]
    pub transfer_authority: AccountInfo<'info>,
    #[account(mut)]
    pub perpetuals: Account<'info, Perpetuals>,
    #[account(
        init,
        payer = admin,
        space = 8 + std::mem::size_of::<Pool>() + 512,
        seeds = [b"pool", perpetuals.pools.len().to_le_bytes().as_ref()],
        bump
    )]
    pub pool: Account<'info, Pool>,
    #[account(
        init_if_needed,
        payer = admin,
        mint::authority = transfer_authority,
        mint::freeze_authority = transfer_authority,
        mint::decimals = 6,
        seeds = [b"lp_token_mint", pool.key().as_ref()],
        bump
    )]
    pub lp_token_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
    /// CHECK: Token program
    pub token_program: AccountInfo<'info>,
    /// CHECK: Rent sysvar
    pub rent: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct RemovePool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut)]
    pub multisig: Account<'info, Multisig>,
    /// CHECK: Transfer authority PDA
    #[account(mut)]
    pub transfer_authority: AccountInfo<'info>,
    #[account(mut)]
    pub perpetuals: Account<'info, Perpetuals>,
    #[account(
        mut,
        close = admin
    )]
    pub pool: Account<'info, Pool>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AddCustody<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut)]
    pub multisig: Account<'info, Multisig>,
    /// CHECK: Transfer authority PDA
    #[account(
        seeds = [b"transfer_authority"],
        bump
    )]
    pub transfer_authority: AccountInfo<'info>,
    pub perpetuals: Account<'info, Perpetuals>,
    #[account(mut)]
    pub pool: Account<'info, Pool>,
    #[account(
        init,
        payer = admin,
        space = 8 + std::mem::size_of::<Custody>() + 256,
        seeds = [b"custody", pool.key().as_ref(), custody_token_mint.key().as_ref()],
        bump
    )]
    pub custody: Account<'info, Custody>,
    /// CHECK: Custody token account PDA
    #[account(
        init_if_needed,
        payer = admin,
        token::mint = custody_token_mint,
        token::authority = transfer_authority,
        seeds = [b"custody_token_account",
                 pool.key().as_ref(),
                 custody_token_mint.key().as_ref()],
        bump
    )]
    pub custody_token_account: Box<Account<'info, TokenAccount>>,
    /// CHECK: Custody token mint
    pub custody_token_mint: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    /// CHECK: Rent sysvar
    pub rent: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct RemoveCustody<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut)]
    pub multisig: Account<'info, Multisig>,
    /// CHECK: Transfer authority PDA
    #[account(mut)]
    pub transfer_authority: AccountInfo<'info>,
    pub perpetuals: Account<'info, Perpetuals>,
    #[account(mut)]
    pub pool: Account<'info, Pool>,
    #[account(
        mut,
        close = admin
    )]
    pub custody: Account<'info, Custody>,
    /// CHECK: Custody token account
    #[account(mut)]
    pub custody_token_account: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Token program
    pub token_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct SetAdminSigners<'info> {
    pub admin: Signer<'info>,
    #[account(mut)]
    pub multisig: Account<'info, Multisig>,
}

#[derive(Accounts)]
pub struct SetCustodyConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut)]
    pub multisig: Account<'info, Multisig>,
    #[account(mut)]
    pub pool: Account<'info, Pool>,
    #[account(mut)]
    pub custody: Account<'info, Custody>,
}

#[derive(Accounts)]
pub struct SetPermissions<'info> {
    pub admin: Signer<'info>,
    #[account(mut)]
    pub multisig: Account<'info, Multisig>,
    #[account(mut)]
    pub perpetuals: Account<'info, Perpetuals>,
}

#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: Transfer authority PDA
    pub transfer_authority: AccountInfo<'info>,
    #[account(mut)]
    pub custody: Account<'info, Custody>,
    /// CHECK: Custody token account
    pub custody_token_account: AccountInfo<'info>,
    /// CHECK: Receiving account
    pub receiving_account: AccountInfo<'info>,
    /// CHECK: Token program
    pub token_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct WithdrawSolFees<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut)]
    pub perpetuals: Account<'info, Perpetuals>,
    /// CHECK: Receiver account for SOL fees
    #[account(mut)]
    pub receiver: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct SetCustomOraclePrice<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + std::mem::size_of::<CustomOracle>(),
        seeds = [b"custom_oracle", custody.key().as_ref()],
        bump
    )]
    pub custom_oracle: Account<'info, CustomOracle>,
    pub custody: Account<'info, Custody>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetTestTime<'info> {
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpgradeCustody<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut)]
    pub custody: Account<'info, Custody>,
}

#[account]
#[derive(Default, Debug)]
pub struct CustomOracle {
    pub price: u64,
    pub expo: i32,
    pub conf: u64,
    pub ema: u64,
    pub publish_time: i64,
}

impl CustomOracle {
    pub fn set(&mut self, price: u64, expo: i32, conf: u64, ema: u64, publish_time: i64) {
        self.price = price;
        self.expo = expo;
        self.conf = conf;
        self.ema = ema;
        self.publish_time = publish_time;
    }
}

#[error_code]
pub enum ErrorCode {
    #[msg("The computation was aborted")]
    AbortedComputation,
    #[msg("Cluster not set")]
    ClusterNotSet,
    #[msg("Invalid position side")]
    InvalidPositionSide,
    #[msg("Insufficient collateral")]
    InsufficientCollateral,
    #[msg("Invalid position owner")]
    InvalidPositionOwner,
    #[msg("Position not liquidatable")]
    PositionNotLiquidatable,
    #[msg("Invalid input parameters")]
    InvalidInput,
    #[msg("Math overflow")]
    MathOverflow,
}
