
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
      } else if (extraSeed instanceof Uint8Array) {
        seeds.push(Buffer.from(extraSeed));
      } else if (Array.isArray(extraSeed)) {
        seeds.push(Buffer.from(extraSeed));
      } else {
        seeds.push(Buffer.from(extraSeed));
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
    return this.program.account.perpetuals.fetch(this.perpetuals.publicKey);
  };

  getPoolKeyByIndex = (index: number): PublicKey => {
    const poolIndexBuffer = Buffer.alloc(8);
    poolIndexBuffer.writeUInt32LE(index, 0);
    return this.findProgramAddress("pool", poolIndexBuffer).publicKey;
  };

  getPoolIndexByName = async (name: string): Promise<number> => {
    const perpetuals = await this.getPerpetuals();
    for (let i = 0; i < perpetuals.pools.length; ++i) {
      try {
        const pool = await this.program.account.pool.fetch(perpetuals.pools[i]);
        if (pool.name === name) return i;
      } catch {}
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
    const poolIndexBuffer = Buffer.alloc(8);
    poolIndexBuffer.writeUInt32LE(poolIndex, 0);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), poolIndexBuffer],
      this.program.programId
    )[0];
  };

  getPool = async (name: string) => {
    const perpetuals = await this.getPerpetuals();
    for (const poolAddress of perpetuals.pools) {
      try {
        const pool = await this.program.account.pool.fetch(poolAddress);
        if (pool.name === name) {
          this.log(`Pool key: ${poolAddress.toBase58()}`);
          return pool;
        }
      } catch (e) {
      }
    }
    throw new Error(`Pool with name '${name}' not found`);
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
    await this.program.methods
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
    const perpetuals = await this.getPerpetuals();
    let poolAddress: PublicKey | undefined;
    for (const addr of perpetuals.pools) {
      try {
        const pool = await this.program.account.pool.fetch(addr);
        if (pool.name === poolName) {
          poolAddress = addr;
          break;
        }
      } catch {}
    }
    if (!poolAddress) throw new Error(`Pool '${poolName}' not found`);

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
    await this.program.methods
      .removeCustody({ ratios })
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
    
    const custodyTokenAccountKey = await this.getCustodyTokenAccountKey(poolName, tokenMint);
    const lpTokenMintKey = await this.getPoolLpTokenKey(poolName);
    const custodyMetas = await this.getCustodyMetas(poolName);

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
