import { FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Mail, WalletCards, X } from 'lucide-react';

import { WalletProvider } from '../adapters/interfaces';
import { useAppContext } from '../context';
import { displayLabel } from '../display-label';
import { WalletLogo } from './WalletLogo';

type LoginMethod = 'choice' | 'wallet' | 'email';

export function LoginModal({ onClose, onAuthenticated }: { onClose: () => void; onAuthenticated?: () => void }) {
  const { connectWallet, managedIdentityEnabled, requestEmailCode, signInWithEmail, wallet } = useAppContext();
  const [method, setMethod] = useState<LoginMethod>('choice');
  const [providers, setProviders] = useState<WalletProvider[]>([]);
  const [walletStatus, setWalletStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [emailStep, setEmailStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocusedElement.current = document.activeElement as HTMLElement;
    closeRef.current?.focus();
    return () => previouslyFocusedElement.current?.focus();
  }, []);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !modalRef.current) return;
      const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        last.focus();
        event.preventDefault();
      } else if (!event.shiftKey && document.activeElement === last) {
        first.focus();
        event.preventDefault();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [onClose]);

  useEffect(() => {
    if (method !== 'wallet') return;
    let cancelled = false;
    setWalletStatus('loading');
    setError('');
    wallet.getProviders().then((detected) => {
      if (cancelled) return;
      setProviders(detected);
      setWalletStatus('idle');
    }).catch(() => {
      if (cancelled) return;
      setError('Failed to discover providers.');
      setWalletStatus('error');
    });
    return () => { cancelled = true; };
  }, [method, wallet]);

  useEffect(() => {
    closeRef.current?.focus();
  }, [method, walletStatus]);

  function choose(next: Exclude<LoginMethod, 'choice'>) {
    setError('');
    setMethod(next);
  }

  async function connect(providerUuid: string) {
    setWalletStatus('loading');
    setError('');
    try {
      await connectWallet(providerUuid);
      onAuthenticated?.();
      onClose();
    } catch (reason) {
      setWalletStatus('error');
      if (reason && typeof reason === 'object' && 'code' in reason && reason.code === 4001) {
        setError('Wallet request cancelled. Try again and approve the request in your wallet.');
      } else if (reason instanceof Error && reason.message === 'ARC_NETWORK_FAILED') {
        setError('Could not switch to Arc Testnet. Check your wallet network request and try again.');
      } else if (reason instanceof Error && reason.message === 'NOT_CONFIGURED') {
        setError('Network or provider not configured.');
      } else {
        setError('Connection failed.');
      }
    }
  }

  async function submitEmail(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const normalizedEmail = email.trim().toLowerCase();
      await requestEmailCode(normalizedEmail);
      setEmail(normalizedEmail);
      setEmailStep('code');
    } catch (reason) {
      setError(message(reason, 'Could not send the code. Check the address and try again.'));
    } finally { setBusy(false); }
  }

  async function resendCode() {
    setBusy(true);
    setError('');
    try {
      await requestEmailCode(email);
      setCode('');
    } catch (reason) {
      setError(message(reason, 'Could not resend the code. Check the address and try again.'));
    } finally { setBusy(false); }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signInWithEmail(email, code);
      onAuthenticated?.();
      onClose();
    } catch (reason) {
      setError(message(reason, 'The code is invalid or expired. Request a new code and try again.'));
    } finally { setBusy(false); }
  }

  const title = method === 'choice' ? 'Sign in to Arena ISS' : method === 'wallet' ? 'Connect a wallet' : 'Sign in with email';

  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4 backdrop-blur-md">
    <div ref={modalRef} tabIndex={-1} className="glass-panel relative w-full max-w-md rounded-[28px] bg-[#f8f5ee] p-6 outline-none" role="dialog" aria-modal="true" aria-labelledby="login-modal-title">
      <button ref={closeRef} type="button" onClick={onClose} className="retro-icon-button absolute right-4 top-4" aria-label="Close login"><X size={20} aria-hidden="true" /></button>
      {method !== 'choice' && <button type="button" onClick={() => { setMethod('choice'); setError(''); }} className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold underline underline-offset-4"><ArrowLeft size={17} aria-hidden="true" />Back</button>}
      <p className="mb-2 text-xs uppercase tracking-[.22em] text-neutral-600">Arena account</p>
      <h2 id="login-modal-title" className="mb-3 text-2xl font-medium tracking-[-.035em]">{title}</h2>

      {method === 'choice' && <>
        <p className="mb-6 text-sm leading-relaxed text-neutral-700">Choose how you want to access your Arena account.</p>
        <div className="space-y-3">
          <button type="button" aria-label="Continue with wallet" onClick={() => choose('wallet')} className="login-method-button retro-control flex min-h-14 w-full items-center gap-3 p-4 text-left focus:outline-none focus:ring-2 focus:ring-black"><WalletCards size={21} aria-hidden="true" /><span className="min-w-0 flex-1"><strong className="block">Continue with wallet</strong><span className="text-xs text-neutral-600">Use an installed EVM provider</span></span></button>
          <button type="button" aria-label="Continue with email" onClick={() => choose('email')} disabled={!managedIdentityEnabled} className="login-method-button retro-control flex min-h-14 w-full items-center gap-3 p-4 text-left focus:outline-none focus:ring-2 focus:ring-black disabled:cursor-not-allowed disabled:opacity-50"><Mail size={21} aria-hidden="true" /><span className="min-w-0 flex-1"><strong className="block">Continue with email</strong><span className="text-xs text-neutral-600">{managedIdentityEnabled ? 'Verify by one-time code' : 'Not configured on this server yet'}</span></span></button>
        </div>
      </>}

      {method === 'wallet' && <div className="mt-6 space-y-3">
        {walletStatus === 'loading' && <p role="status" className="py-4 text-center text-muted-foreground">Loading providers…</p>}
        {walletStatus === 'idle' && (providers.length > 0 ? providers.map((provider) => <button key={provider.uuid} type="button" onClick={() => connect(provider.uuid)} className="retro-control flex min-h-14 w-full items-center gap-3 p-4 text-left focus:outline-none focus:ring-2 focus:ring-black"><WalletLogo provider={provider} /><span className="min-w-0 flex-1 truncate font-medium">{provider.name}</span></button>) : <p className="py-4 text-center text-muted-foreground">No providers detected.</p>)}
      </div>}

      {method === 'email' && <div className="mt-5">
        <p className="mb-5 text-sm leading-relaxed text-neutral-700">Arena verifies your email, then uses a separate Circle-managed wallet. Your email is not stored in plaintext.</p>
        {emailStep === 'email' ? <form onSubmit={submitEmail} className="space-y-4"><div><label htmlFor="login-email" className="mb-2 block text-sm font-semibold">Email address</label><input id="login-email" className="field-control" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></div><button className="metal-button-solid w-full" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button></form> : <form onSubmit={submitCode} className="space-y-4"><div role="status" className="text-sm leading-relaxed text-emerald-800"><p>Code sent to <strong className="break-all">{email}</strong>.</p><p className="mt-1 text-xs text-neutral-700">Check the spelling and your spam folder. Only the newest code works.</p></div><div><label htmlFor="login-code" className="mb-2 block text-sm font-semibold">6-digit code</label><input id="login-code" className="field-control font-mono" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></div><button className="metal-button-solid w-full" type="submit" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify and sign in'}</button><button className="metal-button-ghost w-full" type="button" disabled={busy} onClick={resendCode}>{busy ? 'Sending…' : 'Resend code'}</button><button className="metal-button-ghost w-full" type="button" disabled={busy} onClick={() => { setEmailStep('email'); setCode(''); setError(''); }}>Use another email</button></form>}
      </div>}

      {error && <p role="alert" className="mt-4 text-sm font-semibold text-destructive">{displayLabel(error)}</p>}
    </div>
  </div>;
}

function message(reason: unknown, fallback: string): string {
  if (!(reason instanceof Error)) return fallback;
  if (reason.message.includes('unavailable') || reason.message.includes('NOT_CONFIGURED')) return 'Email sign-in is not configured on this server yet.';
  return fallback;
}
