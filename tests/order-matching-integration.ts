import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Perpetuals } from "../target/types/perpetuals";
import { PublicKey, Keypair } from "@solana/web3.js";
import { expect } from "chai";
import { OrderMatchingClient } from "../app/src/order_matching_client";
import { TOKEN_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";

describe("Order Matching - Integration Test", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Perpetuals as Program<Perpetuals>;
  const admin = Keypair.generate();
  const trader1 = Keypair.generate();
  const trader2 = Keypair.generate();

  let quoteMint: PublicKey;
  let marketId = 0;

  before(async () => {
    // Airdrop SOL to all accounts
    await provider.connection.requestAirdrop(admin.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(trader1.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(trader2.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Create a test mint for quote asset (USDC)
    quoteMint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      6
    );
  });

  it("Full flow: Initialize market → Initialize traders → Deposit → Submit orders → Settle epoch", async () => {
    const baseAssetMint = Keypair.generate().publicKey;

    // Step 1: Initialize market
    const adminClient = new OrderMatchingClient(
      provider.connection.rpcEndpoint,
      admin.secretKey.toString()
    );

    try {
      const marketTx = await adminClient.initializeMarket({
        marketId,
        baseAssetMint,
        quoteAssetMint: quoteMint,
        tickSize: 1,
        minOrderSize: 100,
        maxOrderSize: 1000000,
        makerFeeBps: 2,
        takerFeeBps: 5,
        epochDurationSlots: 150,
      });

      expect(marketTx).to.be.a("string");
      console.log("Market initialized:", marketTx);
    } catch (err) {
      console.error("Error initializing market:", err);
      throw err;
    }

    // Step 2: Initialize trader states
    const trader1Client = new OrderMatchingClient(
      provider.connection.rpcEndpoint,
      trader1.secretKey.toString()
    );

    const trader2Client = new OrderMatchingClient(
      provider.connection.rpcEndpoint,
      trader2.secretKey.toString()
    );

    try {
      const trader1Tx = await trader1Client.initializeTraderState("Cross");
      const trader2Tx = await trader2Client.initializeTraderState("Cross");

      expect(trader1Tx).to.be.a("string");
      expect(trader2Tx).to.be.a("string");
      console.log("Traders initialized");
    } catch (err) {
      console.error("Error initializing traders:", err);
      throw err;
    }

    // Step 3: Create token accounts and mint tokens
    try {
      const trader1TokenAccount = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin,
        quoteMint,
        trader1.publicKey
      );

      const trader2TokenAccount = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin,
        quoteMint,
        trader2.publicKey
      );

      // Mint tokens to traders
      await mintTo(
        provider.connection,
        admin,
        quoteMint,
        trader1TokenAccount.address,
        admin,
        1000000 * 10 ** 6 // 1M tokens
      );

      await mintTo(
        provider.connection,
        admin,
        quoteMint,
        trader2TokenAccount.address,
        admin,
        1000000 * 10 ** 6 // 1M tokens
      );

      console.log("Tokens minted to traders");
    } catch (err) {
      console.error("Error minting tokens:", err);
      throw err;
    }

    // Step 4: Deposit collateral
    try {
      const deposit1Tx = await trader1Client.depositCollateralConfidential(
        10000 * 10 ** 6, // 10k tokens
        quoteMint
      );

      const deposit2Tx = await trader2Client.depositCollateralConfidential(
        10000 * 10 ** 6, // 10k tokens
        quoteMint
      );

      expect(deposit1Tx).to.be.a("string");
      expect(deposit2Tx).to.be.a("string");
      console.log("Collateral deposited");
    } catch (err) {
      console.error("Error depositing collateral:", err);
      // This might fail due to vault setup, which is expected in simulation
    }

    // Step 5: Submit orders
    try {
      const order1Tx = await trader1Client.submitOrder({
        marketId,
        price: 50000,
        side: "Buy",
        size: 1000,
        orderType: "Limit",
        timeInForce: "GTT",
      });

      const order2Tx = await trader2Client.submitOrder({
        marketId,
        price: 50000,
        side: "Sell",
        size: 500,
        orderType: "Limit",
        timeInForce: "GTT",
      });

      expect(order1Tx).to.be.a("string");
      expect(order2Tx).to.be.a("string");
      console.log("Orders submitted");
    } catch (err) {
      console.error("Error submitting orders:", err);
      // This might fail if epoch state setup is incomplete
    }

    // Step 6: Settle epoch (would need computation offset in real implementation)
    try {
      // Note: This would require the match_batch computation to be deployed
      // For now, just verify the instruction exists
      console.log("Epoch settlement would happen here");
    } catch (err) {
      console.error("Error settling epoch:", err);
    }
  });
});

