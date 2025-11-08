import { CustodyAccount } from "@/lib/CustodyAccount";
import { PoolAccount } from "@/lib/PoolAccount";
import { TokenE } from "@/lib/Token";
import { Tab } from "@/lib/types";
import {
  getPerpetualProgramAndProvider,
  PERPETUALS_ADDRESS,
  TRANSFER_AUTHORITY,
} from "@/utils/constants";
import {
  automaticSendTransaction,
  manualSendTransaction,
} from "@/utils/TransactionHandlers";
import {
  createAtaIfNeeded,
  unwrapSolIfNeeded,
  wrapSolIfNeeded,
} from "@/utils/transactionHelpers";
import { BN } from "@coral-xyz/anchor";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { WalletContextState } from "@solana/wallet-adapter-react";
import {
  Connection,
  LAMPORTS_PER_SOL,
  TransactionInstruction,
  Transaction,
} from "@solana/web3.js";

export async function changeLiquidity(
  walletContextState: WalletContextState,
  connection: Connection,
  pool: PoolAccount,
  custody: CustodyAccount,
  tokenAmount: number,
  liquidityAmount: number,
  tab: Tab
) {
  let { perpetual_program } = await getPerpetualProgramAndProvider(
    walletContextState
  );
  let publicKey = walletContextState.publicKey!;

  let lpTokenAccount = await getAssociatedTokenAddress(
    pool.getLpTokenMint(),
    publicKey
  );

  let userCustodyTokenAccount = await getAssociatedTokenAddress(
    custody.mint,
    publicKey
  );

  let preInstructions: TransactionInstruction[] = [];

  // Always create LP token account to ensure it exists before the constraint check
  let lpTokenAccountAtaIx = await createAtaIfNeeded(
    publicKey,
    publicKey,
    pool.getLpTokenMint(),
    connection
  );

  if (lpTokenAccountAtaIx) preInstructions.push(lpTokenAccountAtaIx);

  if (custody.getTokenE() == TokenE.SOL) {
    let ataIx = await createAtaIfNeeded(
      publicKey,
      publicKey,
      custody.mint,
      connection
    );

    if (ataIx) preInstructions.push(ataIx);

    // Only wrap SOL when ADDING liquidity (spending SOL)
    // When REMOVING liquidity, we receive SOL, so no wrapping needed
    if (tab == Tab.Add) {
      let wrapInstructions = await wrapSolIfNeeded(
        publicKey,
        publicKey,
        connection,
        tokenAmount
      );
      if (wrapInstructions) {
        preInstructions.push(...wrapInstructions);
      }
    }
  }

  let postInstructions: TransactionInstruction[] = [];
  // Only unwrap SOL when removing liquidity (receiving SOL)
  if (custody.getTokenE() == TokenE.SOL && tab == Tab.Remove) {
    let unwrapTx = await unwrapSolIfNeeded(publicKey, publicKey, connection);
    if (unwrapTx) postInstructions.push(...unwrapTx);
  }

  let methodBuilder;

  if (tab == Tab.Add) {
    console.log("in add liq", tokenAmount);
    let amountIn;
    let minLpAmountOut = new BN(
      liquidityAmount * 10 ** pool.lpData.decimals * 0.8
    );
    if (custody.getTokenE() === TokenE.SOL) {
      amountIn = new BN(tokenAmount * LAMPORTS_PER_SOL);
    } else {
      amountIn = new BN(tokenAmount * 10 ** custody.decimals);
    }
    console.log("min lp out", Number(minLpAmountOut));
    methodBuilder = await perpetual_program.methods
      .addLiquidity({ amountIn, minLpAmountOut })
      .accounts({
        owner: publicKey,
        fundingAccount: userCustodyTokenAccount, // user token account for custody token account
        lpTokenAccount,
        transferAuthority: TRANSFER_AUTHORITY,
        perpetuals: PERPETUALS_ADDRESS,
        pool: pool.address,
        custody: custody.address,
        custodyOracleAccount: custody.oracle.oracleAccount,
        custodyTokenAccount: custody.tokenAccount,
        lpTokenMint: pool.getLpTokenMint(),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(pool.getCustodyMetas());

    console.log("created add method builder");
  } else if (tab == Tab.Remove) {
    console.log("in liq remove");
    let lpAmountIn = new BN(liquidityAmount * 10 ** pool.lpData.decimals);
    let minAmountOut;
    if (custody.getTokenE() === TokenE.SOL) {
      minAmountOut = new BN(tokenAmount * LAMPORTS_PER_SOL * 0.9);
    } else {
      minAmountOut = new BN(tokenAmount * 10 ** custody.decimals * 0.9);
    }
    methodBuilder = await perpetual_program.methods
      .removeLiquidity({ lpAmountIn, minAmountOut })
      .accounts({
        owner: publicKey,
        receivingAccount: userCustodyTokenAccount, // user token account for custody token account
        lpTokenAccount,
        transferAuthority: TRANSFER_AUTHORITY,
        perpetuals: PERPETUALS_ADDRESS,
        pool: pool.address,
        custody: custody.address,
        custodyOracleAccount: custody.oracle.oracleAccount,
        custodyTokenAccount: custody.tokenAccount,
        lpTokenMint: pool.getLpTokenMint(),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(pool.getCustodyMetas());
  }

  console.log("before pre");
  if (preInstructions)
    methodBuilder = methodBuilder.preInstructions(preInstructions);

  if (custody.getTokenE() == TokenE.SOL) {
    methodBuilder = methodBuilder.postInstructions(postInstructions);
  }

  console.log("after pre");
  try {
    // Use .transaction() to get the full transaction
    let tx = await methodBuilder.transaction();
    
    // DO NOT manually modify writable flags - Anchor encodes account metadata
    // in instruction data, and modifying flags breaks validation
    // The Rust program already marks custody_token_account and funding_account
    // as #[account(mut)], so Anchor should handle them correctly
    // Manually modifying flags causes InvalidAccountData errors in CPI calls
    
    await manualSendTransaction(
      tx,
      publicKey,
      connection,
      walletContextState.signTransaction
    );
  } catch (err: any) {
    console.error("=== changeLiquidity Error ===");
    console.error("Error:", err);
    console.error("Error message:", err?.message);
    console.error("Error stack:", err?.stack);
    
    // If the error has transaction details, log them
    if (err?.txid) {
      console.error("Transaction ID:", err.txid);
      try {
        const txDetails = await connection.getTransaction(err.txid, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        
        if (txDetails?.meta?.logMessages) {
          console.error("Transaction logs:", txDetails.meta.logMessages);
        }
      } catch (fetchErr) {
        console.error("Error fetching transaction details:", fetchErr);
      }
    }
    
    console.error("=== End changeLiquidity Error ===");
    throw err;
  }
}
