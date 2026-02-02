import { PerpetualsService } from '@/adapter/PerpetualsService';
import { AdapterMode } from '@/adapter/types';
import { WalletContextState } from '@solana/wallet-adapter-react';
import { getPerpetualProgramAndProvider, ARCIUM_CLUSTER_OFFSET } from '@/utils/constants';
import { PublicKey } from '@solana/web3.js';
import { useGlobalStore } from '@/stores/store';

let serviceInstance: PerpetualsService | null = null;
let currentMode: AdapterMode | null = null;

export async function getPerpetualsService(
  walletContextState?: WalletContextState,
  mode?: AdapterMode
): Promise<PerpetualsService> {
  // Get mode from store if not provided
  const storeMode = typeof window !== 'undefined' 
    ? useGlobalStore.getState().adapterMode 
    : AdapterMode.Private;
  const adapterMode = mode || storeMode;

  // Reset service if mode changed
  if (serviceInstance && currentMode !== adapterMode) {
    serviceInstance.setMode(adapterMode);
    currentMode = adapterMode;
  }

  if (!serviceInstance) {
    const { perpetual_program, provider } = await getPerpetualProgramAndProvider(
      walletContextState
    );

    const defaultPool = new PublicKey("11111111111111111111111111111111");
    const defaultCustody = new PublicKey("11111111111111111111111111111111");
    const defaultCollateralCustody = new PublicKey("11111111111111111111111111111111");

    serviceInstance = new PerpetualsService(
      perpetual_program,
      provider,
      defaultPool,
      defaultCustody,
      defaultCollateralCustody,
      ARCIUM_CLUSTER_OFFSET,
      adapterMode
    );

    // Only initialize if in private mode (public mode doesn't need encryption)
    if (adapterMode === AdapterMode.Private) {
      await serviceInstance.initialize();
    }
    currentMode = adapterMode;
    console.log(`✅ PerpetualsService initialized in ${adapterMode} mode`);
  }

  if (!serviceInstance.isReady() && adapterMode === AdapterMode.Private) {
    await serviceInstance.initialize();
  }

  return serviceInstance;
}

export function resetService(): void {
  serviceInstance = null;
}
