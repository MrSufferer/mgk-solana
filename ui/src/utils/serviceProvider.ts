import { PerpetualsService } from '@/adapter/PerpetualsService';
import { WalletContextState } from '@solana/wallet-adapter-react';
import { getPerpetualProgramAndProvider } from '@/utils/constants';
import { PublicKey } from '@solana/web3.js';

let serviceInstance: PerpetualsService | null = null;

export async function getPerpetualsService(
  walletContextState?: WalletContextState
): Promise<PerpetualsService> {
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
      defaultCollateralCustody
    );

    await serviceInstance.initialize();
    console.log('✅ PerpetualsService initialized');
  }

  if (!serviceInstance.isReady()) {
    await serviceInstance.initialize();
  }

  return serviceInstance;
}

export function resetService(): void {
  serviceInstance = null;
}
