import { CustodyAccount } from "@/lib/CustodyAccount";
import { PoolAccount } from "@/lib/PoolAccount";
import { Pool } from "@/lib/types";
import { getPerpetualProgramAndProvider } from "@/utils/constants";
import { ViewHelper } from "@/utils/viewHelpers";
import { getMint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

interface FetchPool {
  account: Pool;
  publicKey: PublicKey;
}

export async function getPoolData(
  custodyInfos: Record<string, CustodyAccount>
): Promise<Record<string, PoolAccount>> {
  let { perpetual_program, provider } = await getPerpetualProgramAndProvider();

  // @ts-ignore
  let fetchedPools: FetchPool[] = await perpetual_program.account.pool.all();
  let poolObjs: Record<string, PoolAccount> = {};

  await Promise.all(
    Object.values(fetchedPools)
      .sort((a, b) => a.account.name.localeCompare(b.account.name))
      .map(async (pool: FetchPool, idx: number) => {
        // Skip pools at indices 0 and 1 (DevPool and DevPool1)
        if (idx < 2) {
          console.warn(
            `Skipping pool ${pool.account.name} at index ${idx} (only processing from index 2 onwards)`
          );
          return;
        }

        const lpTokenMint = PublicKey.findProgramAddressSync(
          [Buffer.from("lp_token_mint"), pool.publicKey.toBuffer()],
          perpetual_program.programId
        )[0];

        let lpData;
        try {
          lpData = await getMint(provider.connection, lpTokenMint);
        } catch (error) {
          console.warn(
            `LP token mint not initialized for pool ${pool.account.name} (${lpTokenMint.toString()}), skipping...`
          );
          return;
        }

        const View = new ViewHelper(provider.connection, provider);

        console.log("fetching pools actual data", pool);

        let poolData: Pool = {
          name: pool.account.name,
          custodies: pool.account.custodies,
          ratios: pool.account.ratios,
          aumUsd: pool.account.aumUsd,
          bump: pool.account.bump,
          lpTokenBump: pool.account.lpTokenBump,
          inceptionTime: pool.account.inceptionTime,
        };

        const poolAccount = new PoolAccount(
          poolData,
          custodyInfos,
          pool.publicKey,
          lpData,
          idx
        );
        poolObjs[pool.publicKey.toString()] = poolAccount;
        
        // Try to fetch AUM with retry limit to avoid infinite loops on rate limits
        let fetchedAum;
        const maxRetries = 3;
        let retryCount = 0;
        let success = false;

        while (retryCount < maxRetries && !success) {
          try {
            fetchedAum = await View.getAssetsUnderManagement(poolAccount);
            success = true;
          } catch (error) {
            retryCount++;
            if (retryCount < maxRetries) {
              // Exponential backoff: 500ms, 1000ms, 2000ms
              const delay = 500 * Math.pow(2, retryCount - 1);
              console.warn(
                `Failed to fetch AUM for pool ${pool.account.name}, retrying in ${delay}ms (${retryCount}/${maxRetries})...`
              );
              await new Promise((resolve) => setTimeout(resolve, delay));
            } else {
              console.warn(
                `Failed to fetch AUM for pool ${pool.account.name} after ${maxRetries} retries, using pool account AUM value`
              );
              // Use the AUM value from the pool account data as fallback
              fetchedAum = poolData.aumUsd;
            }
          }
        }

        if (fetchedAum) {
          poolAccount.setAum(fetchedAum);
        }
      })
  );

  return poolObjs;
}
