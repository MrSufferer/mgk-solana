# Shielded Pool Architecture: Privacy-Preserving Perpetuals DEX

## Executive Summary

This document describes the **commitment-based shielded pool** architecture for privacy-preserving perpetual trading. Unlike simple mixers (Tornado Cash), this design is adapted for perpetuals' unique requirements: stateful positions, dynamic updates, risk management, and pool liquidity provision. The system uses **Arcium MPC** for commitment validation and position aggregation, providing true unlinkability while maintaining trading functionality.

## Design Rationale: Why Shielded Pool for Perpetuals?

### The Challenge

Perpetuals trading has unique requirements that simple deposit/withdraw mixers cannot handle:

1. **Stateful Positions**: Positions exist over time, not one-time deposits
2. **Dynamic Updates**: Add collateral, close position, adjust leverage
3. **Risk Management**: Continuous risk checks, liquidations, margin requirements
4. **Pool Interaction**: Pool needs aggregate exposure for liquidity provision
5. **Funding/PnL**: Positions accrue funding and unrealized PnL over time

### The Solution: Commitment-Based Shielded Pool

**Key Innovation**: Use cryptographic commitments to break linkability while allowing position state updates.

- **Deposit**: Generate commitment hash `H(position_data, secret)` - no trader link
- **Updates**: Prove ownership via MPC, update position, generate new commitment
- **Withdrawal**: Prove ownership via MPC, compute final PnL, withdraw unlinkably
- **Aggregation**: MPC aggregates all commitments into net OI for pool

## Architecture Overview

### Core Concept: Commitment-Based Privacy

```mermaid
graph TB
    subgraph "Position Deposit"
        T1[Trader 1<br/>Deposit Position<br/>+100 BTC]
        T1 -->|Generate| C1[Commitment Hash<br/>H(pos1, secret1)]
        C1 -->|Store| TREE[Merkle Tree<br/>No trader link]
    end
    
    subgraph "Shielded Pool State"
        TREE -->|Commitments| AGG[MPC Aggregation<br/>Enc<Mxe, AggregatedState>]
        AGG -->|Net OI| NET[Net Position: +250 BTC<br/>Revealed to Pool]
        TREE -.->|No Link| NULL[Nullifier Set<br/>Spent Commitments]
    end
    
    subgraph "Position Update"
        T1 -->|Commitment + MPC Proof| VAL[MPC Validation<br/>Prove Ownership]
        VAL -->|Update| NEW[New Commitment<br/>H(updated_pos, secret1)]
        NEW -->|Store| TREE
        C1 -->|Nullify| NULL
    end
    
    subgraph "Pool Interaction"
        NET -->|Net Exposure| POOL[Liquidity Pool]
        POOL -->|Liquidity| AGG
    end
    
    subgraph "Withdrawal"
        T1 -->|Commitment + MPC Proof| WITHDRAW[MPC Withdrawal<br/>Compute PnL]
        WITHDRAW -->|Unlinkable| NEW_ADDR[New Address<br/>No link to deposit]
    end
```

### Key Difference from Simple Mixers

**Tornado Cash (Simple Mixer):**
- Deposit → Note → Withdraw (one-time)
- No state updates
- No risk management
- No pool interaction

**Our Shielded Pool (Adapted for Perpetuals):**
- Deposit → Commitment → Update → Update → Withdraw (stateful)
- Position state updates via new commitments
- MPC risk validation on encrypted positions
- Pool sees aggregate state for liquidity

## Architecture Components

### 1. Shielded Pool State

```rust
pub struct ShieldedPoolState {
    pub market_id: u16,
    
    // Commitment storage (no trader link)
    pub commitments: Vec<[u8; 32]>,  // Merkle tree or set of commitment hashes
    pub commitment_count: u32,
    
    // Nullifier set (spent commitments)
    pub nullifiers: Vec<[u8; 32]>,  // Set of nullified commitment hashes
    
    // Aggregated encrypted state (Enc<Mxe, AggregatedState>)
    pub aggregated_state_ciphertext: Vec<u8>,
    
    // Public aggregate metrics (revealed for transparency)
    pub net_open_interest: i64,      // Net long/short (revealed)
    pub total_collateral: u128,      // Total collateral (revealed)
    pub active_commitment_count: u32, // Active positions
    
    // Pool interaction
    pub pool: Pubkey,                // Reference to liquidity pool
    pub last_aggregation_slot: u64,
    pub aggregation_interval_slots: u64,  // Epoch duration
    
    // Market reference
    pub base_asset_mint: Pubkey,
    pub quote_asset_mint: Pubkey,
    
    pub bump: u8,
}
```

**Key Design**: No `position_registry` - this would break anonymity by linking traders to positions.

### 2. Commitment Generation

**Position Deposit:**
```rust
// Client-side: Generate commitment
let secret = generate_random_secret();
let position_data = encrypt_position(position);  // Enc<Shared, Position>
let commitment = hash(position_data, secret);     // H(enc_pos, secret)

// On-chain: Store commitment (no trader link)
shielded_pool.commitments.push(commitment);
```

**User Stores Off-Chain:**
- `secret`: Random secret for commitment
- `position_data`: Encrypted position data
- `commitment`: Commitment hash

### 3. Position Updates via MPC

**Update Flow:**
1. User provides: `commitment`, `secret`, `update_data`
2. MPC validates: Commitment exists and user knows secret
3. MPC updates: Encrypted position state
4. Generate new commitment: `H(updated_position, secret)`
5. Store new commitment, nullify old

**MPC Instruction:**
```rust
#[instruction]
pub fn update_committed_position(
    output_owner: Mxe,
    old_commitment: [u8; 32],
    secret: Enc<Shared, [u8; 32]>,  // Encrypted secret
    position_data: Enc<Shared, Position>,
    update_delta: Enc<Shared, PositionDelta>,
) -> (Enc<Mxe, [u8; 32]>, Enc<Mxe, Position>) {
    // 1. Validate commitment exists
    // 2. Prove user knows secret: H(position_data, secret) == old_commitment
    // 3. Update position: position_data + update_delta
    // 4. Generate new commitment: H(updated_position, secret)
    // 5. Return new commitment and updated position
}
```

### 4. Pool Aggregation via MPC

**Aggregation Flow:**
1. MPC reads all active commitments (not nullified)
2. MPC decrypts and aggregates positions
3. Computes net OI, total collateral
4. Returns encrypted aggregate state
5. Reveal aggregate metrics to pool

**MPC Instruction:**
```rust
#[instruction]
pub fn aggregate_committed_positions(
    output_owner: Mxe,
    commitments: [[u8; 32]; 1000],  // Active commitments
    commitment_count: u16,
    position_data: [Enc<Shared, Position>; 1000],  // Encrypted positions
) -> Enc<Mxe, AggregatedState> {
    // Aggregate all positions
    let mut net_long = 0i128;
    let mut net_short = 0i128;
    let mut total_collateral = 0u128;
    
    for i in 0..1000 {
        if i < commitment_count as usize {
            let pos = position_data[i].to_arcis();
            if pos.size > 0 {
                net_long += pos.size as i128;
            } else {
                net_short += (-pos.size) as i128;
            }
            total_collateral += pos.collateral as u128;
        }
    }
    
    let net_oi = net_long - net_short;
    
    AggregatedState {
        net_open_interest: net_oi as i64,
        total_collateral,
        position_count: commitment_count,
    }
}
```

### 5. Withdrawal via MPC Proof

**Withdrawal Flow:**
1. User provides: `commitment`, `secret`, `withdrawal_address`
2. MPC validates: Commitment exists and user knows secret
3. MPC computes: Final PnL, remaining collateral
4. MPC withdraws: Transfer to new address (unlinkable)
5. Nullify commitment: Mark as spent

**Unlinkability**: Withdrawal address has no on-chain link to deposit address.

## Privacy Guarantees

### What's Private

- **Individual Position Sizes**: Encrypted in commitments
- **Individual Position PnL**: Computed in MPC, never revealed
- **Trader-to-Position Linkage**: No on-chain link (commitments only)
- **Position Update History**: Each update generates new commitment
- **Withdrawal Linkage**: Cannot link withdrawal to deposit

### What's Public

- **Aggregate Net Open Interest**: Revealed for pool risk management
- **Aggregate Total Collateral**: Revealed for pool solvency
- **Number of Active Positions**: Revealed for transparency
- **Market Prices and Funding Rates**: Public market data
- **Commitment Hashes**: Public (but unlinkable to traders)

### Unlinkability Guarantees

1. **Deposit → Withdrawal**: Cannot link deposit address to withdrawal address
2. **Position Updates**: Cannot link updates to same trader (new commitment each time)
3. **Cross-Time Correlation**: Cannot correlate positions across time periods
4. **Pool Visibility**: Pool sees only aggregate, never individual positions

## Comparison: Shielded Pool vs Alternatives

| Aspect | Traditional Pool | Orderbook | Shielded Pool |
|--------|-----------------|-----------|---------------|
| **Liquidity** | ✅ Guaranteed | ❌ Requires counterparty | ✅ Guaranteed |
| **Privacy** | ❌ Positions visible | ✅ Encrypted sizes | ✅ True unlinkability |
| **State Updates** | ✅ Direct updates | ✅ Order updates | ✅ Commitment updates |
| **Risk Management** | ✅ On-chain checks | ⚠️ MPC checks | ✅ MPC checks |
| **Unlinkability** | ❌ Fully linkable | ⚠️ Partial (order sizes hidden) | ✅ True unlinkability |
| **Complexity** | Low | High | Medium |

## Implementation Status

### ✅ Completed (Current State)

- Basic `MixerPoolState` structure (needs redesign for commitments)
- `mix_positions` MPC instruction skeleton
- Solana program instruction framework

### 🚧 Needs Redesign

- **State Structure**: Remove `position_registry`, add commitment storage
- **Commitment System**: Implement commitment generation and validation
- **MPC Instructions**: 
  - `validate_commitment()` - Check commitment exists
  - `prove_commitment_ownership()` - Validate secret knowledge
  - `update_committed_position()` - Update position via commitment
  - `aggregate_committed_positions()` - Aggregate from commitments
  - `withdraw_committed_position()` - Withdraw via commitment proof
- **Nullifier System**: Track spent commitments
- **Merkle Tree**: Efficient commitment storage (if account limits allow)

### 🔮 Future Enhancements

- **Merkle Tree Optimization**: Efficient commitment proofs
- **Batch Updates**: Aggregate multiple position updates
- **Risk Validation**: MPC risk checks on committed positions
- **Liquidation Handling**: Liquidate positions via commitment proofs

## Key Design Decisions

### 1. Commitments vs Direct Encryption

**Choice**: Commitments (like Tornado Cash)
**Reason**: Breaks linkability - no on-chain link between trader and position
**Trade-off**: More complex than direct encryption, but provides true privacy

### 2. MPC vs ZK Proofs

**Choice**: MPC (Arcium)
**Reason**: 
- Can compute on encrypted position data
- Can validate risk constraints
- Can aggregate multiple positions
- No ZK circuit compilation needed

### 3. Commitment Storage

**Choice**: TBD - Merkle Tree vs Set
**Considerations**:
- Merkle Tree: Efficient proofs, but complex on Solana
- Set: Simple, but less efficient for large numbers
- Solana account limits: ~10KB per account

**Recommendation**: Start with set, optimize to Merkle tree if needed

### 4. Position Updates

**Choice**: Generate new commitment, nullify old
**Reason**: Maintains unlinkability while allowing state updates
**Alternative**: Update in-place (breaks unlinkability)

### 5. Pool Aggregation

**Choice**: MPC aggregates all commitments
**Reason**: Pool needs aggregate state but not individual positions
**Frequency**: Per epoch (configurable)

## Data Flow Examples

### Example 1: Position Deposit

```
1. Trader deposits 100 BTC long position
2. Client generates: secret = random(), commitment = H(enc_pos, secret)
3. On-chain: Store commitment (no trader link)
4. User stores: (secret, enc_pos, commitment) off-chain
5. Pool sees: New commitment added (no position details)
```

### Example 2: Add Collateral

```
1. Trader provides: commitment, secret, collateral_delta
2. MPC validates: commitment exists, H(enc_pos, secret) == commitment
3. MPC updates: enc_pos.collateral += collateral_delta
4. Generate: new_commitment = H(updated_enc_pos, secret)
5. On-chain: Store new_commitment, nullify old_commitment
6. Pool sees: Commitment updated (no position details)
```

### Example 3: Close Position

```
1. Trader provides: commitment, secret, withdrawal_address
2. MPC validates: commitment exists, user knows secret
3. MPC computes: final_pnl, remaining_collateral
4. MPC withdraws: Transfer to withdrawal_address (unlinkable)
5. On-chain: Nullify commitment
6. Pool sees: Commitment spent, aggregate updated
```

### Example 4: Pool Aggregation

```
1. Epoch boundary: Trigger aggregation
2. MPC reads: All active commitments (not nullified)
3. MPC aggregates: Sum all positions → net_oi, total_collateral
4. Reveal: Aggregate metrics to pool
5. Pool uses: Net OI for risk management, liquidity provision
```

## Arcium MPC Adaptation

### Why MPC Instead of ZK?

**ZK Proofs (Tornado Cash):**
- Prove commitment exists without revealing which one
- Prove user knows secret
- Cannot compute on encrypted data
- Requires circuit compilation

**MPC (Arcium):**
- Can validate commitment exists
- Can prove user knows secret
- **Can compute on encrypted position data** (key advantage)
- Can validate risk constraints
- Can aggregate positions
- No circuit compilation needed

### MPC Instructions Required

1. **`validate_commitment(commitment, commitments[])`**
   - Check if commitment exists in set
   - Return boolean (revealed)

2. **`prove_commitment_ownership(commitment, secret, position_data)`**
   - Validate: `H(position_data, secret) == commitment`
   - Return boolean (revealed)

3. **`update_committed_position(old_commitment, secret, position, delta)`**
   - Validate ownership
   - Update position
   - Generate new commitment
   - Return (new_commitment, updated_position)

4. **`aggregate_committed_positions(commitments[], positions[])`**
   - Aggregate all positions
   - Compute net OI, total collateral
   - Return aggregated state

5. **`withdraw_committed_position(commitment, secret, position)`**
   - Validate ownership
   - Compute final PnL
   - Return withdrawal amount

## Security Considerations

### Commitment Collision

**Risk**: Two different positions generate same commitment
**Mitigation**: Use 256-bit hashes (SHA-256), collision probability negligible

### Secret Leakage

**Risk**: User loses secret → cannot update/withdraw position
**Mitigation**: User responsibility (like private keys), consider backup mechanisms

### Nullifier Replay

**Risk**: Reuse nullified commitment
**Mitigation**: Check nullifier set before processing

### MPC Trust

**Risk**: MPC nodes could collude
**Mitigation**: Arcium's MPC uses threshold cryptography, requires majority consensus

## Related Documents

- [ORDERBOOK_ARCHITECTURE.md](./ORDERBOOK_ARCHITECTURE.md) - Alternative orderbook matching system
- [ARCIUM_PRIVATE_PERPS_ARCHITECTURE.md](./ARCIUM_PRIVATE_PERPS_ARCHITECTURE.md) - Original architecture specification

## References

- **Tornado Cash**: Commitment-based privacy model (reference, not template)
- **COMMON Protocol**: Shielded pool + order book integration
- **Arcium MPC**: Multi-party computation for encrypted operations
- **Confidential SPL Token**: Encrypted balance management (simulated)
