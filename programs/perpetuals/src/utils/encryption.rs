use anchor_lang::prelude::*;

/// Encryption utilities for order matching
/// 
/// Helper functions for encryption/decryption operations

/// Serialize data for encryption
pub fn serialize_for_encryption<T: anchor_lang::AnchorSerialize>(
    data: &T,
) -> Result<Vec<u8>> {
    let mut buf = Vec::new();
    data.serialize(&mut anchor_lang::__private::ser::Serializer::new(&mut buf))?;
    Ok(buf)
}

/// Deserialize data from decryption
pub fn deserialize_from_decryption<T: anchor_lang::AnchorDeserialize>(
    data: &[u8],
) -> Result<T> {
    let mut cursor = std::io::Cursor::new(data);
    T::deserialize(&mut anchor_lang::__private::de::Deserializer::new(
        &mut cursor,
        anchor_lang::__private::de::Bincode,
    ))
    .map_err(|e| anchor_lang::error::ErrorCode::from(e))
}

/// Helper to convert u64 to encrypted format (placeholder)
/// In real implementation, this would encrypt with MXE public key
pub fn prepare_encrypted_u64(value: u64) -> Vec<u8> {
    // In simulation: Just serialize the value
    // In real implementation: Encrypt with MXE public key
    value.to_le_bytes().to_vec()
}

/// Helper to extract u64 from encrypted format (placeholder)
/// In real implementation, this would decrypt with MXE secret key
pub fn extract_u64_from_encrypted(data: &[u8]) -> Result<u64> {
    if data.len() < 8 {
        return Err(anchor_lang::error::ErrorCode::ConstraintRaw.into());
    }
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&data[..8]);
    Ok(u64::from_le_bytes(bytes))
}

