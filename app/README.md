# Arcium Perpetuals CLI

Command-line interface for managing the Arcium Perpetuals DEX program.

## Installation

```bash
cd app
npm install
npm install -g npx
```

## Usage

All commands follow this pattern:

```bash
npx ts-node src/cli.ts [options] <command> [arguments]
```

### Global Options

- `-u, --cluster-url <string>` - Cluster URL (default: http://localhost:8899)
- `-k, --keypair <path>` - Admin keypair path (default: ~/.config/solana/id.json)

### Initialization Flow

#### 1. Initialize Program

```bash
npx ts-node src/cli.ts -k <ADMIN_WALLET> init --min-signatures <int> <ADMIN_PUBKEY1> <ADMIN_PUBKEY2> ...
```

Example:
```bash
npx ts-node src/cli.ts -k ~/.config/solana/id.json init --min-signatures 1 $(solana address)
```

#### 2. Verify Initialization

```bash
npx ts-node src/cli.ts -k <ADMIN_WALLET> get-multisig
npx ts-node src/cli.ts -k <ADMIN_WALLET> get-perpetuals
```

#### 3. Add Trading Pool

```bash
npx ts-node src/cli.ts -k <ADMIN_WALLET> add-pool <POOL_NAME>
```

Example:
```bash
npx ts-node src/cli.ts -k ~/.config/solana/id.json add-pool TestPool1
```

#### 4. Add Token Custody

```bash
npx ts-node src/cli.ts -k <ADMIN_WALLET> add-custody [-s] [-v] [-t <oracle-type>] <POOL_NAME> <TOKEN_MINT> <ORACLE_ACCOUNT>
```

Flags:
- `-s, --stable` - Mark as stablecoin
- `-v, --virtual` - Create virtual/synthetic custody
- `-t, --oracle-type <type>` - Oracle type: `custom`, `pyth`, or `none` (default: custom)

Example with SOL:
```bash
npx ts-node src/cli.ts -k ~/.config/solana/id.json add-custody TestPool1 So11111111111111111111111111111111111111112 J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix
```

Example with stablecoin (USDC):
```bash
npx ts-node src/cli.ts -k ~/.config/solana/id.json add-custody -s TestPool1 EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 5SSkXsEKQepHHAewytPVwdej4epN1nxgLVM84L4KXgy7
```

#### 5. Set Oracle Price (for testing with custom oracle)

```bash
npx ts-node src/cli.ts -k <ADMIN_WALLET> set-oracle-price <POOL_NAME> <TOKEN_MINT> <PRICE>
```

Example (set SOL price to $50):
```bash
npx ts-node src/cli.ts -k ~/.config/solana/id.json set-oracle-price TestPool1 So11111111111111111111111111111111111111112 50000000
```

Note: Price should be in the token's native precision. With default exponent of -8, multiply by 10^8 (e.g., $50 = 50,000,000).

## Command Reference

### Program Management

```bash
# Get program state
get-multisig              # View multisig configuration
get-perpetuals            # View global perpetuals state

# Update admin settings
set-authority <pubkeys...> --min-signatures <int>
```

### Pool Management

```bash
# Pool operations
add-pool <pool-name>                    # Create new pool
remove-pool <pool-name>                 # Remove pool
get-pool <pool-name>                    # View pool details
get-pools                               # List all pools
get-lp-token-mint <pool-name>           # Get LP token mint address
```

### Custody Management

```bash
# Custody operations
add-custody <pool> <mint> <oracle> [-s] [-v] [-t <type>]
remove-custody <pool> <mint>
get-custody <pool> <mint>
get-custodies <pool>
upgrade-custody <pool> <mint>
```

### Oracle Management

```bash
# Oracle operations
set-oracle-price <pool> <mint> <price> [--expo <int>] [--conf <int>]
get-oracle-price <pool> <mint> [--ema]
get-oracle-account <pool> <mint>
```

### View Functions

```bash
# Calculate fees and amounts
get-add-liquidity-fee <pool> <mint> <amount>
get-remove-liquidity-fee <pool> <mint> <lp-amount>
```

## Configuration

### Default Settings

The CLI uses production-ready defaults from the original perpetuals program:

**Oracle Config:**
- Max price error: 1%
- Max price age: 60 seconds
- Permissionless oracle updates by default

**Pricing:**
- Trade spread: 0.01% (1 basis point)
- Swap spread: 0.02%
- Leverage range: 1x - 100x
- Max utilization: 100%

**Fees:**
- Mode: Linear
- Swap/Liquidity fees: 0.01%
- Position open/close: 0.01%
- Liquidation fee: 0.01%
- Protocol share: 10%

**Token Ratios:**
- Automatically balanced when adding custodies
- Equal target allocation for all tokens in pool

### Customizing Configuration

To use different configurations, modify the default values in `src/cli.ts` in the `addCustody()` function.

## Examples

### Complete Setup Flow (Localhost)

```bash
# 1. Initialize program
npx ts-node src/cli.ts init --min-signatures 1 $(solana address)

# 2. Create pool
npx ts-node src/cli.ts add-pool MainPool

# 3. Add SOL custody
npx ts-node src/cli.ts add-custody MainPool So11111111111111111111111111111111111111112 J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix

# 4. Add USDC custody (stablecoin)
npx ts-node src/cli.ts add-custody -s MainPool EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 5SSkXsEKQepHHAewytPVwdej4epN1nxgLVM84L4KXgy7

# 5. Set test prices
npx ts-node src/cli.ts set-oracle-price MainPool So11111111111111111111111111111111111111112 50000000
npx ts-node src/cli.ts set-oracle-price MainPool EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 100000000

# 6. Verify setup
npx ts-node src/cli.ts get-pool MainPool
npx ts-node src/cli.ts get-custodies MainPool
```

### Devnet Deployment

```bash
# Use -u flag for devnet
npx ts-node src/cli.ts -u https://api.devnet.solana.com -k ~/.config/solana/devnet.json init --min-signatures 2 <ADMIN1> <ADMIN2>

# Continue with pool and custody setup
npx ts-node src/cli.ts -u https://api.devnet.solana.com -k ~/.config/solana/devnet.json add-pool DevnetPool
```

### Mainnet Deployment

```bash
# Use -u flag for mainnet (IMPORTANT: Use multisig!)
npx ts-node src/cli.ts -u https://api.mainnet-beta.solana.com -k ~/.config/solana/mainnet.json init --min-signatures 3 <ADMIN1> <ADMIN2> <ADMIN3>
```

**⚠️ Important:** For mainnet deployments:
- Use at least 3 admin signers with `--min-signatures 3`
- Use hardware wallets for admin keys
- Test thoroughly on devnet first
- Double-check all oracle addresses (use real Pyth oracles, not custom)

## Troubleshooting

### "Account not found" Error

Make sure you've initialized the program first:
```bash
npx ts-node src/cli.ts init --min-signatures 1 $(solana address)
```

### "Insufficient funds" Error

Airdrop SOL to your wallet (localnet/devnet only):
```bash
solana airdrop 10
```

### Oracle Price Not Updating

If using custom oracle, you must set prices manually:
```bash
npx ts-node src/cli.ts set-oracle-price <pool> <mint> <price>
```

For production, use Pyth oracles with `-t pyth` flag when adding custody.

## Development

### Build from TypeScript

```bash
npm run cli -- <command>
```

### Add New Commands

1. Add function in `src/client.ts` (if needed)
2. Add command handler in `src/cli.ts`
3. Follow the existing pattern for argument parsing

## Support

For issues or questions:
- Open an issue on GitHub
- Check the main README in the project root
- Review the original perpetuals CLI for comparison

## License

MIT
