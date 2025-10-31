#!/usr/bin/env ts-node
/// Command-line interface for Arcium Perpetuals admin functions

import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { PerpetualsClient } from "./client";
import { Command } from "commander";
import { resolve } from "path";
import {
  BorrowRateParams,
  Fees,
  InitParams,
  OracleParams,
  Permissions,
  PricingParams,
  SetCustomOraclePriceParams,
} from "./types";

let client: PerpetualsClient;
function ensureClient(): void {
  if (!client) {
    const opts = program.opts() as { clusterUrl: string; keypair: string };
    initClient(opts.clusterUrl, opts.keypair);
  }
}

function initClient(clusterUrl: string, adminKeyPath: string): void {
  const projectRoot = resolve(__dirname, "../..");
  process.chdir(projectRoot);
  process.env.ANCHOR_WALLET = adminKeyPath;
  client = new PerpetualsClient(clusterUrl, adminKeyPath);
  client.log("Client Initialized");
}

function init(adminSigners: PublicKey[], minSignatures: number): Promise<void> {
  const perpetualsConfig: InitParams = {
    minSignatures: minSignatures,
    allowSwap: true,
    allowAddLiquidity: true,
    allowRemoveLiquidity: true,
    allowOpenPosition: true,
    allowClosePosition: true,
    allowPnlWithdrawal: true,
    allowCollateralWithdrawal: true,
    allowSizeChange: true,
  };

  return client.init(adminSigners, perpetualsConfig);
}

function setAuthority(
  adminSigners: PublicKey[],
  minSignatures: number
): Promise<void> {
  return client.setAdminSigners(adminSigners, minSignatures);
}

async function getMultisig(): Promise<void> {
  client.prettyPrint(await client.getMultisig());
}

async function getPerpetuals(): Promise<void> {
  client.prettyPrint(await client.getPerpetuals());
}

function addPool(poolName: string): Promise<void> {
  return client.addPool(poolName);
}

async function getPool(poolName: string): Promise<void> {
  client.prettyPrint(await client.getPool(poolName));
}

async function getPools(): Promise<void> {
  client.prettyPrint(await client.getPools());
}

function removePool(poolName: string): Promise<void> {
  return client.removePool(poolName);
}

async function addCustody(
  poolName: string,
  tokenMint: PublicKey,
  tokenOracle: PublicKey,
  isStable: boolean,
  isVirtual: boolean,
  oracleType: string = "custom"
): Promise<void> {
  // Production-ready default configurations
  let oracleTypeObj: OracleParams["oracleType"];
  if (oracleType === "pyth") {
    oracleTypeObj = { pyth: {} };
  } else if (oracleType === "none") {
    oracleTypeObj = { none: {} };
  } else {
    oracleTypeObj = { custom: {} };
  }

  const oracleConfig: OracleParams = {
    maxPriceError: new BN(10_000),         // 1% max price error
    maxPriceAgeSec: 60,                     // 60 second max age
    oracleType: oracleTypeObj,              // custom, pyth, or none
    oracleAccount: tokenOracle,
    oracleAuthority: PublicKey.default,     // Permissionless by default
  };

  const pricingConfig: PricingParams = {
    useEma: true,
    useUnrealizedPnlInAum: true,
    tradeSpreadLong: new BN(100),           // 0.01% = 1 basis point
    tradeSpreadShort: new BN(100),
    swapSpread: new BN(200),                // 0.02%
    minInitialLeverage: new BN(10_000),     // 1x
    maxInitialLeverage: new BN(1_000_000),  // 100x
    maxLeverage: new BN(1_000_000),         // 100x
    maxPayoffMult: new BN(10_000),
    maxUtilization: new BN(10_000),         // 100%
    maxPositionLockedUsd: new BN(1_000_000_000),
    maxTotalLockedUsd: new BN(1_000_000_000),
  };

  const permissions: Permissions = {
    allowSwap: true,
    allowAddLiquidity: true,
    allowRemoveLiquidity: true,
    allowOpenPosition: true,
    allowClosePosition: true,
    allowPnlWithdrawal: true,
    allowCollateralWithdrawal: true,
    allowSizeChange: true,
  };

  const fees: Fees = {
    mode: { linear: {} },              // or { fixed: {} } or { optimal: {} }
    ratioMult: new BN(20_000),
    utilizationMult: new BN(20_000),
    swapIn: new BN(100),               // 0.01%
    swapOut: new BN(100),
    stableSwapIn: new BN(100),
    stableSwapOut: new BN(100),
    addLiquidity: new BN(100),
    removeLiquidity: new BN(100),
    openPosition: new BN(100),
    closePosition: new BN(100),
    liquidation: new BN(100),
    protocolShare: new BN(10),         // 10% of fees
    feeMax: new BN(250),               // 0.025% max
    feeOptimal: new BN(10),            // 0.001% optimal
  };

  const borrowRate: BorrowRateParams = {
    baseRate: new BN(0),
    slope1: new BN(80_000),
    slope2: new BN(120_000),
    optimalUtilization: new BN(800_000_000), // 80%
  };

  const pool = await client.getPool(poolName);
  pool.ratios.push({
    target: new BN(5_000),
    min: new BN(10),
    max: new BN(10_000),
  });

  const ratios = client.adjustTokenRatios(pool.ratios);

  return client.addCustody(
    poolName,
    tokenMint,
    isStable,
    isVirtual,
    oracleConfig,
    pricingConfig,
    permissions,
    fees,
    borrowRate,
    ratios
  );
}

async function getCustody(
  poolName: string,
  tokenMint: PublicKey
): Promise<void> {
  client.prettyPrint(await client.getCustody(poolName, tokenMint));
}

async function getCustodies(poolName: string): Promise<void> {
  client.prettyPrint(await client.getCustodies(poolName));
}

async function removeCustody(
  poolName: string,
  tokenMint: PublicKey
): Promise<void> {
  const pool = await client.getPool(poolName);
  pool.ratios.pop();
  const ratios = client.adjustTokenRatios(pool.ratios);
  return client.removeCustody(poolName, tokenMint, ratios);
}

function upgradeCustody(poolName: string, tokenMint: PublicKey): Promise<void> {
  return client.upgradeCustody(poolName, tokenMint);
}

function setCustomOraclePrice(
  poolName: string,
  tokenMint: PublicKey,
  price: number,
  exponent: number,
  confidence: number,
  ema: number
): Promise<void> {
  const priceConfig: SetCustomOraclePriceParams = {
    price: new BN(price),
    expo: exponent,
    conf: new BN(confidence),
    ema: new BN(ema),
    publishTime: new BN(client.getTime()),
  };

  return client.setCustomOraclePrice(poolName, tokenMint, priceConfig);
}

function getCustomOracleAccount(poolName: string, tokenMint: PublicKey): void {
  client.prettyPrint(
    client.getCustodyCustomOracleAccountKey(poolName, tokenMint)
  );
}

// Change getLpTokenMint to async for correct usage
async function getLpTokenMint(poolName: string): Promise<void> {
  client.prettyPrint(await client.getPoolLpTokenKey(poolName));
}

async function getOraclePrice(
  poolName: string,
  tokenMint: PublicKey,
  useEma: boolean
): Promise<void> {
  client.prettyPrint(await client.getOraclePrice(poolName, tokenMint, useEma));
}

async function getAddLiquidityAmountAndFee(
  poolName: string,
  tokenMint: PublicKey,
  amount: BN
): Promise<void> {
  client.prettyPrint(
    await client.getAddLiquidityAmountAndFee(poolName, tokenMint, amount)
  );
}

async function getRemoveLiquidityAmountAndFee(
  poolName: string,
  tokenMint: PublicKey,
  lpAmount: BN
): Promise<void> {
  client.prettyPrint(
    await client.getRemoveLiquidityAmountAndFee(poolName, tokenMint, lpAmount)
  );
}

// CLI Configuration
const program = new Command();

program
  .name("arcium-perpetuals")
  .description("CLI for managing Arcium Perpetuals DEX")
  .version("1.0.0")
  .option("-u, --cluster-url <string>", "Cluster URL", "http://localhost:8899")
  .option("-k, --keypair <path>", "Admin keypair path", process.env.HOME + "/.config/solana/id.json");

// Initialize commands
program
  .command("init")
  .description("Initialize the perpetuals program")
  .option("--min-signatures <number>", "Minimum signatures required", "1")
  .arguments("<admin-pubkeys...>")
  .action(async (adminPubkeys: string[], options: { minSignatures: string }) => {
    ensureClient();
    const admins = adminPubkeys.map((pk) => new PublicKey(pk));
    const minSignatures = parseInt(options.minSignatures);
    await init(admins, minSignatures);
    client.log("Program initialized successfully");
  });

program
  .command("set-authority")
  .description("Update admin signers and minimum signatures")
  .option("--min-signatures <number>", "Minimum signatures required", "1")
  .arguments("<admin-pubkeys...>")
  .action(async (adminPubkeys: string[], options: { minSignatures: string }) => {
    ensureClient();
    const admins = adminPubkeys.map((pk) => new PublicKey(pk));
    const minSignatures = parseInt(options.minSignatures);
    await setAuthority(admins, minSignatures);
    client.log("Authority updated successfully");
  });

program
  .command("get-multisig")
  .description("Get multisig account information")
  .action(async () => {
    ensureClient();
    await getMultisig();
  });

program
  .command("get-perpetuals")
  .description("Get perpetuals account information")
  .action(async () => {
    ensureClient();
    await getPerpetuals();
  });

// Pool commands
program
  .command("add-pool")
  .description("Add a new trading pool")
  .arguments("<pool-name>")
  .action(async (poolName: string) => {
    ensureClient();
    await addPool(poolName);
    client.log(`Pool "${poolName}" added successfully`);
  });

program
  .command("remove-pool")
  .description("Remove a trading pool")
  .arguments("<pool-name>")
  .action(async (poolName: string) => {
    ensureClient();
    await removePool(poolName);
    client.log(`Pool "${poolName}" removed successfully`);
  });

program
  .command("get-pool")
  .description("Get pool information")
  .arguments("<pool-name>")
  .action(async (poolName: string) => {
    ensureClient();
    await getPool(poolName);
  });

program
  .command("get-pools")
  .description("Get all pools")
  .action(async () => {
    ensureClient();
    await getPools();
  });

// Custody commands
program
  .command("add-custody")
  .description("Add token custody to a pool")
  .arguments("<pool-name> <token-mint> <oracle-account>")
  .option("-s, --stable", "Is stable coin", false)
  .option("-v, --virtual", "Is virtual/synthetic", false)
  .option("-t, --oracle-type <type>", "Oracle type (custom, pyth, none)", "custom")
  .action(async (poolName: string, tokenMint: string, oracleAccount: string, options: { stable: boolean; virtual: boolean; oracleType: string }) => {
    ensureClient();
    await addCustody(
      poolName,
      new PublicKey(tokenMint),
      new PublicKey(oracleAccount),
      options.stable,
      options.virtual,
      options.oracleType
    );
    client.log(`Custody added to pool "${poolName}" successfully`);
  });

program
  .command("remove-custody")
  .description("Remove token custody from a pool")
  .arguments("<pool-name> <token-mint>")
  .action(async (poolName: string, tokenMint: string) => {
    ensureClient();
    await removeCustody(poolName, new PublicKey(tokenMint));
    client.log(`Custody removed from pool "${poolName}" successfully`);
  });

program
  .command("get-custody")
  .description("Get custody information")
  .arguments("<pool-name> <token-mint>")
  .action(async (poolName: string, tokenMint: string) => {
    ensureClient();
    await getCustody(poolName, new PublicKey(tokenMint));
  });

program
  .command("get-custodies")
  .description("Get all custodies for a pool")
  .arguments("<pool-name>")
  .action(async (poolName: string) => {
    ensureClient();
    await getCustodies(poolName);
  });

program
  .command("upgrade-custody")
  .description("Upgrade custody account structure")
  .arguments("<pool-name> <token-mint>")
  .action(async (poolName: string, tokenMint: string) => {
    ensureClient();
    await upgradeCustody(poolName, new PublicKey(tokenMint));
    client.log("Custody upgraded successfully");
  });

// Oracle commands
program
  .command("set-oracle-price")
  .description("Set custom oracle price (for testing)")
  .arguments("<pool-name> <token-mint> <price>")
  .option("--expo <number>", "Exponent", "-8")
  .option("--conf <number>", "Confidence", "0")
  .option("--ema <number>", "EMA", "0")
  .action(async (poolName: string, tokenMint: string, price: string, options: { expo: string; conf: string; ema?: string }) => {
    ensureClient();
    await setCustomOraclePrice(
      poolName,
      new PublicKey(tokenMint),
      parseInt(price),
      parseInt(options.expo),
      parseInt(options.conf),
      options.ema ? parseInt(options.ema) : parseInt(price)
    );
    client.log("Oracle price set successfully");
  });

program
  .command("get-oracle-account")
  .description("Get custom oracle account address")
  .arguments("<pool-name> <token-mint>")
  .action((poolName: string, tokenMint: string) => {
    ensureClient();
    getCustomOracleAccount(poolName, new PublicKey(tokenMint));
  });

program
  .command("get-oracle-price")
  .description("Get current oracle price")
  .arguments("<pool-name>")
  .arguments("<token-mint>")
  .option("--ema", "Use EMA price", false)
  .action(async (poolName: string, tokenMint: string, options: { ema: boolean }) => {
    ensureClient();
    await getOraclePrice(poolName, new PublicKey(tokenMint), options.ema);
  });

// Utility commands
program
  .command("get-lp-token-mint")
  .description("Get LP token mint address for a pool")
  .arguments("<pool-name>")
  .action(async (poolName: string) => {
    ensureClient();
    await getLpTokenMint(poolName);
  });

program
  .command("get-add-liquidity-fee")
  .description("Calculate add liquidity amount and fee")
  .arguments("<pool-name> <token-mint> <amount>")
  .action(async (poolName: string, tokenMint: string, amount: string) => {
    ensureClient();
    await getAddLiquidityAmountAndFee(
      poolName,
      new PublicKey(tokenMint),
      new BN(amount)
    );
  });

program
  .command("get-remove-liquidity-fee")
  .description("Calculate remove liquidity amount and fee")
  .arguments("<pool-name> <token-mint> <lp-amount>")
  .action(async (poolName: string, tokenMint: string, lpAmount: string) => {
    ensureClient();
    await getRemoveLiquidityAmountAndFee(
      poolName,
      new PublicKey(tokenMint),
      new BN(lpAmount)
    );
  });

// Parse and execute
program.parse(process.argv);
