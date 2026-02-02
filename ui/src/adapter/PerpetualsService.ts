import { PerpetualsAdapter } from './PerpetualsAdapter';
import {
  OriginalPosition,
  EncryptedPosition,
  PositionSide,
  TransactionResult,
  OpenPositionParams,
  ClosePositionParams,
  AddCollateralParams,
  RemoveCollateralParams,
  LiquidateParams,
  SwapParams,
  AddLiquidityParams,
  RemoveLiquidityParams,
  EntryPriceAndFee,
  ExitPriceAndFee,
  PnlResult,
  LiquidationPriceResult,
  LiquidationStateResult,
  GetSwapAmountAndFeesResult,
  LiquidityAmountAndFee,
  AdapterConfig,
  AdapterMode,
} from './types';
import { PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';

export class PerpetualsService {
  private adapter: PerpetualsAdapter;
  private initialized: boolean = false;
  private mode: AdapterMode;

  constructor(
    program: anchor.Program,
    provider: anchor.AnchorProvider,
    defaultPool?: PublicKey,
    defaultCustody?: PublicKey,
    defaultCollateralCustody?: PublicKey,
    clusterOffset?: number,
    mode?: AdapterMode
  ) {
    const config: AdapterConfig = {
      program,
      provider,
      defaultPool,
      defaultCustody,
      defaultCollateralCustody,
    };
    this.mode = mode || AdapterMode.Private;
    this.adapter = new PerpetualsAdapter({ ...config, clusterOffset, mode: this.mode });
  }

  /**
   * Set the adapter mode (public or private)
   */
  setMode(mode: AdapterMode): void {
    this.mode = mode;
    this.adapter.setMode(mode);
  }

  /**
   * Get the current adapter mode
   */
  getMode(): AdapterMode {
    return this.mode;
  }

  async initialize(): Promise<void> {
    if (!this.initialized) {
      await this.adapter.initialize();
      this.initialized = true;
    }
  }

  isReady(): boolean {
    return this.initialized;
  }

  async openPosition(params: {
    price: anchor.BN;
    collateral: anchor.BN;
    size: anchor.BN;
    side: PositionSide;
    pool?: PublicKey;
    custody?: PublicKey;
    collateralCustody?: PublicKey;
  }): Promise<{ signature: string; positionKey?: PublicKey }> {
    this.ensureInitialized();

    const openParams: OpenPositionParams = {
      price: params.price,
      collateral: params.collateral,
      size: params.size,
      side: params.side,
      pool: params.pool,
      custody: params.custody,
      collateralCustody: params.collateralCustody,
    };

    const result = await this.adapter.openPosition(openParams);
    return {
      signature: result.signature,
      positionKey: result.positionKey,
    };
  }

  async closePosition(
    positionKey: PublicKey,
    price?: anchor.BN
  ): Promise<{ signature: string }> {
    this.ensureInitialized();

    const closeParams: ClosePositionParams = {
      positionKey,
      price,
    };

    const result = await this.adapter.closePosition(closeParams);
    return { signature: result.signature };
  }

  async addCollateral(
    positionKey: PublicKey,
    collateral: anchor.BN
  ): Promise<{ signature: string }> {
    this.ensureInitialized();

    const params: AddCollateralParams = {
      positionKey,
      collateral,
    };

    const result = await this.adapter.addCollateral(params);
    return { signature: result.signature };
  }

  async removeCollateral(
    positionKey: PublicKey,
    collateralUsd: anchor.BN
  ): Promise<{ signature: string }> {
    this.ensureInitialized();

    const params: RemoveCollateralParams = {
      positionKey,
      collateralUsd,
    };

    const result = await this.adapter.removeCollateral(params);
    return { signature: result.signature };
  }

  async liquidate(positionKey: PublicKey): Promise<{ signature: string }> {
    this.ensureInitialized();

    const params: LiquidateParams = {
      positionKey,
    };

    const result = await this.adapter.liquidate(params);
    return { signature: result.signature };
  }

  async getAllPositions(): Promise<Record<string, OriginalPosition>> {
    this.ensureInitialized();
    
    const positions = await this.adapter.getPositionsByOwner();
    const result: Record<string, OriginalPosition> = {};

    for (const position of positions) {
      const key = position.owner.toBase58();
      result[key] = position;
    }

    return result;
  }

  async getPosition(positionKey: PublicKey): Promise<OriginalPosition | null> {
    this.ensureInitialized();
    
    return this.adapter.getPosition(positionKey);
  }

  async getEntryPriceAndFee(
    collateral: anchor.BN,
    size: anchor.BN,
    side: PositionSide,
    custody?: PublicKey
  ): Promise<EntryPriceAndFee> {
    this.ensureInitialized();
    
    const result = await this.adapter.getEntryPriceAndFee(size, side, undefined, custody);
    if (!result) {
      throw new Error('Failed to get entry price and fee');
    }
    return result;
  }

  async getExitPriceAndFee(
    positionKey: PublicKey,
    sizeDelta: anchor.BN
  ): Promise<ExitPriceAndFee> {
    this.ensureInitialized();
    
    throw new Error('getExitPriceAndFee not yet implemented in adapter');
  }

  async getPnl(positionKey: PublicKey): Promise<PnlResult> {
    this.ensureInitialized();
    
    throw new Error('getPnl not yet implemented in adapter');
  }

  async getLiquidationPrice(
    positionKey: PublicKey
  ): Promise<LiquidationPriceResult> {
    this.ensureInitialized();
    
    throw new Error('getLiquidationPrice not yet implemented in adapter');
  }

  async getLiquidationState(
    positionKey: PublicKey
  ): Promise<LiquidationStateResult> {
    this.ensureInitialized();
    
    throw new Error('getLiquidationState not yet implemented in adapter');
  }

  async getOraclePrice(params: {
    custodyMint: PublicKey;
    ema?: boolean;
    poolName?: string;
  }): Promise<{ price: anchor.BN; exponent: number }> {
    this.ensureInitialized();
    
    const price = await this.adapter.getOraclePrice(params.custodyMint);
    if (!price) {
      throw new Error('Failed to get oracle price');
    }
    return { price, exponent: -8 };
  }

  async swap(params: SwapParams): Promise<{ signature: string }> {
    this.ensureInitialized();
    
    const result = await this.adapter.swap(params);
    return { signature: result.signature };
  }

  async addLiquidity(params: AddLiquidityParams): Promise<{ signature: string }> {
    this.ensureInitialized();
    
    const result = await this.adapter.addLiquidity(params);
    return { signature: result.signature };
  }

  async removeLiquidity(params: RemoveLiquidityParams): Promise<{ signature: string }> {
    this.ensureInitialized();
    
    const result = await this.adapter.removeLiquidity(params);
    return { signature: result.signature };
  }

  async getSwapAmountAndFees(
    amountIn: anchor.BN,
    receivingCustodyMint: PublicKey,
    dispensingCustodyMint: PublicKey,
    poolName?: string
  ): Promise<GetSwapAmountAndFeesResult> {
    this.ensureInitialized();
    
    const result = await this.adapter.getSwapAmountAndFees({
      amountIn,
      receivingCustodyMint,
      dispensingCustodyMint,
      poolName,
    });
    if (!result) {
      throw new Error('Failed to get swap amount and fees');
    }
    return result;
  }

  async getAddLiquidityAmountAndFee(
    amountIn: anchor.BN,
    custodyMint: PublicKey,
    poolName?: string
  ): Promise<LiquidityAmountAndFee> {
    this.ensureInitialized();
    
    const result = await this.adapter.getAddLiquidityAmountAndFee({
      amountIn,
      custodyMint,
      poolName,
    });
    if (!result) {
      throw new Error('Failed to get add liquidity amount and fee');
    }
    return result;
  }

  async getRemoveLiquidityAmountAndFee(
    lpAmountIn: anchor.BN,
    custodyMint: PublicKey,
    poolName?: string
  ): Promise<LiquidityAmountAndFee> {
    this.ensureInitialized();
    
    const result = await this.adapter.getRemoveLiquidityAmountAndFee({
      lpAmountIn,
      custodyMint,
      poolName,
    });
    if (!result) {
      throw new Error('Failed to get remove liquidity amount and fee');
    }
    return result;
  }

  async getAssetsUnderManagement(pool?: PublicKey): Promise<anchor.BN> {
    this.ensureInitialized();
    
    const result = await this.adapter.getAssetsUnderManagement(pool);
    if (!result) {
      throw new Error('Failed to get assets under management');
    }
    return result;
  }

  async getLpTokenPrice(pool?: PublicKey): Promise<anchor.BN> {
    this.ensureInitialized();
    
    const result = await this.adapter.getLpTokenPrice(pool);
    if (!result) {
      throw new Error('Failed to get LP token price');
    }
    return result;
  }

  getAdapter(): PerpetualsAdapter {
    return this.adapter;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('PerpetualsService not initialized. Call initialize() first.');
    }
  }
}
