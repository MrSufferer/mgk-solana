
import { PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";


export interface OriginalPosition {
  owner: PublicKey;
  pool: PublicKey;
  custody: PublicKey;
  collateralCustody: PublicKey;
  openTime: anchor.BN;
  updateTime: anchor.BN;
  side: PositionSide;
  price: anchor.BN;
  sizeUsd: anchor.BN;
  borrowSizeUsd: anchor.BN;
  collateralUsd: anchor.BN;
  unrealizedProfitUsd: anchor.BN;
  unrealizedLossUsd: anchor.BN;
  cumulativeInterestSnapshot: anchor.BN;
  lockedAmount: anchor.BN;
  collateralAmount: anchor.BN;
  bump: number;
}


export interface EncryptedPosition {
  owner: PublicKey;
  positionId: anchor.BN;
  side: PositionSide;
  sizeUsdEncrypted: number[];
  collateralUsdEncrypted: number[];
  entryPrice: anchor.BN;
  openTime: anchor.BN;
  updateTime: anchor.BN;
  ownerEncPubkey: number[];
  sizeNonce: anchor.BN;
  collateralNonce: anchor.BN;
  liquidator: PublicKey;
  bump: number;
}


export enum PositionSide {
  None = 0,
  Long = 1,
  Short = 2,
}


export interface OpenPositionParams {
  price: anchor.BN;
  collateral: anchor.BN;
  size: anchor.BN;
  side: PositionSide;
  pool?: PublicKey;
  custody?: PublicKey;
  collateralCustody?: PublicKey;
}

export interface ClosePositionParams {
  positionKey: PublicKey;
  price?: anchor.BN;
}

export interface AddCollateralParams {
  positionKey: PublicKey;
  collateral: anchor.BN;
}

export interface RemoveCollateralParams {
  positionKey: PublicKey;
  collateralUsd: anchor.BN;
}

export interface LiquidateParams {
  positionKey: PublicKey;
}


export interface EncryptionContext {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  mxePublicKey: Uint8Array;
  sharedSecret: Uint8Array;
}


export interface AdapterConfig {
  program: anchor.Program;
  provider: anchor.AnchorProvider;
  encryptionContext?: EncryptionContext;
  defaultPool?: PublicKey;
  defaultCustody?: PublicKey;
  defaultCollateralCustody?: PublicKey;
}


export interface TransactionResult {
  signature: string;
  positionKey?: PublicKey;
  success: boolean;
  error?: string;
}


export interface DecryptedPositionData {
  sizeUsd: bigint;
  collateralUsd: bigint;
}


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


export interface SwapParams {
  amountIn: anchor.BN;
  minAmountOut: anchor.BN;
  fundingAccount: PublicKey;
  receivingAccount: PublicKey;
  receivingCustodyMint: PublicKey;
  dispensingCustodyMint: PublicKey;
  poolName?: string;
}

export interface AddLiquidityParams {
  amountIn: anchor.BN;
  minLpAmountOut: anchor.BN;
  fundingAccount: PublicKey;
  lpTokenAccount: PublicKey;
  custodyMint: PublicKey;
  poolName?: string;
}

export interface RemoveLiquidityParams {
  lpAmountIn: anchor.BN;
  minAmountOut: anchor.BN;
  receivingAccount: PublicKey;
  lpTokenAccount: PublicKey;
  custodyMint: PublicKey;
  poolName?: string;
}


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
