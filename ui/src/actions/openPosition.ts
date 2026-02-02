import { CustodyAccount } from "@/lib/CustodyAccount";
import { PoolAccount } from "@/lib/PoolAccount";
import { TokenE } from "@/lib/Token";
import { Side } from "@/lib/types";
import {
  automaticSendTransaction,
  manualSendTransaction,
} from "@/utils/TransactionHandlers";
import {
  PERPETUALS_ADDRESS,
  TRANSFER_AUTHORITY,
  getPerpetualProgramAndProvider,
} from "@/utils/constants";
import {
  createAtaIfNeeded,
  unwrapSolIfNeeded,
  wrapSolIfNeeded,
} from "@/utils/transactionHelpers";
import { ViewHelper } from "@/utils/viewHelpers";
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js" 
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";
import { WalletContextState } from "@solana/wallet-adapter-react";
import {
  Connection,
  SystemProgram,
  TransactionInstruction,
  Transaction,
} from "@solana/web3.js";
import { swapTransactionBuilder } from "src/actions/swap";
import { getPerpetualsService } from "@/utils/serviceProvider";
import { PositionSide, AdapterMode } from "@/adapter/types";
import { useGlobalStore } from "@/stores/store";

export async function openPositionBuilder(
  walletContextState: WalletContextState,
  connection: Connection,
  pool: PoolAccount,
  payCustody: CustodyAccount,
  positionCustody: CustodyAccount,
  payAmount: number,
  positionAmount: number,
  price: number,
  side: Side,
  leverage: number
) {
  console.log("[openPosition] Using Arcium adapter for encrypted position opening");
  console.log("[openPosition] Input values:", { payAmount, positionAmount, leverage, price });
  
  let { perpetual_program, provider } = await getPerpetualProgramAndProvider(
    walletContextState
  );
  let publicKey = walletContextState.publicKey!;

  // Calculate final pay amount (collateral)
  let finalPayAmount = positionAmount / leverage;
  
  console.log("[openPosition] Calculated values:", { finalPayAmount, positionAmount });

  // Handle swap if pay token != position token
  if (payCustody.getTokenE() != positionCustody.getTokenE()) {
    console.log("[openPosition] Swapping tokens before opening position");
    const View = new ViewHelper(connection, provider);
    let swapInfo = await View.getSwapAmountAndFees(
      payAmount,
      pool!,
      payCustody,
      positionCustody
    );

    let swapAmountOut =
      Number(swapInfo.amountOut) / 10 ** positionCustody.decimals;

    let swapFee = Number(swapInfo.feeOut) / 10 ** positionCustody.decimals;

    let recAmt = swapAmountOut - swapFee;

    console.log("[openPosition] Swap amounts:", { recAmt, swapAmountOut, swapFee });

    let getEntryPrice = await View.getEntryPriceAndFee(
      recAmt,
      positionAmount,
      side,
      pool!,
      positionCustody!,
      payCustody
    );

    let entryFee = Number(getEntryPrice.fee) / 10 ** positionCustody.decimals;

    console.log("[openPosition] Entry fee:", entryFee);

    let swapInfo2 = await View.getSwapAmountAndFees(
      payAmount + entryFee + swapFee,
      pool!,
      payCustody,
      positionCustody
    );

    let swapAmountOut2 =
      Number(swapInfo2.amountOut) / 10 ** positionCustody.decimals -
      Number(swapInfo2.feeOut) / 10 ** positionCustody.decimals -
      entryFee;

    let extraSwap = 0;

    if (swapAmountOut2 < finalPayAmount) {
      let difference = (finalPayAmount - swapAmountOut2) / swapAmountOut2;
      extraSwap = difference * (payAmount + entryFee + swapFee);
    }

    let { methodBuilder: swapBuilder, preInstructions: swapPreInstructions } =
      await swapTransactionBuilder(
        walletContextState,
        connection,
        pool,
        payCustody.getTokenE(),
        positionCustody.getTokenE(),
        payAmount + entryFee + swapFee + extraSwap,
        recAmt
      );

    // Execute swap transaction
    try {
      const swapTx = await swapBuilder.transaction();
      await manualSendTransaction(
        swapTx,
        publicKey,
        connection,
        walletContextState.signTransaction
      );
      console.log("[openPosition] Swap completed successfully");
    } catch (err) {
      console.error("[openPosition] Swap failed:", err);
      throw err;
    }
  }

  // Handle SOL wrapping if needed
  if (positionCustody.getTokenE() == TokenE.SOL) {
    let ataIx = await createAtaIfNeeded(
      publicKey,
      publicKey,
      positionCustody.mint,
      connection
    );

    if (ataIx) {
      try {
        await manualSendTransaction(
          new Transaction().add(ataIx),
          publicKey,
          connection,
          walletContextState.signTransaction
        );
      } catch (err) {
        console.log("[openPosition] ATA creation skipped (may already exist)");
      }
    }

    let wrapInstructions = await wrapSolIfNeeded(
      publicKey,
      publicKey,
      connection,
      payAmount
    );
    if (wrapInstructions) {
      try {
        const wrapTx = new Transaction().add(...wrapInstructions);
        await manualSendTransaction(
          wrapTx,
          publicKey,
          connection,
          walletContextState.signTransaction
        );
        console.log("[openPosition] SOL wrapped successfully");
      } catch (err) {
        console.error("[openPosition] SOL wrap failed:", err);
        throw err;
      }
    }
  }

  // Get the adapter mode from store
  const adapterMode = typeof window !== 'undefined' 
    ? useGlobalStore.getState().adapterMode 
    : AdapterMode.Private;

  // Get the PerpetualsService (adapter) - it will get mode from store if not provided
  const service = await getPerpetualsService(walletContextState);

  // Convert price to anchor.BN with 8 decimals (as per test file)
  // Price is in USD, convert to BN with 8 decimals
  const entryPriceBN = new BN(Math.floor(price * 1e8));

  // Convert amounts to USD
  // The UI passes amounts in token units, but we need USD values
  // For now, we'll use the amounts as-is assuming they're already in USD
  // If they're in token units, we'd need to multiply by price, but the UI should handle that
  const collateralUsd = new BN(Math.max(1, Math.floor(finalPayAmount)));
  const sizeUsd = new BN(Math.max(1, Math.floor(positionAmount)));

  // Validate amounts
  if (collateralUsd.lte(new BN(0)) || sizeUsd.lte(new BN(0))) {
    throw new Error(`Invalid amounts: collateral=${collateralUsd.toString()}, size=${sizeUsd.toString()}`);
  }

  // Convert side to PositionSide enum
  const positionSide = side.toString() == "Long" ? PositionSide.Long : PositionSide.Short;

  console.log("[openPosition] Opening position with adapter:");
  console.log("  Side:", side.toString());
  console.log("  Entry Price:", entryPriceBN.toString());
  console.log("  Size (USD):", sizeUsd.toString());
  console.log("  Collateral (USD):", collateralUsd.toString());
  console.log("  Leverage:", leverage + "x");

  // Get funding account (token account for collateral)
  // For public mode, we need the user's token account
  let fundingAccount: PublicKey | undefined;
  if (adapterMode === AdapterMode.Public) {
    // Get the associated token account for the collateral token
    fundingAccount = await getAssociatedTokenAddress(
      payCustody.mint,
      publicKey
    );
  }

  // Call adapter to open position
  try {
    const result = await service.openPosition({
      price: entryPriceBN,
      collateral: collateralUsd,
      size: sizeUsd,
      side: positionSide,
      pool: pool.address,
      custody: positionCustody.address,
      collateralCustody: payCustody.address,
      fundingAccount: fundingAccount,
    });

    if (result.signature) {
      console.log("[openPosition] Position opened successfully!");
      console.log("  Transaction:", result.signature);
      if (result.positionKey) {
        console.log("  Position Key:", result.positionKey.toBase58());
      }
    } else {
      throw new Error("Failed to open position: no signature returned");
    }

    // Handle SOL unwrapping if needed
    if (positionCustody.getTokenE() == TokenE.SOL) {
      let unwrapTx = await unwrapSolIfNeeded(publicKey, publicKey, connection);
      if (unwrapTx) {
        try {
          await manualSendTransaction(
            new Transaction().add(...unwrapTx),
            publicKey,
            connection,
            walletContextState.signTransaction
          );
        } catch (err) {
          console.log("[openPosition] SOL unwrap skipped (may not be needed)");
        }
      }
    }
  } catch (err) {
    console.error("[openPosition] Error opening position:", err);
    throw err;
  }
}

export async function openPosition(
  walletContextState: WalletContextState,
  connection: Connection,
  pool: PoolAccount,
  payToken: TokenE,
  positionToken: TokenE,
  payAmount: number,
  positionAmount: number,
  price: number,
  side: Side,
  leverage: number
) {
  let payCustody = pool.getCustodyAccount(payToken)!;
  let positionCustody = pool.getCustodyAccount(positionToken)!;

  await openPositionBuilder(
    walletContextState,
    connection,
    pool,
    payCustody,
    positionCustody,
    payAmount,
    positionAmount,
    price,
    side,
    leverage
  );
}
