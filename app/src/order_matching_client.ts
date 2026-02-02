import {
  setProvider,
  Program,
  AnchorProvider,
  workspace,
  utils,
  BN,
} from "@coral-xyz/anchor";
import { Perpetuals } from "../../target/types/perpetuals";
import {
  PublicKey,
  SystemProgram,
  Keypair,
  SYSVAR_RENT_PUBKEY,
  AccountMeta,
} from "@solana/web3.js";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { encryptOrderSize, decryptTraderState } from "./encryption";

export interface OrderParams {
  marketId: number;
  price: number;
  side: "Buy" | "Sell";
  size: number;
  orderType?: "Limit" | "Market" | "IOC" | "PostOnly";
  timeInForce?: "GTT" | "IOC" | "PostOnly";
}

export interface MarketState {
  marketId: number;
  baseAssetMint: PublicKey;
  quoteAssetMint: PublicKey;
  tickSize: BN;
  minOrderSize: BN;
  maxOrderSize: BN;
  makerFeeBps: number;
  takerFeeBps: number;
  markPrice: BN;
  indexPrice: BN;
  fundingRate: BN;
  currentEpochId: BN;
  status: { active?: {}; paused?: {}; expired?: {} };
}

export interface TraderState {
  trader: PublicKey;
  marginMode: { cross?: {}; isolated?: {} };
  hasOpenPositions: boolean;
  collateralAccount: PublicKey;
}

export interface FillEvent {
  marketId: number;
  epochId: BN;
  taker: PublicKey;
  maker: PublicKey;
  side: { buy?: {}; sell?: {} };
  price: BN;
  slot: BN;
}

export class OrderMatchingClient {
  provider: AnchorProvider;
  program: Program<Perpetuals>;
  wallet: Keypair;

  constructor(clusterUrl: string, walletKey: string | Keypair) {
    this.provider = AnchorProvider.local(clusterUrl, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });

    setProvider(this.provider);

    this.program = workspace.Perpetuals as Program<Perpetuals>;

    if (walletKey instanceof Keypair) {
      this.wallet = walletKey;
    } else {
      const fs = require("fs");
      this.wallet = Keypair.fromSecretKey(
        new Uint8Array(JSON.parse(fs.readFileSync(walletKey).toString()))
      );
    }
  }

  /**
   * Get market state PDA
   */
  getMarketStatePDA(marketId: number): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), Buffer.from([marketId & 0xff, (marketId >> 8) & 0xff])],
      this.program.programId
    );
    return pda;
  }

  /**
   * Get trader state PDA
   */
  getTraderStatePDA(trader: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("trader"), trader.toBuffer()],
      this.program.programId
    );
    return pda;
  }

  /**
   * Get epoch state PDA
   */
  getEpochStatePDA(marketId: number, epochId: number): PublicKey {
    const epochIdBuffer = Buffer.allocUnsafe(8);
    epochIdBuffer.writeBigUInt64LE(BigInt(epochId), 0);
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("epoch"),
        Buffer.from([marketId & 0xff, (marketId >> 8) & 0xff]),
        epochIdBuffer,
      ],
      this.program.programId
    );
    return pda;
  }

  /**
   * Initialize market
   */
  async initializeMarket(params: {
    marketId: number;
    baseAssetMint: PublicKey;
    quoteAssetMint: PublicKey;
    tickSize: number;
    minOrderSize: number;
    maxOrderSize: number;
    makerFeeBps: number;
    takerFeeBps: number;
    epochDurationSlots: number;
  }): Promise<string> {
    const marketStatePDA = this.getMarketStatePDA(params.marketId);

    const tx = await this.program.methods
      .initializeMarket(
        params.marketId,
        params.baseAssetMint,
        params.quoteAssetMint,
        new BN(params.tickSize),
        new BN(params.minOrderSize),
        new BN(params.maxOrderSize),
        params.makerFeeBps,
        params.takerFeeBps,
        new BN(params.epochDurationSlots)
      )
      .accounts({
        admin: this.wallet.publicKey,
        marketState: marketStatePDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  /**
   * Initialize trader state
   */
  async initializeTraderState(marginMode: "Cross" | "Isolated"): Promise<string> {
    const traderStatePDA = this.getTraderStatePDA(this.wallet.publicKey);
    const confidentialAccountPDA = PublicKey.findProgramAddressSync(
      [Buffer.from("confidential_account"), this.wallet.publicKey.toBuffer()],
      this.program.programId
    )[0];

    const tx = await this.program.methods
      .initializeTraderState(marginMode === "Cross" ? { cross: {} } : { isolated: {} })
      .accounts({
        trader: this.wallet.publicKey,
        traderState: traderStatePDA,
        confidentialAccount: confidentialAccountPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  /**
   * Deposit collateral (public SPL → Confidential SPL)
   */
  async depositCollateralConfidential(
    amount: number,
    mint: PublicKey
  ): Promise<string> {
    const traderStatePDA = this.getTraderStatePDA(this.wallet.publicKey);
    const traderTokenAccount = await getAssociatedTokenAddress(
      mint,
      this.wallet.publicKey
    );

    // Get vault PDA (simplified - in real implementation would use proper seeds)
    const vaultPDA = PublicKey.findProgramAddressSync(
      [Buffer.from("confidential_vault"), mint.toBuffer()],
      this.program.programId
    )[0];

    const tx = await this.program.methods
      .depositCollateralConfidential(new BN(amount))
      .accounts({
        trader: this.wallet.publicKey,
        traderState: traderStatePDA,
        traderTokenAccount: traderTokenAccount,
        vaultAccount: vaultPDA,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    return tx;
  }

  /**
   * Submit order with encrypted size
   */
  async submitOrder(params: OrderParams): Promise<string> {
    const traderStatePDA = this.getTraderStatePDA(this.wallet.publicKey);
    const marketStatePDA = this.getMarketStatePDA(params.marketId);

    // Get current epoch ID (simplified - would need to fetch from market state)
    const marketState = await this.program.account.marketState.fetch(marketStatePDA);
    const currentEpochId = (marketState.currentEpochId as BN).toNumber();

    const epochStatePDA = this.getEpochStatePDA(params.marketId, currentEpochId);

    // Encrypt order size
    const encSize = await encryptOrderSize(BigInt(params.size));

    const tx = await this.program.methods
      .submitOrder(
        new BN(params.price),
        params.side === "Buy" ? { buy: {} } : { sell: {} },
        Array.from(encSize),
        params.orderType === "Limit"
          ? { limit: {} }
          : params.orderType === "Market"
          ? { market: {} }
          : params.orderType === "IOC"
          ? { ioc: {} }
          : { postOnly: {} },
        params.timeInForce === "GTT"
          ? { gtt: {} }
          : params.timeInForce === "IOC"
          ? { ioc: {} }
          : { postOnly: {} }
      )
      .accounts({
        trader: this.wallet.publicKey,
        traderState: traderStatePDA,
        marketState: marketStatePDA,
        epochState: epochStatePDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  /**
   * Get trader state and decrypt
   */
  async getTraderState(): Promise<TraderState> {
    const traderStatePDA = this.getTraderStatePDA(this.wallet.publicKey);
    const account = await this.program.account.traderState.fetch(traderStatePDA);
    return account as unknown as TraderState;
  }

  /**
   * Get market state
   */
  async getMarketState(marketId: number): Promise<MarketState> {
    const marketStatePDA = this.getMarketStatePDA(marketId);
    const account = await this.program.account.marketState.fetch(marketStatePDA);
    return account as unknown as MarketState;
  }

  /**
   * Settle epoch
   */
  async settleEpoch(marketId: number, epochId: number, computationOffset: number): Promise<string> {
    const marketStatePDA = this.getMarketStatePDA(marketId);
    const epochStatePDA = this.getEpochStatePDA(marketId, epochId);

    const tx = await this.program.methods
      .settleEpoch(new BN(computationOffset))
      .accounts({
        payer: this.wallet.publicKey,
        marketState: marketStatePDA,
        epochState: epochStatePDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }
}

