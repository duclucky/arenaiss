import { FormEvent, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

import { useAppContext } from '../context';

export function EmailLoginModal({ onClose }: { onClose: () => void }) {
  const { requestEmailCode, signInWithEmail } = useAppContext();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [onClose]);

  async function submitEmail(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await requestEmailCode(email);
      setStep('code');
    } catch (reason) {
      setError(message(reason, 'Could not send the code. Check the address and try again.'));
    } finally { setBusy(false); }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signInWithEmail(email, code);
      onClose();
    } catch (reason) {
      setError(message(reason, 'The code is invalid or expired. Request a new code and try again.'));
    } finally { setBusy(false); }
  }

  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4 backdrop-blur-md">
    <div className="glass-panel relative w-full max-w-md p-6 outline-none" role="dialog" aria-modal="true" aria-labelledby="email-login-title">
      <button ref={closeRef} type="button" onClick={onClose} className="retro-icon-button absolute right-4 top-4" aria-label="Close email sign in"><X size={20} aria-hidden="true" /></button>
      <p className="mb-2 text-xs uppercase tracking-[.22em] text-neutral-600">Managed account</p>
      <h2 id="email-login-title" className="mb-3 text-2xl font-medium tracking-[-.035em]">Sign in with email</h2>
      <p className="mb-6 text-sm leading-relaxed text-neutral-700">Arena verifies your email, then uses a separate Circle-managed wallet for your account. Your email is not stored in plaintext.</p>

      {step === 'email' ? <form onSubmit={submitEmail} className="space-y-4">
        <div><label htmlFor="login-email" className="mb-2 block text-sm font-semibold">Email address</label><input id="login-email" className="field-control" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></div>
        <button className="metal-button-solid w-full" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
      </form> : <form onSubmit={submitCode} className="space-y-4">
        <p role="status" className="text-sm text-emerald-800">We sent a 6-digit code to your email.</p>
        <div><label htmlFor="login-code" className="mb-2 block text-sm font-semibold">6-digit code</label><input id="login-code" className="field-control font-mono" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></div>
        <button className="metal-button-solid w-full" type="submit" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify and sign in'}</button>
        <button className="metal-button-ghost w-full" type="button" disabled={busy} onClick={() => { setStep('email'); setCode(''); setError(''); }}>Use another email</button>
      </form>}
      {error && <p role="alert" className="mt-4 text-sm font-semibold text-destructive">{error}</p>}
    </div>
  </div>;
}

function message(reason: unknown, fallback: string): string {
  if (!(reason instanceof Error)) return fallback;
  if (reason.message.includes('unavailable') || reason.message.includes('NOT_CONFIGURED')) return 'Email sign-in is not configured on this server yet.';
  return fallback;
}
