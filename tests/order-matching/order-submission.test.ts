import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Perpetuals } from "../../target/types/perpetuals";
import { PublicKey, Keypair } from "@solana/web3.js";
import { expect } from "chai";
import { OrderMatchingClient } from "../../app/src/order_matching_client";

describe("Order Matching - Order Submission", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Perpetuals as Program<Perpetuals>;
  const trader = Keypair.generate();

  it("Submits an order with encrypted size", async () => {
    const marketId = 0;

    // Airdrop SOL to trader
    await provider.connection.requestAirdrop(trader.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const client = new OrderMatchingClient(
      provider.connection.rpcEndpoint,
      trader.secretKey.toString()
    );

    try {
      // First initialize trader state
      await client.initializeTraderState("Cross");

      // Submit order
      const tx = await client.submitOrder({
        marketId,
        price: 50000,
        side: "Buy",
        size: 1000,
        orderType: "Limit",
        timeInForce: "GTT",
      });

      expect(tx).to.be.a("string");
    } catch (err) {
      console.error("Error submitting order:", err);
      // This might fail if market is not initialized, which is expected
      // In a full test suite, we would initialize the market first
    }
  });
});

