import { useEffect, useRef, useState } from 'react';
import { useAppContext } from '../context';
import { WalletProvider } from '../adapters/interfaces';
import { X } from 'lucide-react';

export function WalletModal({ onClose }: { onClose: () => void }) {
  const { wallet, connectWallet } = useAppContext();
  const [providers, setProviders] = useState<WalletProvider[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  
  const modalRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocusedElement.current = document.activeElement as HTMLElement;
    
    wallet.getProviders().then(p => {
      setProviders(p);
      setStatus('idle');
    }).catch(() => {
      setStatus('error');
      setErrorMessage('Failed to discover providers.');
    });

    return () => {
      if (previouslyFocusedElement.current) {
        previouslyFocusedElement.current.focus();
      }
    };
  }, [wallet]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      
      if (e.key === 'Tab') {
        if (!modalRef.current) return;
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;
        
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement || document.activeElement === modalRef.current) {
            lastElement.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === lastElement || !modalRef.current.contains(document.activeElement)) {
            firstElement.focus();
            e.preventDefault();
          }
        }
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (modalRef.current) {
      const focusable = modalRef.current.querySelector('button');
      if (focusable) focusable.focus();
    }
  }, [status]);

  const handleConnect = async (providerUuid: string) => {
    setStatus('loading');
    setErrorMessage('');
    try {
      await connectWallet(providerUuid);
      onClose();
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err.message === 'NOT_CONFIGURED' ? 'Network or provider not configured' : 'Connection failed');
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4 backdrop-blur-md">
      <div
        ref={modalRef}
        tabIndex={-1}
        className="glass-panel relative w-full max-w-md rounded-[28px] bg-[#f8f5ee] p-6 outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <button
          onClick={onClose}
          className="retro-icon-button absolute top-4 right-4 focus:ring-2 focus:ring-ring focus:outline-none"
          aria-label="Close modal"
        >
          <X size={20} />
        </button>
        <p className="mb-2 text-xs uppercase tracking-[.22em] text-neutral-500">Arc Testnet</p><h2 id="modal-title" className="mb-6 text-2xl font-medium tracking-[-.035em]">Connect Wallet</h2>
        
        {status === 'loading' && (
          <p role="status" aria-live="polite" className="text-center py-4 text-muted-foreground">Loading...</p>
        )}
        
        {status === 'error' && (
          <p role="alert" className="text-center py-4 text-destructive">{errorMessage}</p>
        )}

        {status === 'idle' && (
          <div className="space-y-3">
            {providers.length > 0 ? (
              providers.map((p) => (
                <button
                  key={p.uuid}
                  onClick={() => handleConnect(p.uuid)}
                  className="retro-control flex min-h-14 w-full items-center justify-between p-4 focus:outline-none focus:ring-2 focus:ring-black"
                >
                  <span className="font-medium text-foreground">{p.name}</span>
                  <div className="w-6 h-6 bg-secondary rounded-full"></div>
                </button>
              ))
            ) : (
              <p className="text-muted-foreground text-center py-4">No providers detected.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
