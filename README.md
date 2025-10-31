# Encrypted Perpetuals DEX
Arcium program built for perpetuals dex

## 🚀 Quick Start

```bash
# 1. Build and deploy
arcium build
arcium deploy

# 2. Initialize program
cd app
npm install
npx ts-node src/cli.ts init --min-signatures 1 $(solana address)

# 3. Create pool and add custodies
npx ts-node src/cli.ts add-pool MainPool
npx ts-node src/cli.ts add-custody MainPool <TOKEN_MINT> <ORACLE>

# 4. Set test prices (for custom oracles)
npx ts-node src/cli.ts set-oracle-price MainPool <TOKEN_MINT> 50000000

# 5. Run tests
cd ..
arcium test
```

---

## 🏗️ Architecture

### Encrypted Operations (Privacy-Critical)

These operations use Arcium MPC to keep sensitive data private:

1. **Open Position** - Encrypt position size and collateral
2. **Close Position** - Calculate PnL confidentially
3. **Add/Remove Collateral** - Adjust positions privately
4. **Liquidate** - Check underwater positions without revealing balances
5. **Calculate Position Value** - Internal PnL computation

### Public Operations (Standard DeFi)

These operations work like traditional DeFi protocols:

1. **Swap** - Token swaps with fee calculation
2. **Add/Remove Liquidity** - LP token minting/burning
3. **View Functions** - Fee calculations, oracle prices, liquidation state

### Program Structure

```
programs/blackjack/
├── src/
│   ├── lib.rs           # Main program (33 instructions)
│   ├── state.rs         # Account structures
│   └── errors.rs        # Error codes

encrypted-ixs/
├── src/
│   └── lib.rs           # Encrypted MPC circuits

app/
├── src/
│   ├── cli.ts           # CLI commands (19 commands)
│   ├── client.ts        # PerpetualsClient class
│   └── types.ts         # Type definitions

tests/
├── helpers/
│   └── TestClient.ts    # Test utilities
└── *.ts                 # Integration tests
```

---

## 🧪 Testing

**Current Test Status**: 12/15 passing (80%)

```bash
# Run all tests
arcium test

# Run specific test
arcium test tests/open-position.ts
```

---

## 🛠️ CLI Commands

### Program Management
```bash
init                      # Initialize program
get-perpetuals           # View global state
get-multisig             # View multisig config
set-authority            # Update admins
```

### Pool Management
```bash
add-pool <name>          # Create trading pool
remove-pool <name>       # Remove pool
get-pool <name>          # View pool details
get-pools                # List all pools
```

### Custody Management
```bash
add-custody <pool> <mint> <oracle>    # Add token
remove-custody <pool> <mint>          # Remove token
get-custody <pool> <mint>             # View custody
get-custodies <pool>                  # List custodies
```

### Oracle Management
```bash
set-oracle-price <pool> <mint> <price>   # Set test price
get-oracle-price <pool> <mint>           # Get current price
get-oracle-account <pool> <mint>         # Get oracle PDA
```

See [app/README.md](app/README.md) for complete command reference.

---

## 📈 Default Configurations

Production-ready settings copied from original perpetuals:

- **Trade Spreads**: 0.01% (1 basis point)
- **Swap Spread**: 0.02%
- **Leverage Range**: 1x - 100x
- **Fees**: 0.01% (10% protocol share)
- **Oracle**: 1% max error, 60s max age
- **Utilization**: 100% max
- **Liquidation**: 5% maintenance margin

---

## 📄 License

Apache 2.0

---