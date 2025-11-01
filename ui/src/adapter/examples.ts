/**
 * Example usage of the Perpetuals DEX Adapter
 * 
 * This file demonstrates how to use the adapter to integrate
 * the encrypted perpetuals program with a UI that expects
 * the original perpetuals interface.
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { PerpetualsAdapter, PositionSide } from "./index";

/**
 * Example: Initialize the adapter and open a position
 */
async function exampleOpenPosition() {
  // Setup Anchor provider and program
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Blackjack as anchor.Program;

  // Create adapter instance
  const adapter = new PerpetualsAdapter({
    program,
    provider,
    // Optional: Set default accounts
    defaultPool: new PublicKey("YOUR_POOL_PUBKEY"),
    defaultCustody: new PublicKey("YOUR_CUSTODY_PUBKEY"),
    defaultCollateralCustody: new PublicKey("YOUR_COLLATERAL_CUSTODY_PUBKEY"),
  });

  // Initialize encryption (required before trading)
  await adapter.initialize();
  console.log("✅ Adapter initialized");

  // Open a long position
  const result = await adapter.openPosition({
    price: new anchor.BN(50000_00000000), // $50,000 with 8 decimals
    collateral: new anchor.BN(1000), // $1,000 USD
    size: new anchor.BN(10000), // $10,000 USD (10x leverage)
    side: PositionSide.Long,
  });

  if (result.success) {
    console.log("✅ Position opened!");
    console.log("  Transaction:", result.signature);
    console.log("  Position Key:", result.positionKey?.toBase58());

    // Fetch the position to see decrypted data
    if (result.positionKey) {
      const position = await adapter.getPosition(result.positionKey);
      console.log("  Position data:", {
        owner: position?.owner.toBase58(),
        side: position?.side === PositionSide.Long ? "Long" : "Short",
        entryPrice: position?.price.toString(),
        sizeUsd: position?.sizeUsd.toString(),
        collateralUsd: position?.collateralUsd.toString(),
      });
    }
  } else {
    console.error("❌ Failed to open position:", result.error);
  }
}

/**
 * Example: Close a position
 */
async function exampleClosePosition(positionKey: PublicKey) {
  const provider = anchor.AnchorProvider.env();
  const program = anchor.workspace.Blackjack as anchor.Program;

  const adapter = new PerpetualsAdapter({ program, provider });
  await adapter.initialize();

  const result = await adapter.closePosition({
    positionKey,
    // Optional: specify exit price, otherwise uses oracle
    // price: new anchor.BN(52000_00000000)
  });

  if (result.success) {
    console.log("✅ Position closed!");
    console.log("  Transaction:", result.signature);
  } else {
    console.error("❌ Failed to close position:", result.error);
  }
}

/**
 * Example: Add collateral to a position
 */
async function exampleAddCollateral(positionKey: PublicKey) {
  const provider = anchor.AnchorProvider.env();
  const program = anchor.workspace.Blackjack as anchor.Program;

  const adapter = new PerpetualsAdapter({ program, provider });
  await adapter.initialize();

  const result = await adapter.addCollateral({
    positionKey,
    collateral: new anchor.BN(500), // Add $500 USD
  });

  if (result.success) {
    console.log("✅ Collateral added!");
    console.log("  Transaction:", result.signature);
  } else {
    console.error("❌ Failed to add collateral:", result.error);
  }
}

/**
 * Example: Get all positions for connected wallet
 */
async function exampleGetPositions() {
  const provider = anchor.AnchorProvider.env();
  const program = anchor.workspace.Blackjack as anchor.Program;

  const adapter = new PerpetualsAdapter({ program, provider });
  await adapter.initialize();

  // Get all positions for connected wallet
  const positions = await adapter.getPositionsByOwner();

  console.log(`Found ${positions.length} position(s)`);
  positions.forEach((pos, i) => {
    console.log(`\nPosition ${i + 1}:`);
    console.log("  Owner:", pos.owner.toBase58());
    console.log("  Side:", pos.side === PositionSide.Long ? "Long" : "Short");
    console.log("  Entry Price:", pos.price.toString());
    console.log("  Size (USD):", pos.sizeUsd.toString());
    console.log("  Collateral (USD):", pos.collateralUsd.toString());
    console.log("  Opened:", new Date(pos.openTime.toNumber() * 1000).toISOString());
  });
}

/**
 * Example: Get entry price and fee (view function)
 */
async function exampleGetEntryPrice() {
  const provider = anchor.AnchorProvider.env();
  const program = anchor.workspace.Blackjack as anchor.Program;

  const adapter = new PerpetualsAdapter({ program, provider });
  await adapter.initialize();

  const result = await adapter.getEntryPriceAndFee(
    new anchor.BN(10000), // $10,000 position size
    PositionSide.Long
  );

  if (result) {
    console.log("Entry price and fee:");
    console.log("  Price:", result.price.toString());
    console.log("  Fee:", result.fee.toString());
  }
}

/**
 * Example: Integration with existing UI code
 * 
 * This shows how to drop in the adapter as a replacement
 * for the original perpetuals program client.
 */
class PerpetualsTradingUI {
  private adapter: PerpetualsAdapter;

  constructor(program: anchor.Program, provider: anchor.AnchorProvider) {
    this.adapter = new PerpetualsAdapter({
      program,
      provider,
      // Configure defaults from UI settings
    });
  }

  async init() {
    await this.adapter.initialize();
  }

  // Original UI method signature - no changes needed!
  async openLongPosition(
    entryPrice: number,
    collateralAmount: number,
    positionSize: number
  ) {
    return await this.adapter.openPosition({
      price: new anchor.BN(entryPrice),
      collateral: new anchor.BN(collateralAmount),
      size: new anchor.BN(positionSize),
      side: PositionSide.Long,
    });
  }

  // Original UI method signature - no changes needed!
  async closePosition(positionKey: PublicKey) {
    return await this.adapter.closePosition({ positionKey });
  }

  // Original UI method signature - no changes needed!
  async getUserPositions() {
    return await this.adapter.getPositionsByOwner();
  }

  // Original UI method signature - no changes needed!
  async addCollateralToPosition(positionKey: PublicKey, amount: number) {
    return await this.adapter.addCollateral({
      positionKey,
      collateral: new anchor.BN(amount),
    });
  }
}

// Export examples
export {
  exampleOpenPosition,
  exampleClosePosition,
  exampleAddCollateral,
  exampleGetPositions,
  exampleGetEntryPrice,
  PerpetualsTradingUI,
};

/**
 * Main function to run examples
 */
async function main() {
  console.log("🚀 Perpetuals DEX Adapter Examples\n");

  try {
    // Example 1: Open a position
    console.log("📝 Example 1: Opening a position...");
    await exampleOpenPosition();

    // Example 2: Get positions
    console.log("\n📝 Example 2: Fetching positions...");
    await exampleGetPositions();

    // Example 3: Get entry price
    console.log("\n📝 Example 3: Getting entry price...");
    await exampleGetEntryPrice();
  } catch (error) {
    console.error("Error running examples:", error);
  }
}

// Uncomment to run examples
// main();
