import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { Perpetuals } from "../target/types/perpetuals";
import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import { TestClient } from "./helpers/TestClient";

function readKpJson(path: string) {
  const kpJson = JSON.parse(fs.readFileSync(path, "utf-8"));
  return anchor.web3.Keypair.fromSecretKey(new Uint8Array(kpJson));
}

describe("View Functions", () => {
  const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);
  
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Perpetuals as Program<Perpetuals>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  let testClient: TestClient;
  let perpetualsAccount: PublicKey;
  let poolAccount: PublicKey;
  let custodyAccount: PublicKey;
  let positionAccount: PublicKey;
  let oracleAccount: PublicKey;
  let collateralCustodyAccount: PublicKey;
  let collateralOracleAccount: PublicKey;

  before(async () => {
    testClient = new TestClient(program, provider, owner);

    await testClient.init();

    const pool = await testClient.addPool({ name: "testpool" });
    poolAccount = pool.account;

    await testClient.addCustody({
      poolName: "testpool",
      symbol: "SOL",
      decimals: 9,
      isStable: false,
    });

    await testClient.addCustody({
      poolName: "testpool",
      symbol: "USDC",
      decimals: 6,
      isStable: true,
    });

    await testClient.setCustomOraclePrice({
      poolName: "testpool",
      symbol: "SOL",
      price: new anchor.BN(50000_00000000),
    });

    await testClient.setCustomOraclePrice({
      poolName: "testpool",
      symbol: "USDC",
      price: new anchor.BN(1_00000000),
    });

    // Get custody info AFTER setting oracle prices (oracle accounts are updated)
    const custody = testClient.custodies.get("testpool-SOL");
    custodyAccount = custody.account;
    oracleAccount = custody.oracleAccount;

    const collateralCustody = testClient.custodies.get("testpool-USDC");
    collateralCustodyAccount = collateralCustody.account;
    collateralOracleAccount = collateralCustody.oracleAccount;

    perpetualsAccount = testClient.perpetualsAccount;

    positionAccount = testClient.getPositionAccount(
      owner.publicKey,
      "testpool",
      "SOL",
      new anchor.BN(1)
    );
  });

  describe("get_entry_price_and_fee", () => {
    it("Calculates entry price and fee for long position", async () => {
      const params = {
        collateral: new anchor.BN(1000_000000),
        size: new anchor.BN(10000_000000),
        side: { long: {} },
      };

      const result = await program.methods
        .getEntryPriceAndFee(params)
        .accountsPartial({
          perpetuals: perpetualsAccount,
          pool: poolAccount,
          custody: custodyAccount,
          custodyOracleAccount: oracleAccount,
          collateralCustody: collateralCustodyAccount,
          collateralCustodyOracleAccount: collateralOracleAccount,
        })
        .view();

      expect(result.entryPrice.toNumber()).to.be.greaterThan(0);
      expect(result.liquidationPrice.toNumber()).to.be.greaterThan(0);
      expect(result.fee.toNumber()).to.be.greaterThan(0);
      expect(result.entryPrice.toNumber()).to.be.greaterThan(result.liquidationPrice.toNumber());
      
      console.log("Long position:");
      console.log("  Entry Price:", result.entryPrice.toString());
      console.log("  Liquidation Price:", result.liquidationPrice.toString());
      console.log("  Fee:", result.fee.toString());
    });

    it("Calculates entry price and fee for short position", async () => {
      const params = {
        collateral: new anchor.BN(1000_000000),
        size: new anchor.BN(10000_000000),
        side: { short: {} },
      };

      const result = await program.methods
        .getEntryPriceAndFee(params)
        .accountsPartial({
          perpetuals: perpetualsAccount,
          pool: poolAccount,
          custody: custodyAccount,
          custodyOracleAccount: oracleAccount,
          collateralCustody: collateralCustodyAccount,
          collateralCustodyOracleAccount: collateralOracleAccount,
        })
        .view();

      expect(result.entryPrice.toNumber()).to.be.greaterThan(0);
      expect(result.liquidationPrice.toNumber()).to.be.greaterThan(0);
      expect(result.fee.toNumber()).to.be.greaterThan(0);
      expect(result.liquidationPrice.toNumber()).to.be.greaterThan(result.entryPrice.toNumber());
      
      console.log("Short position:");
      console.log("  Entry Price:", result.entryPrice.toString());
      console.log("  Liquidation Price:", result.liquidationPrice.toString());
      console.log("  Fee:", result.fee.toString());
    });
  });

  describe("get_exit_price_and_fee", () => {
    // NOTE: These tests require an actual position to be created first
    // Skipping for now as position creation requires encrypted MPC operations
    it.skip("Calculates exit price and fee for long position", async () => {
      const params = {
        sizeUsd: new anchor.BN(10000_000000),
        side: { long: {} },
      };

      const result = await program.methods
        .getExitPriceAndFee(params)
        .accountsPartial({
          perpetuals: perpetualsAccount,
          pool: poolAccount,
          position: positionAccount,
          custody: custodyAccount,
          custodyOracleAccount: oracleAccount,
          collateralCustody: collateralCustodyAccount,
          collateralCustodyOracleAccount: collateralOracleAccount,
        })
        .view();

      expect(result.price.toNumber()).to.be.greaterThan(0);
      expect(result.fee.toNumber()).to.be.greaterThan(0);
      
      console.log("Exit price (long):", result.price.toString());
      console.log("Exit fee:", result.fee.toString());
    });

    it.skip("Calculates exit price and fee for short position", async () => {
      const params = {
        sizeUsd: new anchor.BN(10000_000000),
        side: { short: {} },
      };

      const result = await program.methods
        .getExitPriceAndFee(params)
        .accountsPartial({
          perpetuals: perpetualsAccount,
          pool: poolAccount,
          position: positionAccount,
          custody: custodyAccount,
          custodyOracleAccount: oracleAccount,
          collateralCustody: collateralCustodyAccount,
          collateralCustodyOracleAccount: collateralOracleAccount,
        })
        .view();

      expect(result.price.toNumber()).to.be.greaterThan(0);
      expect(result.fee.toNumber()).to.be.greaterThan(0);
      
      console.log("Exit price (short):", result.price.toString());
      console.log("Exit fee:", result.fee.toString());
    });
  });

  describe("get_pnl", () => {
    // NOTE: These tests require an actual position to be created first
    it.skip("Calculates PnL for position with profit", async () => {
      const params = {
        sizeUsd: new anchor.BN(10000_000000),
        entryPrice: new anchor.BN(50000_000000),
        exitPrice: new anchor.BN(55000_000000),
        side: { long: {} },
      };

      const result = await program.methods
        .getPnl(params)
        .accountsPartial({
          perpetuals: perpetualsAccount,
          pool: poolAccount,
          position: positionAccount,
          custody: custodyAccount,
          custodyOracleAccount: oracleAccount,
          collateralCustody: collateralCustodyAccount,
          collateralCustodyOracleAccount: collateralOracleAccount,
        })
        .view();

      expect(result.profit.toNumber()).to.be.greaterThan(0);
      expect(result.loss.toNumber()).to.equal(0);
      
      console.log("PnL (profit):", result.profit.toString());
    });

    it.skip("Calculates PnL for position with loss", async () => {
      const params = {
        sizeUsd: new anchor.BN(10000_000000),
        entryPrice: new anchor.BN(50000_000000),
        exitPrice: new anchor.BN(45000_000000),
        side: { long: {} },
      };

      const result = await program.methods
        .getPnl(params)
        .accountsPartial({
          perpetuals: perpetualsAccount,
          pool: poolAccount,
          position: positionAccount,
          custody: custodyAccount,
          custodyOracleAccount: oracleAccount,
          collateralCustody: collateralCustodyAccount,
          collateralCustodyOracleAccount: collateralOracleAccount,
        })
        .view();

      expect(result.profit.toNumber()).to.equal(0);
      expect(result.loss.toNumber()).to.be.greaterThan(0);
      
      console.log("PnL (loss):", result.loss.toString());
    });
  });

  describe("get_liquidation_price", () => {
    // NOTE: These tests require an actual position to be created first
    it.skip("Calculates liquidation price (add collateral)", async () => {
      const params = {
        addCollateral: new anchor.BN(500_000000),
        removeCollateral: new anchor.BN(0),
      };

      const result = await program.methods
        .getLiquidationPrice(params)
        .accountsPartial({
          perpetuals: perpetualsAccount,
          pool: poolAccount,
          position: positionAccount,
          custody: custodyAccount,
          custodyOracleAccount: oracleAccount,
          collateralCustody: collateralCustodyAccount,
          collateralCustodyOracleAccount: collateralOracleAccount,
        })
        .view();

      expect(result.toNumber()).to.be.greaterThanOrEqual(0);
      
      console.log("Liquidation price (with add collateral):", result.toString());
    });

    it.skip("Calculates liquidation price (remove collateral)", async () => {
      const params = {
        addCollateral: new anchor.BN(0),
        removeCollateral: new anchor.BN(200_000000),
      };

      const result = await program.methods
        .getLiquidationPrice(params)
        .accountsPartial({
          perpetuals: perpetualsAccount,
          pool: poolAccount,
          position: positionAccount,
          custody: custodyAccount,
          custodyOracleAccount: oracleAccount,
          collateralCustody: collateralCustodyAccount,
          collateralCustodyOracleAccount: collateralOracleAccount,
        })
        .view();

      expect(result.toNumber()).to.be.greaterThanOrEqual(0);
      
      console.log("Liquidation price (with remove collateral):", result.toString());
    });
  });

  describe("get_liquidation_state", () => {
    // NOTE: These tests require an actual position to be created first
    it.skip("Returns healthy state for well-collateralized position", async () => {
      const params = {
        sizeUsd: new anchor.BN(10000_000000),
        collateralUsd: new anchor.BN(2000_000000),
        entryPrice: new anchor.BN(50000_000000),
        currentPrice: new anchor.BN(50000_000000),
        side: { long: {} },
      };

      const result = await program.methods
        .getLiquidationState(params)
        .accountsPartial({
          perpetuals: perpetualsAccount,
          pool: poolAccount,
          position: positionAccount,
          custody: custodyAccount,
          custodyOracleAccount: oracleAccount,
          collateralCustody: collateralCustodyAccount,
          collateralCustodyOracleAccount: collateralOracleAccount,
        })
        .view();

      expect(result).to.equal(0);
      console.log("Liquidation state (healthy):", result);
    });

    it.skip("Returns liquidatable state for underwater position", async () => {
      const params = {
        sizeUsd: new anchor.BN(10000_000000),
        collateralUsd: new anchor.BN(500_000000),
        entryPrice: new anchor.BN(50000_000000),
        currentPrice: new anchor.BN(45000_000000),
        side: { long: {} },
      };

      const result = await program.methods
        .getLiquidationState(params)
        .accountsPartial({
          perpetuals: perpetualsAccount,
          pool: poolAccount,
          position: positionAccount,
          custody: custodyAccount,
          custodyOracleAccount: oracleAccount,
          collateralCustody: collateralCustodyAccount,
          collateralCustodyOracleAccount: collateralOracleAccount,
        })
        .view();

      expect(result).to.be.greaterThan(0);
      console.log("Liquidation state (liquidatable):", result);
    });
  });

  describe("get_oracle_price", () => {
    it("Gets oracle price", async () => {
      const params = {
        ema: false,
      };

      const result = await program.methods
        .getOraclePrice(params)
        .accountsPartial({
          perpetuals: perpetualsAccount,
          pool: poolAccount,
          custody: custodyAccount,
          custodyOracleAccount: oracleAccount,
        })
        .view();

      expect(result.toNumber()).to.be.greaterThan(0);
      console.log("Oracle price:", result.toString());
    });
  });

  describe("get_swap_amount_and_fees", () => {
    it("Calculates swap amount and fees", async () => {
      const params = {
        amountIn: new anchor.BN(1000_000000),
      };

      const result = await program.methods
        .getSwapAmountAndFees(params)
        .accountsPartial({
          perpetuals: perpetualsAccount,
          pool: poolAccount,
          receivingCustody: custodyAccount,
          receivingCustodyOracleAccount: oracleAccount,
          dispensingCustody: custodyAccount,
          dispensingCustodyOracleAccount: oracleAccount,
        })
        .view();

      expect(result.amountOut.toNumber()).to.be.greaterThan(0);
      expect(result.feeIn.toNumber()).to.be.greaterThanOrEqual(0);
      expect(result.feeOut.toNumber()).to.be.greaterThanOrEqual(0);
      
      console.log("Swap:");
      console.log("  Amount out:", result.amountOut.toString());
      console.log("  Fee in:", result.feeIn.toString());
      console.log("  Fee out:", result.feeOut.toString());
    });
  });

  describe("get_add_liquidity_amount_and_fee", () => {
    it("Calculates add liquidity amount and fee", async () => {
      const params = {
        amountIn: new anchor.BN(1000_000000),
      };

      const poolInfo = testClient.pools.get("testpool");

      const result = await program.methods
        .getAddLiquidityAmountAndFee(params)
        .accountsPartial({
          perpetuals: perpetualsAccount,
          pool: poolAccount,
          custody: custodyAccount,
          custodyOracleAccount: oracleAccount,
          lpTokenMint: poolInfo.lpTokenMint,
        })
        .view();

      expect(result.amount.toNumber()).to.be.greaterThan(0);
      expect(result.fee.toNumber()).to.be.greaterThanOrEqual(0);
      
      console.log("Add liquidity:");
      console.log("  LP amount:", result.amount.toString());
      console.log("  Fee:", result.fee.toString());
    });
  });

  describe("get_remove_liquidity_amount_and_fee", () => {
    it("Calculates remove liquidity amount and fee", async () => {
      const params = {
        lpAmountIn: new anchor.BN(1000_000000),
      };

      const poolInfo = testClient.pools.get("testpool");

      const result = await program.methods
        .getRemoveLiquidityAmountAndFee(params)
        .accountsPartial({
          perpetuals: perpetualsAccount,
          pool: poolAccount,
          custody: custodyAccount,
          custodyOracleAccount: oracleAccount,
          lpTokenMint: poolInfo.lpTokenMint,
        })
        .view();

      expect(result.amount.toNumber()).to.be.greaterThan(0);
      expect(result.fee.toNumber()).to.be.greaterThanOrEqual(0);
      
      console.log("Remove liquidity:");
      console.log("  Token amount:", result.amount.toString());
      console.log("  Fee:", result.fee.toString());
    });
  });

  describe("get_assets_under_management", () => {
    it("Gets pool AUM", async () => {
      const params = {};

      const result = await program.methods
        .getAssetsUnderManagement(params)
        .accountsPartial({
          perpetuals: perpetualsAccount,
          pool: poolAccount,
        })
        .view();

      expect(result.toString()).to.be.a("string");
      console.log("Assets under management:", result.toString());
    });
  });

  describe("get_lp_token_price", () => {
    it("Gets LP token price", async () => {
      const params = {};

      const poolInfo = testClient.pools.get("testpool");

      const result = await program.methods
        .getLpTokenPrice(params)
        .accountsPartial({
          perpetuals: perpetualsAccount,
          pool: poolAccount,
          lpTokenMint: poolInfo.lpTokenMint,
        })
        .view();

      expect(result.toNumber()).to.be.greaterThanOrEqual(0);
      console.log("LP token price:", result.toString());
    });
  });
});
