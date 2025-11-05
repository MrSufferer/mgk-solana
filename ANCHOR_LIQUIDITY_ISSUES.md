# Anchor v0.31.1 Liquidity Provision Issues

## Current Status

**UNRESOLVED** - All attempts to fix the `addLiquidity` instruction have failed. The issue persists with Anchor v0.31.1 when using `.transaction()` or `.instruction()` instead of `.rpc()`. The problem may be in the Rust program's `add_liquidity` function implementation rather than the client code.

## Issues Encountered

### Issue 1: Missing `token_program` Account
- **Symptom**: `InvalidProgramId` error (code 3008)
- **Cause**: Anchor v0.31.1 doesn't include `Program` accounts (like `token_program`) in instruction keys when using `.transaction()` or `.instruction()`
- **Error**: `Left: H3Rzi22wdH9c5Tb8AwsVhUYHT1SxbEr4Zn618Zb6ZnrC` (custody address) vs `Right: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` (expected token_program)
- **Status**: **PERSISTENT** - Still occurs even after multiple fix attempts

### Issue 2: Writable Flags Not Set
- **Symptom**: `ConstraintMut` error (code 2000) for accounts that need to be writable
- **Affected Accounts**:
  - `lp_token_mint` (position 6) - needs to be writable for `mint_to` CPI
  - `lp_token_account` (position 8) - needs to be writable to receive LP tokens
  - `custody_token_account` (position 5) - needs to be writable to receive tokens
  - `funding_account` (position 7) - needs to be writable for transfer CPI
- **Cause**: Anchor doesn't mark accounts as writable when they're modified via CPI calls
- **Status**: **PERSISTENT** - Still occurs even after manual flag fixes

### Issue 3: InvalidAccountData After Manual Fixes
- **Symptom**: `InvalidAccountData` error during Transfer CPI call
- **Error Log**: 
  ```
  Program log: Instruction: Transfer
  Program log: Error: InvalidAccountData
  Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA failed: invalid account data for instruction
  ```
- **Cause**: Manually modifying instruction keys breaks Anchor's instruction data encoding/validation
- **Status**: **BLOCKING** - Manual fixes break instruction data validation

## Attempted Fixes

### Attempt 1: Manual Instruction Key Modification
- **Approach**: Manually inserted `token_program` at position 9 and set writable flags for CPI-modified accounts
- **Result**: `InvalidAccountData` error during CPI transfer call
- **Reason**: Anchor encodes account metadata in instruction data. Modifying keys without updating data breaks validation

### Attempt 2: Using `.instruction()` with Manual Transaction Building
- **Approach**: Used `.instruction()` to get the instruction, then manually built transaction with corrected accounts
- **Result**: `InvalidProgramId` error (code 3008) - `token_program` still missing
- **Reason**: Anchor's `.instruction()` also doesn't include Program accounts

### Attempt 3: Using `.rpc()` Instead of `.transaction()`
- **Approach**: Switched to `.rpc()` to match the CLI client pattern
- **Result**: `InvalidProgramId` error (code 3008) - `token_program` still missing
- **Reason**: `.rpc()` also fails with wallet adapter, or the issue is deeper

### Attempt 4: Using `.accountsPartial()` Instead of `.accounts()`
- **Approach**: Switched from `.accounts()` to `.accountsPartial()` to match CLI pattern
- **Result**: `InvalidProgramId` error (code 3008) - `token_program` still missing
- **Reason**: No difference between `.accounts()` and `.accountsPartial()` for Program accounts

### Attempt 5: Manual Instruction Rebuilding with Anchor Coder
- **Approach**: Used `program.coder.instruction.encode()` to rebuild instruction with correct accounts
- **Result**: TypeScript compilation issues, then `InvalidProgramId` error
- **Reason**: `program.coder.instruction.encode()` only encodes parameters, not account metadata

### Attempt 6: Final Attempt - Manual Account Meta Fixes
- **Approach**: Get instruction from Anchor, manually fix account metas (add `token_program`, set writable flags), rebuild instruction with original data
- **Result**: `InvalidProgramId` error (code 3008) - persists
- **Reason**: Modifying account metas without updating instruction data breaks Anchor's validation

## Root Cause Analysis

Anchor v0.31.1 encodes account metadata (writable flags, account order, Program accounts) into the instruction data. When we manually modify the instruction keys after Anchor generates the instruction, the instruction data still contains the original account encoding, causing validation to fail.

**Key Finding**: The problem persists even when:
1. Using `.rpc()` instead of `.transaction()`
2. Using `.accounts()` with explicit `tokenProgram: TOKEN_PROGRAM_ID`
3. Using `.accountsPartial()` to let Anchor infer accounts
4. Manually rebuilding instructions with correct account metas

This suggests the issue may be in the Rust program's `add_liquidity` function or how Anchor v0.31.1 handles Program accounts in general.

## Current Implementation State

### Client Code (`ui/src/actions/changeLiquidity.ts`)
- Uses `.accounts()` with explicit `tokenProgram: TOKEN_PROGRAM_ID`
- Gets instruction via `.instruction()`
- Manually checks if `token_program` is missing and adds it at position 9
- Manually sets writable flags for CPI-modified accounts (`custody_token_account`, `lp_token_mint`, `funding_account`, `lp_token_account`)
- Rebuilds instruction with modified account metas but original instruction data
- Builds transaction manually with pre/post instructions

### Rust Program (`programs/blackjack/src/lib.rs`)
- `AddLiquidity` struct includes `token_program: Program<'info, Token>` at position 9
- `add_liquidity` function uses `ctx.accounts.token_program.key()` in CPI calls
- CPI calls use `invoke()` and `invoke_signed()` with account info arrays

## Account Order Expected (from Rust Program)

For `addLiquidity` instruction:
- Position 0: `owner` (writable, signer)
- Position 1: `transfer_authority` (readonly, CHECK)
- Position 2: `perpetuals` (readonly)
- Position 3: `pool` (writable)
- Position 4: `custody` (writable)
- Position 5: `custody_token_account` (readonly, CHECK) - but needs writable for CPI
- Position 6: `lp_token_mint` (writable, seeds)
- Position 7: `funding_account` (readonly, CHECK) - but needs writable for CPI
- Position 8: `lp_token_account` (readonly, CHECK) - but needs writable for CPI
- Position 9: `token_program` (readonly, Program) - **MISSING when using .transaction()/.instruction()**
- Position 10+: `remainingAccounts` (custody metas)

## Potential Root Cause

The issue may be in the Rust program's `add_liquidity` function:
1. The `AddLiquidity` struct uses `Program<'info, Token>` for `token_program`, which Anchor may not handle correctly in v0.31.1
2. The CPI calls use `AccountInfo` arrays that may not match Anchor's expected account order
3. The account constraints (CHECK attributes) may not match what Anchor expects

## Next Steps (Investigation Required)

1. **Review Rust Program's `add_liquidity` Function**
   - Check if `Program<'info, Token>` is the correct type for `token_program`
   - Verify account order matches Anchor's expectations
   - Check if CPI account arrays match the instruction account order

2. **Compare with Working Instructions**
   - Review `openPosition` which works with `.transaction()`
   - Check how it handles `tokenProgram` and Program accounts
   - Compare account structures and CPI calls

3. **Check Anchor v0.31.1 Documentation**
   - Look for breaking changes in Program account handling
   - Check if there's a different way to specify Program accounts
   - Review CPI account requirements

4. **Test with Anchor v0.30 or v0.32**
   - Verify if issue is specific to v0.31.1
   - Check if upgrading/downgrading resolves the issue

5. **Review CLI Client Implementation**
   - Check why `.rpc()` works in CLI but not in UI
   - Compare provider setup between CLI and UI
   - Check if there are differences in how wallet adapter is used

## Related Files

- `ui/src/actions/changeLiquidity.ts` - Current implementation (attempts manual fixes)
- `programs/blackjack/src/lib.rs` - Rust program with `add_liquidity` instruction (lines 1700-1786)
- `app/src/client.ts` - CLI client that uses `.rpc()` successfully
- `ui/src/actions/openPosition.ts` - Working example using `.transaction()` with `tokenProgram`

