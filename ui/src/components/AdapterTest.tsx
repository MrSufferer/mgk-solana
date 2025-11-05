import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { getPerpetualsService } from '@/utils/serviceProvider';

export function AdapterTest() {
  const [status, setStatus] = useState('Initializing...');
  const [details, setDetails] = useState<any>(null);
  const wallet = useWallet();

  useEffect(() => {
    async function testAdapter() {
      try {
        setStatus('⏳ Initializing adapter...');
        const service = await getPerpetualsService(wallet as any);
        
        setStatus('✅ Adapter initialized successfully!');
        setDetails({
          ready: service.isReady(),
          adapter: service.getAdapter() ? 'Available' : 'Not available',
        });
      } catch (err: any) {
        setStatus(`❌ Error: ${err.message}`);
        console.error('Adapter initialization error:', err);
      }
    }

    if (wallet.connected) {
      testAdapter();
    } else {
      setStatus('⏳ Please connect wallet...');
    }
  }, [wallet.connected]);

  return (
    <div className="p-4 border rounded bg-gray-800 text-white">
      <h3 className="text-lg font-bold mb-2">Adapter Status</h3>
      <p className="mb-2">{status}</p>
      {details && (
        <pre className="text-xs bg-gray-900 p-2 rounded">
          {JSON.stringify(details, null, 2)}
        </pre>
      )}
    </div>
  );
}
