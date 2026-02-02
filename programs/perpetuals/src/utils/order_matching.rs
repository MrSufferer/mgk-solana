use anchor_lang::prelude::*;

/// Order matching utilities
/// 
/// Helper functions for order matching operations

/// Calculate the current epoch ID based on slot and epoch duration
pub fn get_current_epoch_id(
    current_slot: u64,
    epoch_start_slot: u64,
    epoch_duration_slots: u64,
) -> u64 {
    if current_slot < epoch_start_slot {
        return 0;
    }
    (current_slot - epoch_start_slot) / epoch_duration_slots
}

/// Calculate the start slot for a given epoch
pub fn get_epoch_start_slot(
    epoch_id: u64,
    base_start_slot: u64,
    epoch_duration_slots: u64,
) -> u64 {
    base_start_slot + (epoch_id * epoch_duration_slots)
}

/// Calculate the end slot for a given epoch
pub fn get_epoch_end_slot(
    epoch_id: u64,
    base_start_slot: u64,
    epoch_duration_slots: u64,
) -> u64 {
    get_epoch_start_slot(epoch_id, base_start_slot, epoch_duration_slots) + epoch_duration_slots
}

/// Validate that a price is within valid bounds and respects tick size
pub fn validate_price(
    price: u64,
    tick_size: u64,
    min_price: Option<u64>,
    max_price: Option<u64>,
) -> Result<()> {
    require!(price > 0, ErrorCode::InvalidPrice);
    require!(price % tick_size == 0, ErrorCode::InvalidPrice);
    
    if let Some(min) = min_price {
        require!(price >= min, ErrorCode::InvalidPrice);
    }
    
    if let Some(max) = max_price {
        require!(price <= max, ErrorCode::InvalidPrice);
    }
    
    Ok(())
}

/// Validate order size is within bounds
pub fn validate_order_size(
    size: u64,
    min_order_size: u64,
    max_order_size: u64,
) -> Result<()> {
    require!(size >= min_order_size, ErrorCode::InvalidOrderSize);
    require!(size <= max_order_size, ErrorCode::InvalidOrderSize);
    Ok(())
}

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid price")]
    InvalidPrice,
    #[msg("Invalid order size")]
    InvalidOrderSize,
}

