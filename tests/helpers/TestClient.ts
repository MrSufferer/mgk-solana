import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { Blackjack } from "../../target/types/blackjack";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";

export class TestClient {
  program: Program<Blackjack>;
  provider: anchor.AnchorProvider;
  admin: Keypair;
  printErrors: boolean = false;

  perpetualsAccount: PublicKey;
  multisigAccount: PublicKey;
  transferAuthorityAccount: PublicKey;

  pools: Map<string, PoolInfo> = new Map();
  custodies: Map<string, CustodyInfo> = new Map();
  users: UserInfo[] = [];

  constructor(
    program: Program<Blackjack>,
    provider: anchor.AnchorProvider,
    admin: Keypair
  ) {
    this.program = program;
    this.provider = provider;
    this.admin = admin;

    [this.perpetualsAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("perpetuals")],
      program.programId
    );

    [this.multisigAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("multisig")],
      program.programId
    );

    [this.transferAuthorityAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("transfer_authority")],
      program.programId
    );
  }

  async init(params?: InitParams): Promise<void> {
    const defaultParams = {
      minSignatures: 1,
      allowSwap: true,
      allowAddLiquidity: true,
      allowRemoveLiquidity: true,
      allowOpenPosition: true,
      allowClosePosition: true,
      allowPnlWithdrawal: true,
      allowCollateralWithdrawal: true,
      allowSizeChange: true,
    };

    const finalParams = { ...defaultParams, ...params };

    try {
      await this.program.account.perpetuals.fetch(this.perpetualsAccount);
      console.log("Perpetuals already initialized");
      return;
    } catch (e) {
      console.log("Initializing perpetuals...");
    }

    const programDataAddress = PublicKey.findProgramAddressSync(
      [this.program.programId.toBuffer()],
      new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111")
    )[0];

    await this.program.methods
      .init({
        minSignatures: finalParams.minSignatures,
        allowSwap: finalParams.allowSwap,
        allowAddLiquidity: finalParams.allowAddLiquidity,
        allowRemoveLiquidity: finalParams.allowRemoveLiquidity,
        allowOpenPosition: finalParams.allowOpenPosition,
        allowClosePosition: finalParams.allowClosePosition,
        allowPnlWithdrawal: finalParams.allowPnlWithdrawal,
        allowCollateralWithdrawal: finalParams.allowCollateralWithdrawal,
        allowSizeChange: finalParams.allowSizeChange,
      })
      .accountsPartial({
        upgradeAuthority: this.admin.publicKey,
        perpetualsProgramData: programDataAddress,
        perpetualsProgram: this.program.programId,
        perpetuals: this.perpetualsAccount,
        multisig: this.multisigAccount,
        transferAuthority: this.transferAuthorityAccount,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([this.admin])
      .rpc();

    console.log("Perpetuals initialized");
  }

  async addPool(params: AddPoolParams): Promise<PoolInfo> {
    // Get current pool count to derive correct PDA
    const perpetualsData = await this.program.account.perpetuals.fetch(this.perpetualsAccount);
    const poolIndex = perpetualsData.pools.length;
    
    // Pool PDA uses index, not name
    const poolIndexBuffer = Buffer.alloc(8);
    poolIndexBuffer.writeUInt32LE(poolIndex, 0);
    
    const poolAccount = PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), poolIndexBuffer],
      this.program.programId
    )[0];

    const lpTokenMint = PublicKey.findProgramAddressSync(
      [Buffer.from("lp_token_mint"), poolAccount.toBuffer()],
      this.program.programId
    )[0];

    try {
      await this.program.account.pool.fetch(poolAccount);
      console.log(`Pool ${params.name} already exists`);
      const poolInfo: PoolInfo = {
        name: params.name,
        account: poolAccount,
        lpTokenMint: lpTokenMint,
      };
      this.pools.set(params.name, poolInfo);
      return poolInfo;
    } catch (e) {
      console.log(`Adding pool ${params.name}...`);
    }

    await this.program.methods
      .addPool({ name: params.name })
      .accountsPartial({
        admin: this.admin.publicKey,
        multisig: this.multisigAccount,
        perpetuals: this.perpetualsAccount,
        transferAuthority: this.transferAuthorityAccount,
        pool: poolAccount,
        lpTokenMint: lpTokenMint,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([this.admin])
      .rpc();

    const poolInfo: PoolInfo = {
      name: params.name,
      account: poolAccount,
      lpTokenMint: lpTokenMint,
    };
    this.pools.set(params.name, poolInfo);

    console.log(`Pool ${params.name} added`);
    return poolInfo;
  }

  async addCustody(params: AddCustodyParams): Promise<CustodyInfo> {
    const poolInfo = this.pools.get(params.poolName);
    if (!poolInfo) {
      throw new Error(`Pool ${params.poolName} not found`);
    }

    let tokenMint: PublicKey;
    if (params.mint) {
      tokenMint = params.mint;
    } else {
      tokenMint = await createMint(
        this.provider.connection,
        this.admin,
        this.admin.publicKey,
        null,
        params.decimals || 6
      );
      console.log(`Created token mint: ${tokenMint.toString()}`);
    }

    const custodyAccount = PublicKey.findProgramAddressSync(
      [Buffer.from("custody"), poolInfo.account.toBuffer(), tokenMint.toBuffer()],
      this.program.programId
    )[0];

    const custodyTokenAccount = PublicKey.findProgramAddressSync(
      [Buffer.from("custody_token_account"), poolInfo.account.toBuffer(), tokenMint.toBuffer()],
      this.program.programId
    )[0];

    try {
      await this.program.account.custody.fetch(custodyAccount);
      console.log(`Custody for ${params.symbol} already exists`);
      const custodyInfo: CustodyInfo = {
        symbol: params.symbol,
        mint: tokenMint,
        account: custodyAccount,
        tokenAccount: custodyTokenAccount,
        oracleAccount: params.oracleAccount || this.admin.publicKey,
        poolName: params.poolName,
      };
      this.custodies.set(`${params.poolName}-${params.symbol}`, custodyInfo);
      return custodyInfo;
    } catch (e) {
      console.log(`Adding custody for ${params.symbol}...`);
    }

    const oracleAccount = params.oracleAccount || this.admin.publicKey;

    await this.program.methods
      .addCustody({
        isStable: params.isStable || false,
        isVirtual: false,
        oracle: {
          oracleAccount: oracleAccount,
          oracleType: { custom: {} },
          oracleAuthority: this.admin.publicKey,
          maxPriceError: new anchor.BN(1000000),
          maxPriceAgeSec: 60,
        },
        pricing: {
          useEma: false,
          useUnrealizedPnlInAum: false,
          tradeSpreadLong: new anchor.BN(100),
          tradeSpreadShort: new anchor.BN(100),
          swapSpread: new anchor.BN(100),
          minInitialLeverage: new anchor.BN(10000),
          maxInitialLeverage: new anchor.BN(100000),
          maxLeverage: new anchor.BN(100000),
          maxPayoffMult: new anchor.BN(10000),
          maxUtilization: new anchor.BN(800000),
          maxPositionLockedUsd: new anchor.BN("18446744073709551615"),
          maxTotalLockedUsd: new anchor.BN("18446744073709551615"),
        },
        permissions: {
          allowSwap: true,
          allowAddLiquidity: true,
          allowRemoveLiquidity: true,
          allowOpenPosition: true,
          allowClosePosition: true,
          allowPnlWithdrawal: true,
          allowCollateralWithdrawal: true,
          allowSizeChange: true,
        },
        fees: {
          mode: { linear: {} },
          ratioMult: new anchor.BN(10000),
          utilizationMult: new anchor.BN(10000),
          swapIn: new anchor.BN(100),
          swapOut: new anchor.BN(100),
          stableSwapIn: new anchor.BN(50),
          stableSwapOut: new anchor.BN(50),
          addLiquidity: new anchor.BN(100),
          removeLiquidity: new anchor.BN(100),
          openPosition: new anchor.BN(100),
          closePosition: new anchor.BN(100),
          liquidation: new anchor.BN(500),
          protocolShare: new anchor.BN(1000),
          feeMax: new anchor.BN(50000),
          feeOptimal: new anchor.BN(100),
        },
        borrowRate: {
          baseRate: new anchor.BN(0),
          slope1: new anchor.BN(80000),
          slope2: new anchor.BN(120000),
          optimalUtilization: new anchor.BN(800000),
        },
        ratios: [
          {
            target: new anchor.BN(10000),
            min: new anchor.BN(0),
            max: new anchor.BN(100000),
          },
        ],
      })
      .accountsPartial({
        admin: this.admin.publicKey,
        multisig: this.multisigAccount,
        perpetuals: this.perpetualsAccount,
        pool: poolInfo.account,
        custody: custodyAccount,
        custodyTokenAccount: custodyTokenAccount,
        custodyTokenMint: tokenMint,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([this.admin])
      .rpc();

    const custodyInfo: CustodyInfo = {
      symbol: params.symbol,
      mint: tokenMint,
      account: custodyAccount,
      tokenAccount: custodyTokenAccount,
      oracleAccount: oracleAccount,
      poolName: params.poolName,
    };
    this.custodies.set(`${params.poolName}-${params.symbol}`, custodyInfo);

    console.log(`Custody for ${params.symbol} added`);
    return custodyInfo;
  }

  async setCustomOraclePrice(params: SetOraclePriceParams): Promise<void> {
    const custodyInfo = this.custodies.get(`${params.poolName}-${params.symbol}`);
    if (!custodyInfo) {
      throw new Error(`Custody ${params.poolName}-${params.symbol} not found`);
    }

    // Derive custom oracle PDA
    const customOracle = PublicKey.findProgramAddressSync(
      [Buffer.from("custom_oracle"), custodyInfo.account.toBuffer()],
      this.program.programId
    )[0];

    await this.program.methods
      .setCustomOraclePrice({
        price: params.price,
        expo: params.expo || -8,
        conf: params.conf || new anchor.BN(0),
        ema: params.price,
        publishTime: params.publishTime || new anchor.BN(Date.now() / 1000),
      })
      .accountsPartial({
        admin: this.admin.publicKey,
        customOracle: customOracle,
        custody: custodyInfo.account,
        systemProgram: SystemProgram.programId,
      })
      .signers([this.admin])
      .rpc();

    // Update the custodyInfo to point to the new custom oracle
    custodyInfo.oracleAccount = customOracle;
    this.custodies.set(`${params.poolName}-${params.symbol}`, custodyInfo);

    console.log(`Oracle price set for ${params.symbol}: ${params.price.toString()}`);
  }

  async mintTokensToUser(
    user: PublicKey,
    custodyInfo: CustodyInfo,
    amount: anchor.BN
  ): Promise<PublicKey> {
    const userTokenAccount = await getOrCreateAssociatedTokenAccount(
      this.provider.connection,
      this.admin,
      custodyInfo.mint,
      user
    );

    await mintTo(
      this.provider.connection,
      this.admin,
      custodyInfo.mint,
      userTokenAccount.address,
      this.admin,
      amount.toNumber()
    );

    console.log(`Minted ${amount.toString()} tokens to user`);
    return userTokenAccount.address;
  }

  getPositionAccount(
    owner: PublicKey,
    poolName: string,
    symbol: string,
    positionId: anchor.BN
  ): PublicKey {
    const poolInfo = this.pools.get(poolName);
    const custodyInfo = this.custodies.get(`${poolName}-${symbol}`);
    
    if (!poolInfo || !custodyInfo) {
      throw new Error(`Pool or custody not found`);
    }

    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        owner.toBuffer(),
        poolInfo.account.toBuffer(),
        custodyInfo.account.toBuffer(),
        positionId.toArrayLike(Buffer, "le", 8),
      ],
      this.program.programId
    )[0];
  }

  // ============ Helper Methods (from original perpetuals) ============

  /**
   * Initialize test fixture with users and test accounts
   */
  async initFixture(numUsers: number = 2): Promise<void> {
    console.log("Initializing test fixture...");

    // Create test users
    for (let i = 0; i < numUsers; i++) {
      const wallet = Keypair.generate();
      const userInfo: UserInfo = {
        wallet,
        tokenAccounts: new Map(),
      };
      this.users.push(userInfo);

      // Airdrop SOL to user
      await this.airdrop(wallet.publicKey);
      console.log(`Created user ${i} with wallet: ${wallet.publicKey.toString()}`);
    }

    // Airdrop to admin
    await this.airdrop(this.admin.publicKey);
    console.log("Test fixture initialized");
  }

  /**
   * Generate a custody configuration (for testing)
   */
  generateCustody(decimals: number, symbol: string): {
    mint: Keypair;
    tokenAccount: PublicKey;
    oracleAccount: PublicKey;
    custody: PublicKey;
    decimals: number;
    symbol: string;
  } {
    const mint = Keypair.generate();
    
    // These will be derived when addCustody is called
    // For now, return dummy values that will be replaced
    const poolAccount = this.pools.values().next().value?.account || PublicKey.default;
    
    const tokenAccount = PublicKey.findProgramAddressSync(
      [Buffer.from("custody_token_account"), poolAccount.toBuffer(), mint.publicKey.toBuffer()],
      this.program.programId
    )[0];

    const oracleAccount = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle_account"), poolAccount.toBuffer(), mint.publicKey.toBuffer()],
      this.program.programId
    )[0];

    const custody = PublicKey.findProgramAddressSync(
      [Buffer.from("custody"), poolAccount.toBuffer(), mint.publicKey.toBuffer()],
      this.program.programId
    )[0];

    return {
      mint,
      tokenAccount,
      oracleAccount,
      custody,
      decimals,
      symbol,
    };
  }

  /**
   * Request SOL airdrop
   */
  async airdrop(pubkey: PublicKey, amount: number = 2_000_000_000): Promise<void> {
    const balance = await this.getSolBalance(pubkey);
    if (balance < amount / 2) {
      try {
        const signature = await this.provider.connection.requestAirdrop(pubkey, amount);
        await this.confirmTx(signature);
        console.log(`Airdropped ${amount / 1e9} SOL to ${pubkey.toString()}`);
      } catch (err) {
        if (this.printErrors) {
          console.log("Airdrop failed:", err);
        }
      }
    }
  }

  /**
   * Mint tokens to a wallet
   */
  async mintTokens(
    uiAmount: number,
    decimals: number,
    mint: PublicKey,
    destination: PublicKey
  ): Promise<void> {
    await mintTo(
      this.provider.connection,
      this.admin,
      mint,
      destination,
      this.admin,
      this.toTokenAmount(uiAmount, decimals).toNumber()
    );
  }

  /**
   * Get token balance
   */
  async getBalance(pubkey: PublicKey): Promise<number> {
    try {
      const accountInfo = await this.provider.connection.getTokenAccountBalance(pubkey);
      return Number(accountInfo.value.amount);
    } catch {
      return 0;
    }
  }

  /**
   * Get SOL balance
   */
  async getSolBalance(pubkey: PublicKey): Promise<number> {
    try {
      return await this.provider.connection.getBalance(pubkey);
    } catch {
      return 0;
    }
  }

  /**
   * Convert UI amount to token amount
   */
  toTokenAmount(uiAmount: number, decimals: number): anchor.BN {
    return new anchor.BN(uiAmount * 10 ** decimals);
  }

  /**
   * Convert token amount to UI amount
   */
  toUiAmount(tokenAmount: number, decimals: number): number {
    return tokenAmount / 10 ** decimals;
  }

  /**
   * Confirm transaction
   */
  async confirmTx(txSignature: string): Promise<void> {
    const latestBlockHash = await this.provider.connection.getLatestBlockhash();
    await this.provider.connection.confirmTransaction(
      {
        blockhash: latestBlockHash.blockhash,
        lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
        signature: txSignature,
      },
      "confirmed"
    );
  }

  /**
   * Confirm transaction and log details
   */
  async confirmAndLogTx(txSignature: string): Promise<void> {
    await this.confirmTx(txSignature);
    const tx = await this.provider.connection.getTransaction(txSignature, {
      commitment: "confirmed",
    });
    console.log("Transaction:", tx);
  }

  /**
   * Ensure a promise fails (for negative testing)
   */
  async ensureFails(promise: Promise<any>, message?: string): Promise<Error> {
    const printErrors = this.printErrors;
    this.printErrors = false;
    let error: Error | null = null;
    
    try {
      await promise;
    } catch (err) {
      error = err as Error;
    }
    
    this.printErrors = printErrors;
    
    if (!error) {
      throw new Error(message || "Expected transaction to fail but it succeeded");
    }
    
    return error;
  }

  /**
   * Get current time (Unix timestamp)
   */
  getTime(): number {
    const now = new Date();
    const utcMilliseconds = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
    return utcMilliseconds / 1000;
  }

  /**
   * Pretty print object (for debugging)
   */
  prettyPrint(obj: any): void {
    console.log(JSON.stringify(obj, null, 2));
  }

  /**
   * Log message
   */
  log(message: string): void {
    console.log(`[TestClient] ${message}`);
  }
}

export interface InitParams {
  minSignatures?: number;
  allowSwap?: boolean;
  allowAddLiquidity?: boolean;
  allowRemoveLiquidity?: boolean;
  allowOpenPosition?: boolean;
  allowClosePosition?: boolean;
  allowPnlWithdrawal?: boolean;
  allowCollateralWithdrawal?: boolean;
  allowSizeChange?: boolean;
}

export interface AddPoolParams {
  name: string;
}

export interface AddCustodyParams {
  poolName: string;
  symbol: string;
  mint?: PublicKey;
  decimals?: number;
  isStable?: boolean;
  oracleAccount?: PublicKey;
}

export interface SetOraclePriceParams {
  poolName: string;
  symbol: string;
  price: anchor.BN;
  expo?: number;
  conf?: anchor.BN;
  publishTime?: anchor.BN;
}

export interface PoolInfo {
  name: string;
  account: PublicKey;
  lpTokenMint: PublicKey;
}

export interface CustodyInfo {
  symbol: string;
  mint: PublicKey;
  account: PublicKey;
  tokenAccount: PublicKey;
  oracleAccount: PublicKey;
  poolName: string;
  decimals?: number;
}

export interface UserInfo {
  wallet: Keypair;
  tokenAccounts: Map<string, PublicKey>;
  lpTokenAccount?: PublicKey;
}
