/**
 * Perpetuals DEX Adapter
 * 
 * This adapter bridges the gap between the original perpetuals UI
 * (which expects public, transparent data) and our encrypted MPC-based
 * implementation (which uses Arcium for privacy-preserving trading).
 * 
 * Key Features:
 * - Transparent encryption/decryption of position data
 * - Compatible with original perpetuals UI method signatures
 * - Maintains privacy through client-side encryption
 * - Handles MPC computation lifecycle automatically
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  awaitComputationFinalization,
  getComputationAccAddress,
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getArciumEnv,
} from "@arcium-hq/client";

import {
  AdapterConfig,
  OriginalPosition,
  SwapParams,
  AddLiquidityParams,
  RemoveLiquidityParams,
  GetSwapAmountAndFeesParams,
  GetSwapAmountAndFeesResult,
  GetAddLiquidityAmountParams,
  GetRemoveLiquidityAmountParams,
  LiquidityAmountAndFee,
  EncryptedPosition,
  OpenPositionParams,
  ClosePositionParams,
  AddCollateralParams,
  RemoveCollateralParams,
  LiquidateParams,
  TransactionResult,
  PositionSide,
  EntryPriceAndFee,
  ExitPriceAndFee,
  PnlResult,
  LiquidationPriceResult,
  LiquidationStateResult,
} from "./types";

import {
  initializeEncryption,
  encryptPositionData,
  decryptPositionData,
  generateComputationOffset,
  generatePositionId,
  nonceToBN,
  ciphertextToBytes,
  retryWithBackoff,
} from "./encryption";

/**
 * Main adapter class that provides UI-compatible methods
 */
export class PerpetualsAdapter {
  private program: anchor.Program;
  private provider: anchor.AnchorProvider;
  private encryptionContext?: any;
  private defaultPool?: PublicKey;
  private defaultCustody?: PublicKey;
  private defaultCollateralCustody?: PublicKey;

  constructor(config: AdapterConfig) {
    this.program = config.program;
    this.provider = config.provider;
    this.encryptionContext = config.encryptionContext;
    this.defaultPool = config.defaultPool;
    this.defaultCustody = config.defaultCustody;
    this.defaultCollateralCustody = config.defaultCollateralCustody;
  }

  /**
   * Initialize the adapter - must be called before any trading operations
   */
  async initialize(): Promise<void> {
    if (!this.encryptionContext) {
      console.log("[Adapter] Initializing encryption context...");
      this.encryptionContext = await initializeEncryption(
        this.provider,
        this.program.programId
      );
      console.log("[Adapter] Encryption context initialized");
    }
  }

  /**
   * Ensure encryption context is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.encryptionContext) {
      await this.initialize();
    }
  }

  // ============================================================================
  // TRADING METHODS
  // ============================================================================

  /**
   * Open a new position
   * 
   * @param params Position parameters (price, collateral, size, side)
   * @returns Transaction result with position key
   */
  async openPosition(params: OpenPositionParams): Promise<TransactionResult> {
    await this.ensureInitialized();

    try {
      console.log("\n[Adapter] Opening position...");
      console.log("  Side:", params.side === PositionSide.Long ? "Long" : "Short");
      console.log("  Entry Price:", params.price.toString());
      console.log("  Size (USD):", params.size.toString());
      console.log("  Collateral (USD):", params.collateral.toString());

      // Generate position ID
      const positionId = generatePositionId();
      const positionIdBuffer = Buffer.alloc(8);
      positionIdBuffer.writeBigUInt64LE(positionId);

        // Derive position PDA - seeds: [b"position", owner, position_id]
      const [positionPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("position"),
          this.provider.wallet.publicKey.toBuffer(),
          positionIdBuffer
        ],
        this.program.programId
      );

      // Encrypt position data
      const encrypted = encryptPositionData(
        BigInt(params.size.toString()),
        BigInt(params.collateral.toString()),
        this.encryptionContext.sharedSecret
      );

      // Generate computation offset
      const computationOffset = generateComputationOffset();

      // Get Arcium account addresses
      const arciumEnv = getArciumEnv();
      const computationAccount = getComputationAccAddress(
        this.program.programId,
        computationOffset
      );
      const clusterAccount = arciumEnv.arciumClusterPubkey;
      const mxeAccount = getMXEAccAddress(this.program.programId);
      const mempoolAccount = getMempoolAccAddress(this.program.programId);
      const executingPool = getExecutingPoolAccAddress(this.program.programId);
      const compDefAccOffset = getCompDefAccOffset("open_position");
      const compDefAccount = getCompDefAccAddress(
        this.program.programId,
        Buffer.from(compDefAccOffset).readUInt32LE()
      );

      // Call encrypted open_position instruction
      console.log("  Sending transaction...");
      const signature = await this.program.methods
        .openPosition(
          computationOffset,
          new anchor.BN(positionId.toString()),
          params.side,
          params.price,
          encrypted.sizeEncrypted,
          encrypted.collateralEncrypted,
          Array.from(this.encryptionContext.publicKey),
          nonceToBN(encrypted.sizeNonce),
          nonceToBN(encrypted.collateralNonce)
        )
        .accountsPartial({
          owner: this.provider.wallet.publicKey,
          payer: this.provider.wallet.publicKey,
          computationAccount,
          clusterAccount,
          mxeAccount,
          mempoolAccount,
          executingPool,
          compDefAccount,
          position: positionPDA,
          // TODO: Add pool, custody, oracle accounts when available
        })
        .rpc({ commitment: "confirmed" });

      console.log("  Transaction signature:", signature);
      console.log("  Waiting for MPC computation...");

      // Wait for computation finalization
      await awaitComputationFinalization(
        this.provider,
        computationOffset,
        this.program.programId,
        "confirmed"
      );

      console.log("  Position opened successfully!");
      console.log("  Position PDA:", positionPDA.toBase58());

      return {
        signature,
        positionKey: positionPDA,
        success: true,
      };
    } catch (error) {
      console.error("[Adapter] Error opening position:", error);
      return {
        signature: "",
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Close an existing position
   * 
   * @param params Position to close
   * @returns Transaction result
   */
  async closePosition(params: ClosePositionParams): Promise<TransactionResult> {
    await this.ensureInitialized();

    try {
      console.log("\n[Adapter] Closing position...");
      console.log("  Position:", params.positionKey.toBase58());

      // Fetch position to get position ID
      const position = await this.program.account.position.fetch(
        params.positionKey
      ) as any;

      // Generate computation offset
      const computationOffset = generateComputationOffset();

      // Get Arcium account addresses
      const computationAccount = getComputationAccAddress(
        this.program.programId,
        computationOffset
      );
      const clusterAccount = this.getClusterAccount();
      const mxeAccount = getMXEAccAddress(this.program.programId);
      const mempoolAccount = getMempoolAccAddress(this.program.programId);
      const executingPool = getExecutingPoolAccAddress(this.program.programId);
      const compDefAccount = getCompDefAccAddress(
        this.program.programId,
        Buffer.from(getCompDefAccOffset("close_position")).readUInt32LE()
      );

      // Call encrypted close_position instruction
      console.log("  Sending transaction...");
      const signature = await this.program.methods
        .closePosition(
          computationOffset,
          position.positionId,
          params.price || new anchor.BN(0) // 0 = use oracle price
        )
        .accountsPartial({
          computationAccount,
          clusterAccount,
          mxeAccount,
          mempoolAccount,
          executingPool,
          compDefAccount,
          position: params.positionKey,
          owner: this.provider.wallet.publicKey,
          // TODO: Add pool, custody, oracle accounts
        })
        .rpc({ commitment: "confirmed" });

      console.log("  Transaction signature:", signature);
      console.log("  Waiting for MPC computation...");

      // Wait for computation finalization
      await awaitComputationFinalization(
        this.provider,
        computationOffset,
        this.program.programId,
        "confirmed"
      );

      console.log("  Position closed successfully!");

      return {
        signature,
        success: true,
      };
    } catch (error) {
      console.error("[Adapter] Error closing position:", error);
      return {
        signature: "",
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Add collateral to an existing position
   * 
   * @param params Collateral to add
   * @returns Transaction result
   */
  async addCollateral(params: AddCollateralParams): Promise<TransactionResult> {
    await this.ensureInitialized();

    try {
      console.log("\n[Adapter] Adding collateral...");
      console.log("  Position:", params.positionKey.toBase58());
      console.log("  Collateral (USD):", params.collateral.toString());

      // Fetch position to get position ID
      const position = await this.program.account.position.fetch(
        params.positionKey
      ) as any;

      // Encrypt collateral amount
      const encrypted = encryptPositionData(
        BigInt(0), // size not needed
        BigInt(params.collateral.toString()),
        this.encryptionContext.sharedSecret
      );

      // Generate computation offset
      const computationOffset = generateComputationOffset();

      // Get Arcium account addresses
      const computationAccount = getComputationAccAddress(
        this.program.programId,
        computationOffset
      );
      const clusterAccount = this.getClusterAccount();
      const mxeAccount = getMXEAccAddress(this.program.programId);
      const mempoolAccount = getMempoolAccAddress(this.program.programId);
      const executingPool = getExecutingPoolAccAddress(this.program.programId);
      const compDefAccount = getCompDefAccAddress(
        this.program.programId,
        Buffer.from(getCompDefAccOffset("add_collateral")).readUInt32LE()
      );

      // Call encrypted add_collateral instruction
      console.log("  Sending transaction...");
      const signature = await this.program.methods
        .addCollateral(
          computationOffset,
          position.positionId,
          Array.from(encrypted.collateralEncrypted),
          nonceToBN(encrypted.collateralNonce)
        )
        .accountsPartial({
          computationAccount,
          clusterAccount,
          mxeAccount,
          mempoolAccount,
          executingPool,
          compDefAccount,
          position: params.positionKey,
          owner: this.provider.wallet.publicKey,
          // TODO: Add pool, custody accounts
        })
        .rpc({ commitment: "confirmed" });

      console.log("  Transaction signature:", signature);
      console.log("  Waiting for MPC computation...");

      // Wait for computation finalization
      await awaitComputationFinalization(
        this.provider,
        computationOffset,
        this.program.programId,
        "confirmed"
      );

      console.log("  Collateral added successfully!");

      return {
        signature,
        success: true,
      };
    } catch (error) {
      console.error("[Adapter] Error adding collateral:", error);
      return {
        signature: "",
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Remove collateral from an existing position
   * 
   * @param params Collateral to remove
   * @returns Transaction result
   */
  async removeCollateral(params: RemoveCollateralParams): Promise<TransactionResult> {
    await this.ensureInitialized();

    try {
      console.log("\n[Adapter] Removing collateral...");
      console.log("  Position:", params.positionKey.toBase58());
      console.log("  Collateral (USD):", params.collateralUsd.toString());

      // Fetch position to get position ID
      const position = await this.program.account.position.fetch(
        params.positionKey
      ) as any;

      // Encrypt collateral amount
      const encrypted = encryptPositionData(
        BigInt(0), // size not needed
        BigInt(params.collateralUsd.toString()),
        this.encryptionContext.sharedSecret
      );

      // Generate computation offset
      const computationOffset = generateComputationOffset();

      // Get Arcium account addresses
      const computationAccount = getComputationAccAddress(
        this.program.programId,
        computationOffset
      );
      const clusterAccount = this.getClusterAccount();
      const mxeAccount = getMXEAccAddress(this.program.programId);
      const mempoolAccount = getMempoolAccAddress(this.program.programId);
      const executingPool = getExecutingPoolAccAddress(this.program.programId);
      const compDefAccount = getCompDefAccAddress(
        this.program.programId,
        Buffer.from(getCompDefAccOffset("remove_collateral")).readUInt32LE()
      );

      // Call encrypted remove_collateral instruction
      console.log("  Sending transaction...");
      const signature = await this.program.methods
        .removeCollateral(
          computationOffset,
          position.positionId,
          Array.from(encrypted.collateralEncrypted),
          nonceToBN(encrypted.collateralNonce)
        )
        .accountsPartial({
          computationAccount,
          clusterAccount,
          mxeAccount,
          mempoolAccount,
          executingPool,
          compDefAccount,
          position: params.positionKey,
          owner: this.provider.wallet.publicKey,
          // TODO: Add pool, custody accounts
        })
        .rpc({ commitment: "confirmed" });

      console.log("  Transaction signature:", signature);
      console.log("  Waiting for MPC computation...");

      // Wait for computation finalization
      await awaitComputationFinalization(
        this.provider,
        computationOffset,
        this.program.programId,
        "confirmed"
      );

      console.log("  Collateral removed successfully!");

      return {
        signature,
        success: true,
      };
    } catch (error) {
      console.error("[Adapter] Error removing collateral:", error);
      return {
        signature: "",
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Liquidate an underwater position
   * 
   * @param params Position to liquidate
   * @returns Transaction result
   */
  async liquidate(params: LiquidateParams): Promise<TransactionResult> {
    await this.ensureInitialized();

    try {
      console.log("\n[Adapter] Liquidating position...");
      console.log("  Position:", params.positionKey.toBase58());

      // Fetch position to get position ID
      const position = await this.program.account.position.fetch(
        params.positionKey
      ) as any;

      // Generate computation offset
      const computationOffset = generateComputationOffset();

      // Get Arcium account addresses
      const computationAccount = getComputationAccAddress(
        this.program.programId,
        computationOffset
      );
      const clusterAccount = this.getClusterAccount();
      const mxeAccount = getMXEAccAddress(this.program.programId);
      const mempoolAccount = getMempoolAccAddress(this.program.programId);
      const executingPool = getExecutingPoolAccAddress(this.program.programId);
      const compDefAccount = getCompDefAccAddress(
        this.program.programId,
        Buffer.from(getCompDefAccOffset("liquidate")).readUInt32LE()
      );

      // Call encrypted liquidate instruction
      console.log("  Sending transaction...");
      const signature = await this.program.methods
        .liquidate(
          computationOffset,
          position.positionId
        )
        .accountsPartial({
          computationAccount,
          clusterAccount,
          mxeAccount,
          mempoolAccount,
          executingPool,
          compDefAccount,
          position: params.positionKey,
          liquidator: this.provider.wallet.publicKey,
          // TODO: Add pool, custody, oracle accounts
        })
        .rpc({ commitment: "confirmed" });

      console.log("  Transaction signature:", signature);
      console.log("  Waiting for MPC computation...");

      // Wait for computation finalization
      await awaitComputationFinalization(
        this.provider,
        computationOffset,
        this.program.programId,
        "confirmed"
      );

      console.log("  Position liquidated successfully!");

      return {
        signature,
        success: true,
      };
    } catch (error) {
      console.error("[Adapter] Error liquidating position:", error);
      return {
        signature: "",
        success: false,
        error: (error as Error).message,
      };
    }
  }

  // ============================================================================
  // POSITION QUERIES
  // ============================================================================

  /**
   * Fetch a position and decrypt its data
   * 
   * @param positionKey Position account public key
   * @returns Position in UI-compatible format
   */
  async getPosition(positionKey: PublicKey): Promise<OriginalPosition | null> {
    await this.ensureInitialized();

    try {
      // Fetch encrypted position
      const encryptedPosition = await this.program.account.position.fetch(
        positionKey
      ) as any;

      // Decrypt size and collateral
      const decrypted = decryptPositionData(
        encryptedPosition.sizeUsdEncrypted,
        encryptedPosition.sizeNonce,
        encryptedPosition.collateralUsdEncrypted,
        encryptedPosition.collateralNonce,
        this.encryptionContext.sharedSecret
      );

      // Transform to UI-compatible format
      // Note: Some fields may need to be computed or mocked
      const position: OriginalPosition = {
        owner: encryptedPosition.owner,
        pool: this.defaultPool || PublicKey.default, // TODO: Store in position
        custody: this.defaultCustody || PublicKey.default, // TODO: Store in position
        collateralCustody: this.defaultCollateralCustody || PublicKey.default,
        openTime: encryptedPosition.openTime,
        updateTime: encryptedPosition.updateTime,
        side: encryptedPosition.side,
        price: encryptedPosition.entryPrice,
        sizeUsd: new anchor.BN(decrypted.sizeUsd.toString()),
        borrowSizeUsd: new anchor.BN(0), // TODO: Calculate from leverage
        collateralUsd: new anchor.BN(decrypted.collateralUsd.toString()),
        unrealizedProfitUsd: new anchor.BN(0), // TODO: Calculate from current price
        unrealizedLossUsd: new anchor.BN(0), // TODO: Calculate from current price
        cumulativeInterestSnapshot: new anchor.BN(0), // TODO: Track interest
        lockedAmount: new anchor.BN(0), // TODO: Calculate token amount
        collateralAmount: new anchor.BN(0), // TODO: Calculate token amount
        bump: encryptedPosition.bump,
      };

      return position;
    } catch (error) {
      console.error("[Adapter] Error fetching position:", error);
      return null;
    }
  }

  /**
   * Fetch all positions for a given owner
   * 
   * @param owner Owner public key (defaults to connected wallet)
   * @returns Array of positions in UI-compatible format
   */
  async getPositionsByOwner(owner?: PublicKey): Promise<OriginalPosition[]> {
    await this.ensureInitialized();

    const ownerKey = owner || this.provider.wallet.publicKey;
    
    try {
      // Fetch all position accounts for owner
      const positions = await this.program.account.position.all([
        {
          memcmp: {
            offset: 8, // Skip discriminator
            bytes: ownerKey.toBase58(),
          },
        },
      ]);

      // Decrypt and transform each position
      const results: OriginalPosition[] = [];
      for (const { publicKey, account } of positions) {
        const position = await this.getPosition(publicKey);
        if (position) {
          results.push(position);
        }
      }

      return results;
    } catch (error) {
      console.error("[Adapter] Error fetching positions:", error);
      return [];
    }
  }

  // ============================================================================
  // VIEW FUNCTIONS (Read-only, no encryption needed)
  // ============================================================================

  /**
   * Get entry price and fee for opening a position
   */
  async getEntryPriceAndFee(
    sizeUsd: anchor.BN,
    side: PositionSide,
    pool?: PublicKey,
    custody?: PublicKey
  ): Promise<EntryPriceAndFee | null> {
    try {
      const result = await this.program.methods
        .getEntryPriceAndFee(sizeUsd, side)
        .accountsPartial({
          pool: pool || this.defaultPool,
          custody: custody || this.defaultCustody,
          // TODO: Add oracle account
        })
        .view();

      return {
        price: result.price,
        fee: result.fee,
      };
    } catch (error) {
      console.error("[Adapter] Error getting entry price:", error);
      return null;
    }
  }

  /**
   * Get oracle price for an asset
   */
  async getOraclePrice(custody?: PublicKey): Promise<anchor.BN | null> {
    try {
      const result = await this.program.methods
        .getOraclePrice()
        .accountsPartial({
          custody: custody || this.defaultCustody,
          // TODO: Add oracle account
        })
        .view();

      return result as anchor.BN;
    } catch (error) {
      console.error("[Adapter] Error getting oracle price:", error);
      return null;
    }
  }

  // ============================================================================
  // SWAP & LIQUIDITY OPERATIONS
  // ============================================================================

  /**
   * Swap tokens between custodies
   * 
   * @param params Swap parameters
   * @returns Transaction result
   */
  async swap(params: SwapParams): Promise<TransactionResult> {
    try {
      console.log("\n[Adapter] Executing swap...");

      // Derive custody PDAs
      const pool = this.defaultPool!;
      const receivingCustody = PublicKey.findProgramAddressSync(
        [Buffer.from("custody"), pool.toBuffer(), params.receivingCustodyMint.toBuffer()],
        this.program.programId
      )[0];
      const receivingCustodyTokenAccount = PublicKey.findProgramAddressSync(
        [Buffer.from("custody_token_account"), pool.toBuffer(), params.receivingCustodyMint.toBuffer()],
        this.program.programId
      )[0];
      const dispensingCustody = PublicKey.findProgramAddressSync(
        [Buffer.from("custody"), pool.toBuffer(), params.dispensingCustodyMint.toBuffer()],
        this.program.programId
      )[0];
      const dispensingCustodyTokenAccount = PublicKey.findProgramAddressSync(
        [Buffer.from("custody_token_account"), pool.toBuffer(), params.dispensingCustodyMint.toBuffer()],
        this.program.programId
      )[0];

      const signature = await this.program.methods
        .swap({
          amountIn: params.amountIn,
          minAmountOut: params.minAmountOut,
        })
        .accounts({
          owner: this.provider.publicKey,
          fundingAccount: params.fundingAccount,
          receivingAccount: params.receivingAccount,
          transferAuthority: this.provider.publicKey,
          perpetuals: this.getPerpetualsPDA(),
          pool,
          receivingCustody,
          receivingCustodyTokenAccount,
          dispensingCustody,
          dispensingCustodyTokenAccount,
        })
        .rpc();

      console.log("  Swap executed successfully!");
      console.log("  Signature:", signature);

      return { signature, success: true };
    } catch (error) {
      console.error("[Adapter] Error executing swap:", error);
      return {
        signature: "",
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Add liquidity to pool
   * 
   * @param params Liquidity parameters
   * @returns Transaction result
   */
  async addLiquidity(params: AddLiquidityParams): Promise<TransactionResult> {
    try {
      console.log("\n[Adapter] Adding liquidity...");

      const pool = this.defaultPool!;
      const custody = PublicKey.findProgramAddressSync(
        [Buffer.from("custody"), pool.toBuffer(), params.custodyMint.toBuffer()],
        this.program.programId
      )[0];
      const custodyTokenAccount = PublicKey.findProgramAddressSync(
        [Buffer.from("custody_token_account"), pool.toBuffer(), params.custodyMint.toBuffer()],
        this.program.programId
      )[0];
      const lpTokenMint = PublicKey.findProgramAddressSync(
        [Buffer.from("lp_token_mint"), pool.toBuffer()],
        this.program.programId
      )[0];

      const signature = await this.program.methods
        .addLiquidity({
          amountIn: params.amountIn,
          minLpAmountOut: params.minLpAmountOut,
        })
        .accounts({
          owner: this.provider.publicKey,
          fundingAccount: params.fundingAccount,
          lpTokenAccount: params.lpTokenAccount,
          transferAuthority: this.provider.publicKey,
          perpetuals: this.getPerpetualsPDA(),
          pool,
          custody,
          custodyTokenAccount,
          lpTokenMint,
        })
        .rpc();

      console.log("  Liquidity added successfully!");
      console.log("  Signature:", signature);

      return { signature, success: true };
    } catch (error) {
      console.error("[Adapter] Error adding liquidity:", error);
      return {
        signature: "",
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Remove liquidity from pool
   * 
   * @param params Liquidity parameters
   * @returns Transaction result
   */
  async removeLiquidity(params: RemoveLiquidityParams): Promise<TransactionResult> {
    try {
      console.log("\n[Adapter] Removing liquidity...");

      const pool = this.defaultPool!;
      const custody = PublicKey.findProgramAddressSync(
        [Buffer.from("custody"), pool.toBuffer(), params.custodyMint.toBuffer()],
        this.program.programId
      )[0];
      const custodyTokenAccount = PublicKey.findProgramAddressSync(
        [Buffer.from("custody_token_account"), pool.toBuffer(), params.custodyMint.toBuffer()],
        this.program.programId
      )[0];
      const lpTokenMint = PublicKey.findProgramAddressSync(
        [Buffer.from("lp_token_mint"), pool.toBuffer()],
        this.program.programId
      )[0];

      const signature = await this.program.methods
        .removeLiquidity({
          lpAmountIn: params.lpAmountIn,
          minAmountOut: params.minAmountOut,
        })
        .accounts({
          owner: this.provider.publicKey,
          receivingAccount: params.receivingAccount,
          lpTokenAccount: params.lpTokenAccount,
          transferAuthority: this.provider.publicKey,
          perpetuals: this.getPerpetualsPDA(),
          pool,
          custody,
          custodyTokenAccount,
          lpTokenMint,
        })
        .rpc();

      console.log("  Liquidity removed successfully!");
      console.log("  Signature:", signature);

      return { signature, success: true };
    } catch (error) {
      console.error("[Adapter] Error removing liquidity:", error);
      return {
        signature: "",
        success: false,
        error: (error as Error).message,
      };
    }
  }

  // ============================================================================
  // ADDITIONAL VIEW FUNCTIONS
  // ============================================================================

  /**
   * Calculate swap amount and fees
   */
  async getSwapAmountAndFees(params: GetSwapAmountAndFeesParams): Promise<GetSwapAmountAndFeesResult | null> {
    try {
      const pool = this.defaultPool!;
      const receivingCustody = PublicKey.findProgramAddressSync(
        [Buffer.from("custody"), pool.toBuffer(), params.receivingCustodyMint.toBuffer()],
        this.program.programId
      )[0];
      const dispensingCustody = PublicKey.findProgramAddressSync(
        [Buffer.from("custody"), pool.toBuffer(), params.dispensingCustodyMint.toBuffer()],
        this.program.programId
      )[0];

      // Get custody data to find oracle accounts
      const receivingCustodyData = await this.program.account.custody.fetch(receivingCustody) as any;
      const dispensingCustodyData = await this.program.account.custody.fetch(dispensingCustody) as any;

      const result = await this.program.methods
        .getSwapAmountAndFees({ amountIn: params.amountIn })
        .accountsPartial({
          perpetuals: this.getPerpetualsPDA(),
          pool,
          receivingCustody,
          receivingCustodyOracleAccount: receivingCustodyData.oracle.oracleAccount,
          dispensingCustody,
          dispensingCustodyOracleAccount: dispensingCustodyData.oracle.oracleAccount,
        })
        .view();

      return result as GetSwapAmountAndFeesResult;
    } catch (error) {
      console.error("[Adapter] Error getting swap amount:", error);
      return null;
    }
  }

  /**
   * Calculate add liquidity amount and fee
   */
  async getAddLiquidityAmountAndFee(params: GetAddLiquidityAmountParams): Promise<LiquidityAmountAndFee | null> {
    try {
      const pool = this.defaultPool!;
      const custody = PublicKey.findProgramAddressSync(
        [Buffer.from("custody"), pool.toBuffer(), params.custodyMint.toBuffer()],
        this.program.programId
      )[0];
      const lpTokenMint = PublicKey.findProgramAddressSync(
        [Buffer.from("lp_token_mint"), pool.toBuffer()],
        this.program.programId
      )[0];

      const custodyData = await this.program.account.custody.fetch(custody) as any;

      const result = await this.program.methods
        .getAddLiquidityAmountAndFee({ amountIn: params.amountIn })
        .accountsPartial({
          perpetuals: this.getPerpetualsPDA(),
          pool,
          custody,
          custodyOracleAccount: custodyData.oracle.oracleAccount,
          lpTokenMint,
        })
        .view();

      return result as LiquidityAmountAndFee;
    } catch (error) {
      console.error("[Adapter] Error getting add liquidity amount:", error);
      return null;
    }
  }

  /**
   * Calculate remove liquidity amount and fee
   */
  async getRemoveLiquidityAmountAndFee(params: GetRemoveLiquidityAmountParams): Promise<LiquidityAmountAndFee | null> {
    try {
      const pool = this.defaultPool!;
      const custody = PublicKey.findProgramAddressSync(
        [Buffer.from("custody"), pool.toBuffer(), params.custodyMint.toBuffer()],
        this.program.programId
      )[0];
      const lpTokenMint = PublicKey.findProgramAddressSync(
        [Buffer.from("lp_token_mint"), pool.toBuffer()],
        this.program.programId
      )[0];

      const custodyData = await this.program.account.custody.fetch(custody) as any;

      const result = await this.program.methods
        .getRemoveLiquidityAmountAndFee({ lpAmountIn: params.lpAmountIn })
        .accountsPartial({
          perpetuals: this.getPerpetualsPDA(),
          pool,
          custody,
          custodyOracleAccount: custodyData.oracle.oracleAccount,
          lpTokenMint,
        })
        .view();

      return result as LiquidityAmountAndFee;
    } catch (error) {
      console.error("[Adapter] Error getting remove liquidity amount:", error);
      return null;
    }
  }

  /**
   * Get pool assets under management (AUM)
   */
  async getAssetsUnderManagement(pool?: PublicKey): Promise<anchor.BN | null> {
    try {
      const result = await this.program.methods
        .getAssetsUnderManagement({})
        .accountsPartial({
          perpetuals: this.getPerpetualsPDA(),
          pool: pool || this.defaultPool,
        })
        .view();

      return result as anchor.BN;
    } catch (error) {
      console.error("[Adapter] Error getting AUM:", error);
      return null;
    }
  }

  /**
   * Get LP token price
   */
  async getLpTokenPrice(pool?: PublicKey): Promise<anchor.BN | null> {
    try {
      const poolAccount = pool || this.defaultPool!;
      const lpTokenMint = PublicKey.findProgramAddressSync(
        [Buffer.from("lp_token_mint"), poolAccount.toBuffer()],
        this.program.programId
      )[0];

      const result = await this.program.methods
        .getLpTokenPrice({})
        .accountsPartial({
          perpetuals: this.getPerpetualsPDA(),
          pool: poolAccount,
          lpTokenMint,
        })
        .view();

      return result as anchor.BN;
    } catch (error) {
      console.error("[Adapter] Error getting LP token price:", error);
      return null;
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Get perpetuals PDA
   */
  private getPerpetualsPDA(): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("perpetuals")],
      this.program.programId
    )[0];
  }

  /**
   * Get cluster account (from Arcium environment or config)
   */
  private getClusterAccount(): PublicKey {
    const arciumEnv = getArciumEnv();
    return arciumEnv.arciumClusterPubkey;
  }

  /**
   * Set default pool account
   */
  setDefaultPool(pool: PublicKey): void {
    this.defaultPool = pool;
  }

  /**
   * Set default custody account
   */
  setDefaultCustody(custody: PublicKey): void {
    this.defaultCustody = custody;
  }

  /**
   * Set default collateral custody account
   */
  setDefaultCollateralCustody(custody: PublicKey): void {
    this.defaultCollateralCustody = custody;
  }

  /**
   * Get encryption context (for advanced usage)
   */
  getEncryptionContext(): any {
    return this.encryptionContext;
  }
}
