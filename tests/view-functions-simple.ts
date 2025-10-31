import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Blackjack } from "../target/types/blackjack";
import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import { TestClient } from "./helpers/TestClient";

function readKpJson(path: string) {
  const kpJson = JSON.parse(fs.readFileSync(path, "utf-8"));
  return anchor.web3.Keypair.fromSecretKey(new Uint8Array(kpJson));
}

describe("View Functions with TestClient", () => {
  const admin = readKpJson(`${os.homedir()}/.config/solana/id.json`);
  
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Blackjack as Program<Blackjack>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  let testClient: TestClient;

  before(async () => {
    console.log("\nInitializing test environment...");
    testClient = new TestClient(program, provider, admin);

    console.log("1. Initializing perpetuals protocol...");
    await testClient.init();

    console.log("2. Adding test pool...");
    await testClient.addPool({ name: "testpool" });

    console.log("3. Adding SOL custody...");
    const solCustody = await testClient.addCustody({
      poolName: "testpool",
      symbol: "SOL",
      decimals: 9,
      isStable: false,
    });

    console.log("4. Adding USDC custody...");
    await testClient.addCustody({
      poolName: "testpool",
      symbol: "USDC",
      decimals: 6,
      isStable: true,
    });

    console.log("5. Setting SOL oracle price to $50,000...");
    await testClient.setCustomOraclePrice({
      poolName: "testpool",
      symbol: "SOL",
      price: new anchor.BN(50000_00000000),
    });

    console.log("6. Setting USDC oracle price to $1...");
    await testClient.setCustomOraclePrice({
      poolName: "testpool",
      symbol: "USDC",
      price: new anchor.BN(1_00000000),
    });

    console.log("✅ Test environment initialized\n");
  });

  it("Calls get_entry_price_and_fee for long position", async () => {
    const solCustody = testClient.custodies.get("testpool-SOL");
    const usdcCustody = testClient.custodies.get("testpool-USDC");
    const pool = testClient.pools.get("testpool");

    const params = {
      collateral: new anchor.BN(1000_000000),
      size: new anchor.BN(10000_000000),
      side: { long: {} },
    };

    const result = await program.methods
      .getEntryPriceAndFee(params)
      .accountsPartial({
        perpetuals: testClient.perpetualsAccount,
        pool: pool.account,
        custody: solCustody.account,
        custodyOracleAccount: solCustody.oracleAccount,
        collateralCustody: usdcCustody.account,
        collateralCustodyOracleAccount: usdcCustody.oracleAccount,
      })
      .view();

    console.log("\nLong Position Entry:");
    console.log("  Entry Price:", result.entryPrice.toString());
    console.log("  Liquidation Price:", result.liquidationPrice.toString());
    console.log("  Fee:", result.fee.toString());

    expect(result.entryPrice.toNumber()).to.be.greaterThan(0);
    expect(result.liquidationPrice.toNumber()).to.be.greaterThan(0);
    expect(result.fee.toNumber()).to.be.greaterThan(0);
  });

  it("Calls get_oracle_price", async () => {
    const solCustody = testClient.custodies.get("testpool-SOL");
    const pool = testClient.pools.get("testpool");

    const price = await program.methods
      .getOraclePrice({ ema: false })
      .accountsPartial({
        perpetuals: testClient.perpetualsAccount,
        pool: pool.account,
        custody: solCustody.account,
        custodyOracleAccount: solCustody.oracleAccount,
      })
      .view();

    console.log("\nOracle Price:", price.toString());

    expect(price.toNumber()).to.equal(50000_00000000);
  });

  it("Calls get_swap_amount_and_fees", async () => {
    const solCustody = testClient.custodies.get("testpool-SOL");
    const usdcCustody = testClient.custodies.get("testpool-USDC");
    const pool = testClient.pools.get("testpool");

    const params = {
      amountIn: new anchor.BN(1_000000000),
    };

    const result = await program.methods
      .getSwapAmountAndFees(params)
      .accountsPartial({
        perpetuals: testClient.perpetualsAccount,
        pool: pool.account,
        receivingCustody: usdcCustody.account,
        receivingCustodyOracleAccount: usdcCustody.oracleAccount,
        dispensingCustody: solCustody.account,
        dispensingCustodyOracleAccount: solCustody.oracleAccount,
      })
      .view();

    console.log("\nSwap Calculation:");
    console.log("  Amount Out:", result.amountOut.toString());
    console.log("  Fee In:", result.feeIn.toString());
    console.log("  Fee Out:", result.feeOut.toString());

    expect(result.amountOut.toNumber()).to.be.greaterThan(0);
  });

  it("Calls get_add_liquidity_amount_and_fee", async () => {
    const solCustody = testClient.custodies.get("testpool-SOL");
    const pool = testClient.pools.get("testpool");

    const params = {
      amountIn: new anchor.BN(1_000000000),
    };

    const result = await program.methods
      .getAddLiquidityAmountAndFee(params)
      .accountsPartial({
        perpetuals: testClient.perpetualsAccount,
        pool: pool.account,
        custody: solCustody.account,
        custodyOracleAccount: solCustody.oracleAccount,
        lpTokenMint: pool.lpTokenMint,
      })
      .view();

    console.log("\nAdd Liquidity Calculation:");
    console.log("  LP Amount:", result.amount.toString());
    console.log("  Fee:", result.fee.toString());

    expect(result.amount.toNumber()).to.be.greaterThan(0);
  });

  it("Calls get_assets_under_management", async () => {
    const pool = testClient.pools.get("testpool");

    const result = await program.methods
      .getAssetsUnderManagement({})
      .accountsPartial({
        perpetuals: testClient.perpetualsAccount,
        pool: pool.account,
      })
      .view();

    console.log("\nPool AUM:", result.toString());
    expect(result.toNumber()).to.be.greaterThanOrEqual(0);
  });
});
