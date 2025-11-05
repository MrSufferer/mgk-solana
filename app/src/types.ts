
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export type PositionSide = "long" | "short";

export interface TokenRatio {
  target: BN;
  min: BN;
  max: BN;
}

export interface InitParams {
  minSignatures: number;
  allowSwap: boolean;
  allowAddLiquidity: boolean;
  allowRemoveLiquidity: boolean;
  allowOpenPosition: boolean;
  allowClosePosition: boolean;
  allowPnlWithdrawal: boolean;
  allowCollateralWithdrawal: boolean;
  allowSizeChange: boolean;
}

export interface OracleParams {
  maxPriceError: BN;
  maxPriceAgeSec: number;
  oracleType: { custom: {} } | { pyth: {} } | { none: {} };
  oracleAccount: PublicKey;
  oracleAuthority: PublicKey;
}

export interface PricingParams {
  useEma: boolean;
  useUnrealizedPnlInAum: boolean;
  tradeSpreadLong: BN;
  tradeSpreadShort: BN;
  swapSpread: BN;
  minInitialLeverage: BN;
  maxInitialLeverage: BN;
  maxLeverage: BN;
  maxPayoffMult: BN;
  maxUtilization: BN;
  maxPositionLockedUsd: BN;
  maxTotalLockedUsd: BN;
}

export interface Permissions {
  allowSwap: boolean;
  allowAddLiquidity: boolean;
  allowRemoveLiquidity: boolean;
  allowOpenPosition: boolean;
  allowClosePosition: boolean;
  allowPnlWithdrawal: boolean;
  allowCollateralWithdrawal: boolean;
  allowSizeChange: boolean;
}

export interface Fees {
  mode: { fixed: {} } | { linear: {} } | { optimal: {} };
  ratioMult: BN;
  utilizationMult: BN;
  swapIn: BN;
  swapOut: BN;
  stableSwapIn: BN;
  stableSwapOut: BN;
  addLiquidity: BN;
  removeLiquidity: BN;
  openPosition: BN;
  closePosition: BN;
  liquidation: BN;
  protocolShare: BN;
  feeMax: BN;
  feeOptimal: BN;
}

export interface BorrowRateParams {
  baseRate: BN;
  slope1: BN;
  slope2: BN;
  optimalUtilization: BN;
}

export interface SetCustomOraclePriceParams {
  price: BN;
  expo: number;
  conf: BN;
  ema: BN;
  publishTime: BN;
}

export interface AmountAndFee {
  amount: BN;
  fee: BN;
}

export interface NewPositionPricesAndFee {
  entryPrice: BN;
  liquidationPrice: BN;
  fee: BN;
}

export interface PriceAndFee {
  price: BN;
  fee: BN;
}

export interface ProfitAndLoss {
  profit: BN;
  loss: BN;
}

export interface SwapAmountAndFees {
  amountOut: BN;
  feeIn: BN;
  feeOut: BN;
}
