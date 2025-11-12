# Quick Guide: Upload Circuits to GitHub Releases

## Step-by-Step Instructions

### 1. Create a GitHub Release

1. Go to your GitHub repository: https://github.com/MrSufferer/mgk-solana
2. Click on "Releases" (right sidebar)
3. Click "Create a new release"
4. Fill in:
   - **Tag**: `circuits-v1.0.0` (or any version)
   - **Title**: `Perpetuals DEX Circuits - Devnet`
   - **Description**: 
     ```
     Arcium encrypted circuits for Perpetuals DEX on Solana devnet.
     
     Circuits included:
     - open_position.arcis
     - calculate_position_value.arcis
     - close_position.arcis
     - add_collateral.arcis
     - remove_collateral.arcis
     - liquidate.arcis
     ```

### 2. Upload Circuit Files

1. Drag and drop all 6 `.arcis` files from your `build/` folder into the release assets section:
   - `build/open_position.arcis`
   - `build/calculate_position_value.arcis`
   - `build/close_position.arcis`
   - `build/add_collateral.arcis`
   - `build/remove_collateral.arcis`
   - `build/liquidate.arcis`

2. Click "Publish release"

### 3. Get the Direct Download URLs

After publishing, you'll see each file listed. Right-click on each filename and select "Copy link address".

The URLs will look like:
```
https://github.com/MrSufferer/mgk-solana/releases/download/circuits-v1.0.0/open_position.arcis
https://github.com/MrSufferer/mgk-solana/releases/download/circuits-v1.0.0/calculate_position_value.arcis
https://github.com/MrSufferer/mgk-solana/releases/download/circuits-v1.0.0/close_position.arcis
https://github.com/MrSufferer/mgk-solana/releases/download/circuits-v1.0.0/add_collateral.arcis
https://github.com/MrSufferer/mgk-solana/releases/download/circuits-v1.0.0/remove_collateral.arcis
https://github.com/MrSufferer/mgk-solana/releases/download/circuits-v1.0.0/liquidate.arcis
```

### 4. Update Your Rust Program

Open `programs/perpetuals/src/lib.rs` and find each init function. Replace the placeholder URLs with your actual GitHub URLs:

**Example for open_position:**
```rust
pub fn init_open_position_comp_def(ctx: Context<InitOpenPositionCompDef>) -> Result<()> {
    init_comp_def(
        ctx.accounts,
        0,
        Some(CircuitSource::OffChain(OffChainCircuitSource {
            source: "https://github.com/MrSufferer/mgk-solana/releases/download/circuits-v1.0.0/open_position.arcis".to_string(),
            hash: [0; 32],
        })),
        None,
    )?;
    Ok(())
}
```

Do this for all 6 functions!

### 5. Rebuild and Redeploy

```bash
# Build with the new URLs
arcium build

# Deploy to devnet
arcium deploy --cluster devnet
```

### 6. Test It!

```bash
arcium test
```

Your tests should now initialize the CompDefs in a single transaction each, and the Arcium network will fetch the circuits from GitHub automatically!

## Verification

After deployment, when you run the tests, you should see:
- ✅ Each init completes in 1 transaction (instead of 15-24)
- ✅ No SOL drainage from circuit uploads
- ✅ Fast initialization (<5 seconds per CompDef)

## Troubleshooting

**If you get "failed to fetch circuit":**
- Make sure the GitHub release is public
- Verify the URLs are correct (copy-paste from GitHub)
- Test the URL in your browser - it should download the file

**If you get build errors:**
- Make sure you have the imports: `use arcium_client::idl::arcium::types::{CallbackAccount, CircuitSource, OffChainCircuitSource};`
- Check that all 6 init functions are updated

## Alternative: Using Other Storage

If you prefer not to use GitHub:

**AWS S3:**
```bash
aws s3 cp build/open_position.arcis s3://your-bucket/circuits/ --acl public-read
```
Then use: `https://your-bucket.s3.amazonaws.com/circuits/open_position.arcis`

**Supabase Storage:**
1. Create a public bucket in Supabase
2. Upload files
3. Use the public URL provided

**IPFS:**
```bash
ipfs add build/open_position.arcis
```
Then use: `https://ipfs.io/ipfs/YOUR_HASH`

---

**Need help?** Check the main guide in `OFFCHAIN_CIRCUITS_SETUP.md`
