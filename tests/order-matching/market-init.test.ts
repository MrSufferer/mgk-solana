import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Perpetuals } from "../../target/types/perpetuals";
import { PublicKey, Keypair } from "@solana/web3.js";
import { expect } from "chai";
import { OrderMatchingClient } from "../../app/src/order_matching_client";

describe("Order Matching - Market Initialization", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Perpetuals as Program<Perpetuals>;
  const admin = Keypair.generate();

  it("Initializes a new market", async () => {
    const marketId = 0;
    const baseAssetMint = Keypair.generate().publicKey;
    const quoteAssetMint = Keypair.generate().publicKey;

    // Airdrop SOL to admin
    await provider.connection.requestAirdrop(admin.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const client = new OrderMatchingClient(
      provider.connection.rpcEndpoint,
      admin.secretKey.toString()
    );

    try {
      const tx = await client.initializeMarket({
        marketId,
        baseAssetMint,
        quoteAssetMint,
        tickSize: 1,
        minOrderSize: 100,
        maxOrderSize: 1000000,
        makerFeeBps: 2,
        takerFeeBps: 5,
        epochDurationSlots: 150,
      });

      expect(tx).to.be.a("string");

      // Verify market state was created
      const marketStatePDA = client.getMarketStatePDA(marketId);
      const marketState = await program.account.marketState.fetch(marketStatePDA);

      expect(marketState.marketId).to.equal(marketId);
      expect(marketState.baseAssetMint.toString()).to.equal(baseAssetMint.toString());
      expect(marketState.quoteAssetMint.toString()).to.equal(quoteAssetMint.toString());
    } catch (err) {
      console.error("Error initializing market:", err);
      throw err;
    }
  });
});

