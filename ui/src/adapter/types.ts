/**
 * Type definitions for Perpetuals DEX Adapter
 * 
 * This file defines the interfaces between the original perpetuals UI
 * and our encrypted MPC-based implementation.
 */

import { PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

// ============================================================================
// Original Perpetuals Types (what the UI expects)
// ============================================================================

export interface OriginalPosition {
  owner: PublicKey;
  pool: PublicKey;
  custody: PublicKey;
  collateralCustody: PublicKey;
  openTime: anchor.BN;
  updateTime: anchor.BN;
  side: PositionSide;
  price: anchor.BN;              // Entry price (public)
  sizeUsd: anchor.BN;            // Position size in USD (public)
  borrowSizeUsd: anchor.BN;      // Borrowed amount (public)
  collateralUsd: anchor.BN;      // Collateral in USD (public)
  unrealizedProfitUsd: anchor.BN;
  unrealizedLossUsd: anchor.BN;
  cumulativeInterestSnapshot: anchor.BN;
  lockedAmount: anchor.BN;
  collateralAmount: anchor.BN;
  bump: number;
}

// ============================================================================
// Encrypted Position Types (what our program uses)
// ============================================================================

export interface EncryptedPosition {
  owner: PublicKey;
  positionId: anchor.BN;
  side: PositionSide;
  sizeUsdEncrypted: number[];        // 32-byte encrypted array
  collateralUsdEncrypted: number[];  // 32-byte encrypted array
  entryPrice: anchor.BN;
  openTime: anchor.BN;
  updateTime: anchor.BN;
  ownerEncPubkey: number[];          // 32-byte MPC pubkey
  sizeNonce: anchor.BN;              // u128 nonce for size
  collateralNonce: anchor.BN;        // u128 nonce for collateral
  liquidator: PublicKey;
  bump: number;
}

// ============================================================================
// Position Side Enum
// ============================================================================

export enum PositionSide {
  None = 0,
  Long = 1,
  Short = 2,
}

// ============================================================================
// Trading Parameters
// ============================================================================

export interface OpenPositionParams {
  price: anchor.BN;          // Entry price
  collateral: anchor.BN;     // Collateral amount in USD
  size: anchor.BN;           // Position size in USD
  side: PositionSide;        // Long or Short
  pool?: PublicKey;          // Optional pool override
  custody?: PublicKey;       // Optional custody override
  collateralCustody?: PublicKey; // Optional collateral custody override
  fundingAccount?: PublicKey;    // Token account for collateral (required for public mode)
}

export interface ClosePositionParams {
  positionKey: PublicKey;    // Position account to close
  price?: anchor.BN;         // Optional exit price (defaults to oracle)
}

export interface AddCollateralParams {
  positionKey: PublicKey;    // Position account
  collateral: anchor.BN;     // Additional collateral to add
  fundingAccount?: PublicKey; // Token account for collateral (required for public mode)
}

export interface RemoveCollateralParams {
  positionKey: PublicKey;    // Position account
  collateralUsd: anchor.BN;  // Collateral to remove (in USD)
  fundingAccount?: PublicKey; // Token account to receive collateral (required for public mode)
}

export interface LiquidateParams {
  positionKey: PublicKey;    // Position to liquidate
}

// ============================================================================
// Encryption Context
// ============================================================================

export interface EncryptionContext {
  privateKey: Uint8Array;     // x25519 private key (32 bytes)
  publicKey: Uint8Array;      // x25519 public key (32 bytes)
  mxePublicKey: Uint8Array;   // MXE (MPC) public key (32 bytes)
  sharedSecret: Uint8Array;   // Shared secret for encryption (32 bytes)
}

// ============================================================================
// Adapter Configuration
// ============================================================================

export interface AdapterConfig {
  program: anchor.Program;
  provider: anchor.AnchorProvider;
  encryptionContext?: EncryptionContext; // Optional - will be auto-generated if not provided
  defaultPool?: PublicKey;
  defaultCustody?: PublicKey;
  defaultCollateralCustody?: PublicKey;
}

// ============================================================================
// Transaction Result
// ============================================================================

export interface TransactionResult {
  signature: string;
  positionKey?: PublicKey;   // For open_position, returns the created position
  success: boolean;
  error?: string;
}

// ============================================================================
// Decrypted Position Data
// ============================================================================

export interface DecryptedPositionData {
  sizeUsd: bigint;
  collateralUsd: bigint;
}

// ============================================================================
// View Function Results
// ============================================================================

export interface EntryPriceAndFee {
  price: anchor.BN;
  fee: anchor.BN;
}

export interface ExitPriceAndFee {
  price: anchor.BN;
  fee: anchor.BN;
  sizeDelta: anchor.BN;
}

export interface PnlResult {
  profit: anchor.BN;
  loss: anchor.BN;
  fee: anchor.BN;
}

export interface LiquidationPriceResult {
  liquidationPrice: anchor.BN;
}

export interface LiquidationStateResult {
  isLiquidatable: boolean;
  liquidationPrice: anchor.BN;
}

// ============================================================================
// Swap & Liquidity Parameters
// ============================================================================

export interface SwapParams {
  amountIn: anchor.BN;
  minAmountOut: anchor.BN;
  fundingAccount: PublicKey;
  receivingAccount: PublicKey;
  receivingCustodyMint: PublicKey;
  dispensingCustodyMint: PublicKey;
  poolName?: string;  // Optional pool name (defaults to default pool)
}

export interface AddLiquidityParams {
  amountIn: anchor.BN;
  minLpAmountOut: anchor.BN;
  fundingAccount: PublicKey;
  lpTokenAccount: PublicKey;
  custodyMint: PublicKey;
  poolName?: string;  // Optional pool name
}

export interface RemoveLiquidityParams {
  lpAmountIn: anchor.BN;
  minAmountOut: anchor.BN;
  receivingAccount: PublicKey;
  lpTokenAccount: PublicKey;
  custodyMint: PublicKey;
  poolName?: string;  // Optional pool name
}

// ============================================================================
// Additional View Function Parameters
// ============================================================================

export interface GetSwapAmountAndFeesParams {
  amountIn: anchor.BN;
  receivingCustodyMint: PublicKey;
  dispensingCustodyMint: PublicKey;
  poolName?: string;
}

export interface GetSwapAmountAndFeesResult {
  amountOut: anchor.BN;
  feeIn: anchor.BN;
  feeOut: anchor.BN;
}

export interface GetAddLiquidityAmountParams {
  amountIn: anchor.BN;
  custodyMint: PublicKey;
  poolName?: string;
}

export interface GetRemoveLiquidityAmountParams {
  lpAmountIn: anchor.BN;
  custodyMint: PublicKey;
  poolName?: string;
}

export interface LiquidityAmountAndFee {
  amount: anchor.BN;
  fee: anchor.BN;
}

export interface GetOraclePriceParams {
  custodyMint: PublicKey;
  ema?: boolean;
  poolName?: string;
}

// ============================================================================
// Adapter Mode
// ============================================================================

export enum AdapterMode {
  Private = "private",  // Uses encrypted Arcium MPC methods
  Public = "public",    // Uses public (non-encrypted) methods
}
