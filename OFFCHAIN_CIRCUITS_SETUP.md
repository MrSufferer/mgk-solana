# Offchain Circuit Storage Setup

## ✅ What's Been Done

1. **Updated Rust Program**: All 6 computation definition init functions in `programs/perpetuals/src/lib.rs` now use offchain circuit storage instead of uploading circuits on-chain
2. **Simplified Tests**: Removed all circuit upload and finalization logic from `tests/perpetuals.ts` - tests now just call the init method
3. **Added Imports**: Added `CircuitSource` and `OffChainCircuitSource` types to the Rust imports

### Modified Functions:
- ✅ `init_open_position_comp_def`
- ✅ `init_calculate_position_value_comp_def`
- ✅ `init_close_position_comp_def`
- ✅ `init_add_collateral_comp_def`
- ✅ `init_remove_collateral_comp_def`
- ✅ `init_liquidate_comp_def`

## 🚀 Next Steps (What YOU Need to Do)

### 1. Upload Your Circuit Files to Public Storage

You need to upload these 6 circuit files from the `build/` directory to a public storage service:

**Files to upload:**
- `open_position.arcis`
- `calculate_position_value.arcis`
- `close_position.arcis`
- `add_collateral.arcis`
- `remove_collateral.arcis` 
- `liquidate.arcis`

**Storage Options:**
- **IPFS** (decentralized, recommended for production)
- **AWS S3** (with public read access)
- **Supabase Storage** (easy to set up)
- **GitHub Releases** (simple for testing) ⭐ **EASIEST FOR DEVNET TESTING**
- **Any CDN or public file hosting**

**Important:** Files must be publicly accessible without authentication!

### 2. Update the URLs in lib.rs

Once uploaded, replace the placeholder URLs in `programs/perpetuals/src/lib.rs`:

**Current placeholders:**
```rust
"https://your-storage.com/circuits/open_position_devnet.arcis"
"https://your-storage.com/circuits/calculate_position_value_devnet.arcis"
"https://your-storage.com/circuits/close_position_devnet.arcis"
"https://your-storage.com/circuits/add_collateral_devnet.arcis"
"https://your-storage.com/circuits/remove_collateral_devnet.arcis"
"https://your-storage.com/circuits/liquidate_devnet.arcis"
```

Replace with your actual URLs, for example:
```rust
"https://your-bucket.s3.amazonaws.com/open_position.arcis"
```

### 3. Rebuild and Deploy

After updating the URLs:

```bash
# Rebuild the program with updated circuit URLs
arcium build

# Deploy to devnet
arcium deploy --cluster devnet
```

### 4. Run Tests

Once deployed, run your tests:

```bash
arcium test
```

The tests are now simplified - they just initialize the CompDef and the Arcium network will fetch the circuits from your URLs automatically!

## 📝 Example: Using GitHub Releases (RECOMMENDED FOR DEVNET)

Quick way to test this:

1. Create a new release in your GitHub repo
2. Attach the 6 `.arcis` files as release assets
3. Get the direct download URLs (right-click asset → copy link)
4. Use those URLs in your init functions

**Example URL format:**
```
https://github.com/MrSufferer/mgk-solana/releases/download/v1.0.0/open_position.arcis
```

**To get the URL:**
1. Go to your GitHub repo
2. Click "Releases" → "Create a new release"
3. Tag: `v1.0.0` (or whatever version)
4. Upload all 6 `.arcis` files
5. Publish release
6. Right-click each file → Copy link address
7. Paste those URLs into `lib.rs`

## ✨ Benefits

✅ **Massive cost savings** - no more expensive on-chain circuit uploads  
✅ **Single transaction** - init happens in one tx instead of 15-24 transactions  
✅ **Supports large circuits** - no file size limitations  
✅ **Faster testing** - no waiting for multi-transaction uploads  
✅ **No SOL drainage** - circuit uploads were costing you lamports  

## 📌 Note on Hash Verification

The `hash: [0; 32]` is fine for now - Arcium doesn't enforce hash verification yet. In the future, you might want to compute the actual circuit hash for additional security.

## 🎯 Summary

**What changed:**
- Rust program now points to offchain URLs
- Tests are simplified (no more upload/finalize)
- Circuits will be fetched from your storage automatically

**What you need to do:**
1. Upload 6 circuit files to public storage (GitHub Releases is easiest)
2. Update URLs in `lib.rs`
3. Run `arcium build && arcium deploy --cluster devnet`
4. Run `arcium test`

That's it! No more SOL drainage or complex upload logic. 🎉
