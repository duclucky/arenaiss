import { useAppContext } from '../context';
import { ShieldAlert } from 'lucide-react';
import { useState, useEffect } from 'react';

export function Account() {
  const { account, networkConfig, disconnectWallet, wallet } = useAppContext();
  const [balanceState, setBalanceState] = useState<'loading' | 'unavailable' | string>('loading');

  useEffect(() => {
    if (account && networkConfig) {
      setBalanceState('loading');
      wallet.getBalance(account, networkConfig)
        .then(val => {
          setBalanceState(formatUsdc(val));
        })
        .catch(() => setBalanceState('unavailable'));
    } else {
      setBalanceState('unavailable');
    }
  }, [account, networkConfig, wallet]);

  return (
    <div className="mx-auto max-w-3xl space-y-7">
      <div><p className="page-kicker">Wallet</p><h1 className="page-title">Account</h1></div>

      {!networkConfig && (
        <div className="glass-panel flex items-start gap-3 rounded-lg border-red-400/40 p-4">
          <ShieldAlert className="text-destructive mt-0.5 shrink-0" size={20} />
          <div>
            <h3 className="font-bold text-destructive">Network Not Configured</h3>
            <p className="text-sm text-foreground/80 mt-1">Cannot fetch live account balances or activity.</p>
          </div>
        </div>
      )}

      <div className="glass-panel rounded-[28px] p-6 md:p-8">
        {account ? (
          <div className="space-y-6">
            <div>
              <label className="text-sm text-muted-foreground uppercase tracking-wider font-bold block mb-1">Connected Address</label>
              <div className="retro-inset mt-2 break-all p-4 font-mono text-sm">
                {account}
              </div>
            </div>

            <div>
              <label className="text-sm text-muted-foreground uppercase tracking-wider font-bold block mb-1">USDC Balance</label>
              <div className="text-4xl font-medium tracking-[-.04em] tabular-nums">
                {balanceState === 'loading' && <span role="status" className="text-muted-foreground animate-pulse">Loading...</span>}
                {balanceState === 'unavailable' && <span role="alert" className="text-destructive text-base font-normal">Unavailable</span>}
                {balanceState !== 'loading' && balanceState !== 'unavailable' && <span>{balanceState} USDC</span>}
              </div>
            </div>

            <div className="pt-4 border-t border-border flex justify-end">
              <button
                onClick={disconnectWallet}
                className="metal-button-ghost border-red-800/50 text-red-900"
              >
                Disconnect Wallet
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">No wallet connected.</p>
            <p className="text-sm">Use the sidebar to connect a provider.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function formatUsdc(baseUnits: string): string {
  if (!/^\d+$/.test(baseUnits)) throw new Error('INVALID_BALANCE');
  const value = BigInt(baseUnits);
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : `${whole}.00`;
}
