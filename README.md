# Arcium Private Perpetuals DEX

Privacy-preserving perpetual futures DEX on Solana using **Arcium MPC** for encrypted computations. Enables traders to hide position sizes and collateral while maintaining guaranteed liquidity.

## Architecture

**Peer-to-Mixer-Pool Design:**
- Encrypted position aggregation via MPC
- Pool-based liquidity (sees only aggregated net OI)
- Individual positions remain private

We explored multiple approaches before settling on mixer pool. See architecture docs for details.

**Documentation:**
- [MIXER_POOL_ARCHITECTURE.md](./MIXER_POOL_ARCHITECTURE.md) - Chosen architecture
- [ORDERBOOK_ARCHITECTURE.md](./ORDERBOOK_ARCHITECTURE.md) - Orderbook matching system (in development)
- [ARCIUM_PRIVATE_PERPS_ARCHITECTURE.md](./ARCIUM_PRIVATE_PERPS_ARCHITECTURE.md) - Original spec

## Quick Start

```bash
# Build and deploy
arcium build
arcium deploy

# Initialize program
cd app && npm install
npx ts-node src/cli.ts init --min-signatures 1 $(solana address)

# Create pool and add custodies
npx ts-node src/cli.ts add-pool MainPool
npx ts-node src/cli.ts add-custody MainPool <TOKEN_MINT> <ORACLE>

# Set test prices
npx ts-node src/cli.ts set-oracle-price MainPool <TOKEN_MINT> 50000000

# Run tests
cd .. && arcium test
```

## Status

**Completed:**
- Core pool system with encrypted positions
- Mixer pool architecture and MPC instructions
- Orderbook matching framework (incomplete)
- Solana program with both systems

**In Progress:**
- MPC circuit deployment (`mix_positions.arcis`)
- Client-side encryption utilities
- Full pool integration
- Orderbook matching algorithm implementation

**Future:**
- Multi-market shielded pools support
- Separate Orderbook Perps product

## Development

```
programs/perpetuals/  # Solana program (Anchor)
encrypted-ixs/        # Arcium MPC circuits (Arcis)
app/                  # CLI and client SDK
tests/                # Integration tests
```

## License

Apache 2.0
