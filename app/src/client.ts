
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
import { readFileSync } from "fs";
import {
  TokenRatio,
  PositionSide,
  InitParams,
  OracleParams,
  PricingParams,
  Permissions,
  Fees,
  BorrowRateParams,
  SetCustomOraclePriceParams,
  AmountAndFee,
  NewPositionPricesAndFee,
  PriceAndFee,
  ProfitAndLoss,
  SwapAmountAndFees,
} from "./types";

export class PerpetualsClient {
  provider: AnchorProvider;
  program: Program<Perpetuals>;
  admin: Keypair;

  multisig: { publicKey: PublicKey; bump: number };
  authority: { publicKey: PublicKey; bump: number };
  perpetuals: { publicKey: PublicKey; bump: number };

  constructor(clusterUrl: string, adminKey: string) {
    this.provider = AnchorProvider.local(clusterUrl, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });

    setProvider(this.provider);

    this.program = workspace.Perpetuals as Program<Perpetuals>;

    this.admin = Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(readFileSync(adminKey).toString()))
    );

    this.multisig = this.findProgramAddress("multisig");
    this.authority = this.findProgramAddress("transfer_authority");
    this.perpetuals = this.findProgramAddress("perpetuals");

    BN.prototype.toJSON = function () {
      return this.toString(10);
    };
  }

  findProgramAddress = (
    label: string,
    extraSeeds?: (string | number[] | Uint8Array | PublicKey) | (string | number[] | Uint8Array | PublicKey)[]
  ): {
    publicKey: PublicKey;
    bump: number;
  } => {
    const seeds = [Buffer.from(utils.bytes.utf8.encode(label))];

    const seedItems =
      extraSeeds === undefined
        ? []
        : Array.isArray(extraSeeds)
        ? extraSeeds
        : [extraSeeds];

    for (const extraSeed of seedItems) {
      if (typeof extraSeed === "string") {
        seeds.push(Buffer.from(utils.bytes.utf8.encode(extraSeed)));
      } else if (extraSeed instanceof PublicKey) {
        seeds.push(extraSeed.toBuffer());
      } else if (Buffer.isBuffer(extraSeed)) {
        seeds.push(extraSeed);
      } else if (extraSeed instanceof Uint8Array) {
        seeds.push(Buffer.from(extraSeed));
      } else if (Array.isArray(extraSeed)) {
        seeds.push(Buffer.from(extraSeed));
      } else {
        // This should never happen with the current type definition
        throw new Error(`Unsupported seed type: ${typeof extraSeed}`);
      }
    }

    const [publicKey, bump] = PublicKey.findProgramAddressSync(
      seeds,
      this.program.programId
    );

    return { publicKey, bump };
  };

  adjustTokenRatios = (ratios: TokenRatio[]): TokenRatio[] => {
    if (ratios.length === 0) {
      return ratios;
    }

    const target = Math.floor(10_000 / ratios.length);

    for (const ratio of ratios) {
      ratio.target = new BN(target);
    }

    if (10_000 % ratios.length !== 0) {
      ratios[ratios.length - 1].target = new BN(
        target + (10_000 % ratios.length)
      );
    }

    return ratios;
  };

  getPerpetuals = async () => {
    try {
      return await this.program.account.perpetuals.fetch(this.perpetuals.publicKey);
    } catch (e) {
      throw new Error(
        `Perpetuals account does not exist at ${this.perpetuals.publicKey.toBase58()}.\n` +
        `You must initialize the perpetuals protocol first by running:\n` +
        `  npx ts-node src/cli.ts -k <keypair> init --min-signatures 1 <admin-address>\n` +
        `Where <admin-address> is your admin public key (e.g., $(solana address))`
      );
    }
  };

  getPoolKeyByIndex = (index: number): PublicKey => {
    const poolIndexBuffer = Buffer.alloc(8);
    poolIndexBuffer.writeUInt32LE(index, 0);
    return this.findProgramAddress("pool", poolIndexBuffer).publicKey;
  };

  getPoolIndexByName = async (name: string): Promise<number> => {
    const perpetuals = await this.getPerpetuals();
    
    // First check pools in the perpetuals.pools array
    for (let i = 0; i < perpetuals.pools.length; ++i) {
      try {
        const pool = await this.program.account.pool.fetch(perpetuals.pools[i]);
        const poolName = (pool.name as any).toString ? (pool.name as any).toString() : String(pool.name);
        if (poolName === name) return i;
      } catch (e) {
        this.log(`Failed to fetch pool at index ${i}: ${e}`);
      }
    }
    
    // If not found in array, scan actual pool accounts to find the index
    this.log(`Pool '${name}' not found in perpetuals.pools array, scanning pool accounts...`);
    for (let i = 0; i < 100; i++) {
      const poolIndexBuffer = Buffer.alloc(8);
      poolIndexBuffer.writeUInt32LE(i, 0);
      const poolKey = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), poolIndexBuffer],
        this.program.programId
      )[0];
      
      try {
        const pool = await this.program.account.pool.fetch(poolKey);
        const poolName = (pool.name as any).toString ? (pool.name as any).toString() : String(pool.name);
        if (poolName === name) {
          this.log(`Found pool '${name}' at index ${i} (not in perpetuals.pools array)`);
          return i;
        }
      } catch (e) {
        // Pool doesn't exist at this index, continue
      }
    }
    
    throw new Error(`Pool with name '${name}' not found`);
  };

  getPoolKey = async (name: string): Promise<PublicKey> => {
    const i = await this.getPoolIndexByName(name);
    return this.getPoolKeyByIndex(i);
  };

  getNextPoolKey = async (): Promise<PublicKey> => {
    const perpetualsData = await this.getPerpetuals();
    const poolIndex = perpetualsData.pools.length;
    this.log(`Current pools count in perpetuals account: ${poolIndex}`);
    
    // The program derives the pool account using perpetuals.pools.len() as the seed
    // So we MUST use the same index - we can't use a different one
    const poolIndexBuffer = Buffer.alloc(8);
    poolIndexBuffer.writeUInt32LE(poolIndex, 0);
    const nextPoolKey = PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), poolIndexBuffer],
      this.program.programId
    )[0];
    
    // Check if this pool already exists (which indicates a sync issue)
    try {
      const existingPool = await this.program.account.pool.fetch(nextPoolKey);
      const poolName = (existingPool.name as any).toString ? (existingPool.name as any).toString() : String(existingPool.name);
      
      // Pool exists but isn't in perpetuals.pools array - this is a sync issue
      // We need to either:
      // 1. Remove the existing pool account, OR
      // 2. Manually add it to perpetuals.pools array (if there's an instruction for that)
      // For now, we'll throw a helpful error
      throw new Error(
        `Cannot add pool: Pool account at index ${poolIndex} already exists: ${nextPoolKey.toBase58()} (name: ${poolName}).\n` +
        `This indicates the perpetuals.pools array is out of sync with actual pool accounts.\n\n` +
        `SOLUTION OPTIONS:\n` +
        `1. Reset your test environment (recommended for localnet):\n` +
        `   anchor localnet down && anchor localnet up\n\n` +
        `2. Manually close/remove the existing pool account at ${nextPoolKey.toBase58()}\n\n` +
        `3. If you have admin access, you may be able to sync the pools array (check if there's a sync instruction)`
      );
    } catch (e) {
      if (e instanceof Error && (e.message.includes('Cannot add pool') || e.message.includes('already exists'))) {
        throw e;
      }
      // Pool doesn't exist, which is what we want - continue
    }
    
    this.log(`Next pool key will be: ${nextPoolKey.toBase58()} (index ${poolIndex})`);
    return nextPoolKey;
  };

  getPool = async (name: string) => {
    const perpetuals = await this.getPerpetuals();
    this.log(`Searching for pool '${name}' in ${perpetuals.pools.length} pools`);
    
    // First, check pools in the perpetuals.pools array
    for (const poolAddress of perpetuals.pools) {
      try {
        const pool = await this.program.account.pool.fetch(poolAddress);
        const poolName = (pool.name as any).toString ? (pool.name as any).toString() : String(pool.name);
        this.log(`Found pool: '${poolName}' at ${poolAddress.toBase58()}`);
        if (poolName === name) {
          this.log(`Pool key: ${poolAddress.toBase58()}`);
          return pool;
        }
      } catch (e) {
        this.log(`Failed to fetch pool at ${poolAddress.toBase58()}: ${e}`);
      }
    }
    
    // If not found in array, scan actual pool accounts (handles sync issues)
    this.log(`Pool not found in perpetuals.pools array, scanning actual pool accounts...`);
    for (let i = 0; i < 100; i++) {
      const poolIndexBuffer = Buffer.alloc(8);
      poolIndexBuffer.writeUInt32LE(i, 0);
      const poolKey = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), poolIndexBuffer],
        this.program.programId
      )[0];
      
      try {
        const pool = await this.program.account.pool.fetch(poolKey);
        const poolName = (pool.name as any).toString ? (pool.name as any).toString() : String(pool.name);
        this.log(`Found pool account at index ${i}: '${poolName}' at ${poolKey.toBase58()}`);
        if (poolName === name) {
          this.log(`Pool key: ${poolKey.toBase58()} (found by scanning, not in perpetuals.pools array)`);
          return pool;
        }
      } catch (e) {
        // Pool doesn't exist at this index, continue
      }
    }
    
    throw new Error(`Pool with name '${name}' not found. Available pools in array: ${perpetuals.pools.map((p, i) => `pool[${i}]=${p.toBase58()}`).join(', ') || 'none'}`);
  };

  getPools = async () => {
    const perpetuals = await this.getPerpetuals();
    return this.program.account.pool.fetchMultiple(perpetuals.pools);
  };

  getPoolLpTokenKey = async (name: string): Promise<PublicKey> => {
    const poolKey = await this.getPoolKey(name);
    return this.findProgramAddress("lp_token_mint", [poolKey]).publicKey;
  };

  getCustodyKey = async (poolName: string, tokenMint: PublicKey): Promise<PublicKey> => {
    const poolKey = await this.getPoolKey(poolName);
    return this.findProgramAddress("custody", [poolKey, tokenMint]).publicKey;
  };

  getCustodyTokenAccountKey = async (
    poolName: string,
    tokenMint: PublicKey
  ): Promise<PublicKey> => {
    const poolKey = await this.getPoolKey(poolName);
    return this.findProgramAddress("custody_token_account", [poolKey, tokenMint]).publicKey;
  };

  getCustodyCustomOracleAccountKey = async (
    poolName: string,
    tokenMint: PublicKey
  ): Promise<PublicKey> => {
    const poolKey = await this.getPoolKey(poolName);
    return this.findProgramAddress("oracle_account", [poolKey, tokenMint]).publicKey;
  };

  getCustody = async (poolName: string, tokenMint: PublicKey) => {
    return this.program.account.custody.fetch(
      await this.getCustodyKey(poolName, tokenMint)
    );
  };

  getCustodies = async (poolName: string) => {
    const pool = await this.getPool(poolName);
    const custodies = await this.program.account.custody.fetchMultiple(
      pool.custodies
    );

    if (custodies.some((custody) => !custody)) {
      throw new Error("Error loading custodies");
    }

    return custodies;
  };

  getCustodyMetas = async (poolName: string): Promise<AccountMeta[]> => {
    const pool = await this.getPool(poolName);
    const custodies = await this.program.account.custody.fetchMultiple(
      pool.custodies
    );

    if (custodies.some((custody) => !custody)) {
      throw new Error("Error loading custodies");
    }

    const custodyMetas: AccountMeta[] = [];

    for (const custody of pool.custodies) {
      custodyMetas.push({
        isSigner: false,
        isWritable: false,
        pubkey: custody,
      });
    }

    const presentCustodies = custodies.filter((c): c is NonNullable<typeof c> => Boolean(c));
    for (const custody of presentCustodies) {
      custodyMetas.push({
        isSigner: false,
        isWritable: false,
        pubkey: custody.oracle.oracleAccount,
      });
    }

    return custodyMetas;
  };

  getMultisig = async () => {
    return this.program.account.multisig.fetch(this.multisig.publicKey);
  };

  getTime(): number {
    const now = new Date();
    const utcMilliseconds = now.getTime() + now.getTimezoneOffset() * 60 * 1_000;
    return utcMilliseconds / 1_000;
  }

  log = (...messages: string[]): void => {
    const date = new Date();
    const dateStr = date.toDateString();
    const time = date.toLocaleTimeString();
    console.log(`[${dateStr} ${time}] ${messages.join(", ")}`);
  };

  prettyPrint = (v: any): void => {
    console.log(JSON.stringify(v, null, 2));
  };


  init = async (admins: PublicKey[], config: InitParams): Promise<void> => {
    const perpetualsProgramData = PublicKey.findProgramAddressSync(
      [this.program.programId.toBuffer()],
      new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111")
    )[0];

    const adminMetas = [];

    for (const admin of admins) {
      adminMetas.push({
        isSigner: false,
        isWritable: false,
        pubkey: admin,
      });
    }

    await this.program.methods
      .init(config)
      .accountsPartial({
        upgradeAuthority: this.provider.wallet.publicKey,
        perpetualsProgramData,
        perpetualsProgram: this.program.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(adminMetas)
      .rpc()
      .catch((err) => {
        console.error(err);
        throw err;
      });
  };

  setAdminSigners = async (
    admins: PublicKey[],
    minSignatures: number
  ): Promise<void> => {
    const adminMetas = [];

    for (const admin of admins) {
      adminMetas.push({
        isSigner: false,
        isWritable: false,
        pubkey: admin,
      });
    }

    try {
      await this.program.methods
        .setAdminSigners({
          minSignatures,
        })
        .accounts({
          admin: this.admin.publicKey,
          multisig: this.multisig.publicKey,
        })
        .remainingAccounts(adminMetas)
        .signers([this.admin])
        .rpc();
    } catch (err) {
      console.log(err);
      throw err;
    }
  };

  setPermissions = async (permissions: Permissions): Promise<void> => {
    try {
      await this.program.methods
        .setPermissions(permissions)
        .accounts({
          admin: this.admin.publicKey,
          multisig: this.multisig.publicKey,
          perpetuals: this.perpetuals.publicKey,
        })
        .signers([this.admin])
        .rpc();
    } catch (err) {
      console.log(err);
      throw err;
    }
  };

  addPool = async (name: string): Promise<void> => {
    const poolKey = await this.getNextPoolKey();
    const lpTokenMintKey = this.findProgramAddress("lp_token_mint", [poolKey]).publicKey;
    
    this.log(`Creating pool "${name}"`);
    this.log(`Pool key: ${poolKey.toBase58()}`);
    this.log(`LP token mint: ${lpTokenMintKey.toBase58()}`);
    
    // Check if pool already exists with this name
    try {
      const existingPool = await this.getPool(name);
      throw new Error(`Pool with name "${name}" already exists at ${existingPool}`);
    } catch (e) {
      // Pool doesn't exist, which is what we want
      if (e instanceof Error && e.message.includes('not found')) {
        // This is expected, continue
      } else {
        throw e;
      }
    }
    
    const signature = await this.program.methods
      .addPool({ name })
      .accountsPartial({
        admin: this.admin.publicKey,
        pool: poolKey,
        lpTokenMint: lpTokenMintKey,
        multisig: this.multisig.publicKey,
        perpetuals: this.perpetuals.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([this.admin])
      .rpc()
      .catch((err) => {
        console.error(err);
        throw err;
      });
    
    this.log(`Pool add transaction: ${signature}`);
    // Wait for confirmation to ensure the pool is added to perpetuals.pools
    await this.provider.connection.confirmTransaction(signature, "confirmed");
    
    // Wait a bit more and refresh to ensure the perpetuals account is updated
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Verify the pool was added to perpetuals.pools
    const updatedPerpetuals = await this.getPerpetuals();
    const poolWasAdded = updatedPerpetuals.pools.some(p => p.equals(poolKey));
    
    if (!poolWasAdded) {
      this.log(`WARNING: Pool was created but not added to perpetuals.pools array. This may be a sync issue.`);
      this.log(`Pool key: ${poolKey.toBase58()}`);
      this.log(`Perpetuals.pools: ${updatedPerpetuals.pools.map(p => p.toBase58()).join(', ') || 'empty'}`);
    } else {
      this.log(`Pool successfully added to perpetuals.pools array`);
    }
    
    this.log(`Pool "${name}" added successfully`);
  };

  removePool = async (name: string): Promise<void> => {
    await this.program.methods
      .removePool({})
      .accountsPartial({
        admin: this.admin.publicKey,
      })
      .signers([this.admin])
      .rpc()
      .catch((err) => {
        console.error(err);
        throw err;
      });
  };

  addCustody = async (
    poolName: string,
    tokenMint: PublicKey,
    isStable: boolean,
    isVirtual: boolean,
    oracleConfig: OracleParams,
    pricingConfig: PricingParams,
    permissions: Permissions,
    fees: Fees,
    borrowRate: BorrowRateParams,
    ratios: TokenRatio[]
  ): Promise<void> => {
    // Use getPoolKey which will find the pool even if not in perpetuals.pools array
    const poolAddress = await this.getPoolKey(poolName);

    const custodyPDA = PublicKey.findProgramAddressSync(
      [Buffer.from("custody"), poolAddress.toBuffer(), tokenMint.toBuffer()],
      this.program.programId
    )[0];
    const custodyTokenAccountPDA = PublicKey.findProgramAddressSync(
      [Buffer.from("custody_token_account"), poolAddress.toBuffer(), tokenMint.toBuffer()],
      this.program.programId
    )[0];

    await this.program.methods
      .addCustody({
        isStable,
        isVirtual,
        oracle: oracleConfig,
        pricing: pricingConfig,
        permissions,
        fees,
        borrowRate,
        ratios,
      })
      .accountsPartial({
        admin: this.admin.publicKey,
        pool: poolAddress,
        custody: custodyPDA,
        custodyTokenAccount: custodyTokenAccountPDA,
        custodyTokenMint: tokenMint,
        multisig: this.multisig.publicKey,
        perpetuals: this.perpetuals.publicKey,
        transferAuthority: this.authority.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([this.admin])
      .rpc()
      .catch((err) => {
        console.error(err);
        throw err;
      });
  };

  removeCustody = async (
    poolName: string,
    tokenMint: PublicKey,
    ratios: TokenRatio[]
  ): Promise<void> => {
    const poolKey = await this.getPoolKey(poolName);
    const custodyKey = await this.getCustodyKey(poolName, tokenMint);
    const custodyTokenAccountKey = await this.getCustodyTokenAccountKey(poolName, tokenMint);

    await this.program.methods
      .removeCustody({ ratios })
      .accountsPartial({
        admin: this.admin.publicKey,
        multisig: this.multisig.publicKey,
        transferAuthority: this.authority.publicKey,
        perpetuals: this.perpetuals.publicKey,
        pool: poolKey,
        custody: custodyKey,
        custodyTokenAccount: custodyTokenAccountKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([this.admin])
      .rpc()
      .catch((err) => {
        console.error(err);
        throw err;
      });
  };

  setCustodyConfig = async (
    poolName: string,
    tokenMint: PublicKey,
    isStable: boolean,
    isVirtual: boolean,
    oracleConfig: OracleParams,
    pricingConfig: PricingParams,
    permissions: Permissions,
    fees: Fees,
    borrowRate: BorrowRateParams,
    ratios: TokenRatio[]
  ): Promise<void> => {
    await this.program.methods
      .setCustodyConfig({
        isStable,
        isVirtual,
        oracle: oracleConfig,
        pricing: pricingConfig,
        permissions,
        fees,
        borrowRate,
        ratios,
      })
      .accountsPartial({
        admin: this.admin.publicKey,
      })
      .signers([this.admin])
      .rpc()
      .catch((err) => {
        console.error(err);
        throw err;
      });
  };

  upgradeCustody = async (
    poolName: string,
    tokenMint: PublicKey
  ): Promise<void> => {
    await this.program.methods
      .upgradeCustody({})
      .accountsPartial({
        admin: this.admin.publicKey,
      })
      .signers([this.admin])
      .rpc()
      .catch((err) => {
        console.error(err);
        throw err;
      });
  };

  setCustomOraclePrice = async (
    poolName: string,
    tokenMint: PublicKey,
    priceConfig: SetCustomOraclePriceParams
  ): Promise<void> => {
    await this.program.methods
      .setCustomOraclePrice(priceConfig)
      .accountsPartial({
        admin: this.admin.publicKey,
      })
      .signers([this.admin])
      .rpc()
      .catch((err) => {
        console.error(err);
        throw err;
      });
  };

  withdrawFees = async (
    poolName: string,
    tokenMint: PublicKey,
    amount: BN,
    receivingAccount: PublicKey
  ): Promise<void> => {
    await this.program.methods
      .withdrawFees({ amount })
      .accountsPartial({
        admin: this.admin.publicKey,
        receivingAccount,
      })
      .signers([this.admin])
      .rpc()
      .catch((err) => {
        console.error(err);
        throw err;
      });
  };

  withdrawSolFees = async (amount: BN, receivingAccount: PublicKey): Promise<void> => {
    await this.program.methods
      .withdrawSolFees({ amount })
      .accountsPartial({
        admin: this.admin.publicKey,
        receiver: receivingAccount,
      })
      .signers([this.admin])
      .rpc()
      .catch((err) => {
        console.error(err);
        throw err;
      });
  };

  getOraclePrice = async (
    poolName: string,
    tokenMint: PublicKey,
    ema: boolean
  ): Promise<BN> => {
    return this.program.methods
      .getOraclePrice({ ema })
      .accounts({
        perpetuals: this.perpetuals.publicKey,
        pool: await this.getPoolKey(poolName),
        custody: await this.getCustodyKey(poolName, tokenMint),
        custodyOracleAccount: await this.getCustodyOracleAccountKey(
          poolName,
          tokenMint
        ),
      })
      .view()
      .catch((err) => {
        console.error(err);
        throw err;
      });
  };

  getAddLiquidityAmountAndFee = async (
    poolName: string,
    tokenMint: PublicKey,
    amount: BN
  ): Promise<AmountAndFee> => {
    return this.program.methods
      .getAddLiquidityAmountAndFee({ amountIn: amount })
      .accounts({
        perpetuals: this.perpetuals.publicKey,
        pool: await this.getPoolKey(poolName),
        custody: await this.getCustodyKey(poolName, tokenMint),
        custodyOracleAccount: await this.getCustodyOracleAccountKey(
          poolName,
          tokenMint
        ),
        lpTokenMint: await this.getPoolLpTokenKey(poolName),
      })
      .remainingAccounts(await this.getCustodyMetas(poolName))
      .view()
      .catch((err) => {
        console.error(err);
        throw err;
      });
  };

  getRemoveLiquidityAmountAndFee = async (
    poolName: string,
    tokenMint: PublicKey,
    lpAmount: BN
  ): Promise<AmountAndFee> => {
    return this.program.methods
      .getRemoveLiquidityAmountAndFee({ lpAmountIn: lpAmount })
      .accounts({
        perpetuals: this.perpetuals.publicKey,
        pool: await this.getPoolKey(poolName),
        custody: await this.getCustodyKey(poolName, tokenMint),
        custodyOracleAccount: await this.getCustodyOracleAccountKey(
          poolName,
          tokenMint
        ),
        lpTokenMint: await this.getPoolLpTokenKey(poolName),
      })
      .remainingAccounts(await this.getCustodyMetas(poolName))
      .view()
      .catch((err) => {
        console.error(err);
        throw err;
      });
  };

  getCustodyOracleAccountKey = async (
    poolName: string,
    tokenMint: PublicKey
  ): Promise<PublicKey> => {
    const custody = await this.getCustody(poolName, tokenMint);
    return new PublicKey(custody.oracle.oracleAccount);
  };

  addLiquidity = async (
    poolName: string,
    tokenMint: PublicKey,
    amountIn: BN,
    minLpAmountOut: BN,
    fundingAccount: PublicKey,
    lpTokenAccount: PublicKey
  ): Promise<string> => {
    const poolKey = await this.getPoolKey(poolName);
    const custodyKey = await this.getCustodyKey(poolName, tokenMint);
    
    try {
      await this.getCustody(poolName, tokenMint);
    } catch (error) {
      throw new Error(
        `Custody for token ${tokenMint.toString()} does not exist in pool "${poolName}". ` +
        `Please add custody first using: add-custody ${poolName} ${tokenMint.toString()} <oracle-account>`
      );
    }
    
    // Verify funding account exists and has balance
    const fundingAccountInfo = await this.provider.connection.getAccountInfo(fundingAccount);
    if (!fundingAccountInfo) {
      throw new Error(
        `Funding account ${fundingAccount.toString()} does not exist. ` +
        `For SOL, you may need to wrap it first or create a wrapped SOL token account.`
      );
    }
    
    // Verify LP token account exists
    const lpTokenAccountInfo = await this.provider.connection.getAccountInfo(lpTokenAccount);
    if (!lpTokenAccountInfo) {
      this.log(`Warning: LP token account ${lpTokenAccount.toString()} does not exist. It will be created automatically.`);
    }
    
    const custodyTokenAccountKey = await this.getCustodyTokenAccountKey(poolName, tokenMint);
    const lpTokenMintKey = await this.getPoolLpTokenKey(poolName);
    const custodyOracleAccountKey = await this.getCustodyOracleAccountKey(poolName, tokenMint);
    const custodyMetas = await this.getCustodyMetas(poolName);

    // Log account addresses for debugging
    this.log(`Add Liquidity Accounts:`);
    this.log(`  Pool: ${poolKey.toBase58()}`);
    this.log(`  Custody: ${custodyKey.toBase58()}`);
    this.log(`  Custody Token Account: ${custodyTokenAccountKey.toBase58()}`);
    this.log(`  Custody Oracle Account: ${custodyOracleAccountKey.toBase58()}`);
    this.log(`  LP Token Mint: ${lpTokenMintKey.toBase58()}`);
    this.log(`  Funding Account: ${fundingAccount.toBase58()}`);
    this.log(`  LP Token Account: ${lpTokenAccount.toBase58()}`);
    this.log(`  Remaining Accounts (custodies + oracles): ${custodyMetas.length}`);

    // Verify perpetuals account includes this pool
    const perpetualsData = await this.getPerpetuals();
    const poolInArray = perpetualsData.pools.some(p => p.equals(poolKey));
    if (!poolInArray) {
      this.log(`WARNING: Pool ${poolKey.toBase58()} is NOT in perpetuals.pools array!`);
      this.log(`This may cause program errors. The pool exists but isn't registered in the perpetuals account.`);
      this.log(`Perpetuals account has ${perpetualsData.pools.length} pools registered.`);
    }

    const signature = await this.program.methods
      .addLiquidity({
        amountIn,
        minLpAmountOut,
      })
      .accountsPartial({
        owner: this.admin.publicKey,
        fundingAccount,
        lpTokenAccount,
        transferAuthority: this.authority.publicKey,
        perpetuals: this.perpetuals.publicKey,
        pool: poolKey,
        custody: custodyKey,
        custodyTokenAccount: custodyTokenAccountKey,
        custodyOracleAccount: custodyOracleAccountKey,
        lpTokenMint: lpTokenMintKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(custodyMetas)
      .signers([this.admin])
      .rpc()
      .catch((err) => {
        console.error(err);
        throw err;
      });

    return signature;
  };

  removeLiquidity = async (
    poolName: string,
    tokenMint: PublicKey,
    lpAmountIn: BN,
    minAmountOut: BN,
    lpTokenAccount: PublicKey,
    receivingAccount: PublicKey
  ): Promise<string> => {
    const poolKey = await this.getPoolKey(poolName);
    const custodyKey = await this.getCustodyKey(poolName, tokenMint);
    
    try {
      await this.getCustody(poolName, tokenMint);
    } catch (error) {
      throw new Error(
        `Custody for token ${tokenMint.toString()} does not exist in pool "${poolName}". ` +
        `Please add custody first using: add-custody ${poolName} ${tokenMint.toString()} <oracle-account>`
      );
    }
    
    const custodyTokenAccountKey = await this.getCustodyTokenAccountKey(poolName, tokenMint);
    const lpTokenMintKey = await this.getPoolLpTokenKey(poolName);
    const custodyOracleAccountKey = await this.getCustodyOracleAccountKey(poolName, tokenMint);
    const custodyMetas = await this.getCustodyMetas(poolName);

    const signature = await this.program.methods
      .removeLiquidity({
        lpAmountIn,
        minAmountOut,
      })
      .accountsPartial({
        owner: this.admin.publicKey,
        lpTokenAccount,
        receivingAccount,
        transferAuthority: this.authority.publicKey,
        perpetuals: this.perpetuals.publicKey,
        pool: poolKey,
        custody: custodyKey,
        custodyTokenAccount: custodyTokenAccountKey,
        custodyOracleAccount: custodyOracleAccountKey,
        lpTokenMint: lpTokenMintKey,
      })
      .remainingAccounts(custodyMetas)
      .signers([this.admin])
      .rpc()
      .catch((err) => {
        console.error(err);
        throw err;
      });

    return signature;
  };
}
