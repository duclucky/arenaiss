'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useArena, useArenaDispatch } from '@/app/arena/state';
import { fetchAccountSave, fetchSession, loginAccount, logoutAccount, putAccountSave, registerAccount, type PublicUser } from '@/lib/client/auth';
import { serializeArenaSave } from '@/lib/game/save';

type Mode = 'login' | 'register';

export function AuthPanel() {
  const state = useArena();
  const dispatch = useArenaDispatch();
  const [mode, setMode] = useState<Mode>('login');
  const [user, setUser] = useState<PublicUser | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('Data is saved only on this device.');
  const [busy, setBusy] = useState(false);
  const loadedSession = useRef(false);
  const suppressNextSync = useRef(false);

  const currentSave = useMemo(() => serializeArenaSave({
    category: state.category,
    credits: state.credits,
    roster: state.roster,
    deckTokens: state.deckTokens,
    packCount: state.packCount,
    pullHistory: state.pullHistory,
    lastCreditRefillAt: state.lastCreditRefillAt,
    passportHintSeen: state.passportHintSeen,
  }), [
    state.category,
    state.credits,
    state.roster,
    state.deckTokens,
    state.packCount,
    state.pullHistory,
    state.lastCreditRefillAt,
    state.passportHintSeen,
  ]);

  useEffect(() => {
    if (!state.saveReady || loadedSession.current) return;
    loadedSession.current = true;
    fetchSession().then(async (sessionUser) => {
      if (!sessionUser) return;
      setUser(sessionUser);
      const accountSave = await fetchAccountSave();
      if (accountSave) {
        suppressNextSync.current = true;
        dispatch({
          type: 'HYDRATE_SAVE',
          save: accountSave,
          credits: accountSave.credits,
          lastCreditRefillAt: accountSave.lastCreditRefillAt,
        });
        setMessage(`Signed in as ${sessionUser.username}. Account save loaded.`);
      } else {
        await putAccountSave(currentSave);
        setMessage(`Signed in as ${sessionUser.username}. Anonymous progress synced.`);
      }
    });
  }, [currentSave, dispatch, state.saveReady]);

  useEffect(() => {
    if (!user || !state.saveReady) return;
    if (suppressNextSync.current) {
      suppressNextSync.current = false;
      return;
    }
    const timer = setTimeout(() => {
      putAccountSave(currentSave).then((saved) => {
        if (saved) setMessage(`Signed in as ${user.username}. Account save synced.`);
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [currentSave, state.saveReady, user]);

  async function register() {
    setBusy(true);
    setMessage('');
    const result = await registerAccount(username, password, confirmPassword);
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error ?? 'Registration failed.');
      return;
    }
    setMode('login');
    setPassword('');
    setConfirmPassword('');
    setMessage('Account created. Sign in with your username and password.');
  }

  async function login() {
    setBusy(true);
    setMessage('');
    const result = await loginAccount(username, password);
    setBusy(false);
    if (!result.ok || !result.user) {
      setMessage(result.error ?? 'Login failed.');
      return;
    }
    setUser(result.user);
    setPassword('');
    setConfirmPassword('');
    const accountSave = await fetchAccountSave();
    if (accountSave) {
      suppressNextSync.current = true;
      dispatch({
        type: 'HYDRATE_SAVE',
        save: accountSave,
        credits: accountSave.credits,
        lastCreditRefillAt: accountSave.lastCreditRefillAt,
      });
      setMessage(`Signed in as ${result.user.username}. Account save loaded.`);
    } else {
      await putAccountSave(currentSave);
      setMessage(`Signed in as ${result.user.username}. Anonymous progress synced.`);
    }
  }

  async function logout() {
    await logoutAccount();
    setUser(null);
    setPassword('');
    setConfirmPassword('');
    setMessage('Signed out. Data is saved only on this device.');
  }

  if (user) {
    return (
      <div className="auth-panel">
        <div className="auth-panel-row">
          <span className="chip" title="Server-side demo account save">{user.username}</span>
          <button className="btn btn-ghost" style={{ padding: '6px 9px', fontSize: 12 }} onClick={logout}>Logout</button>
        </div>
        <div className="auth-message">{message}</div>
      </div>
    );
  }

  return (
    <div className="auth-panel">
      <div className="auth-panel-tabs">
        <button className={`auth-tab${mode === 'login' ? ' active' : ''}`} onClick={() => setMode('login')}>Login</button>
        <button className={`auth-tab${mode === 'register' ? ' active' : ''}`} onClick={() => setMode('register')}>Register</button>
      </div>
      <div className="auth-panel-row">
        <input className="auth-input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" autoComplete="username" />
        <input className="auth-input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        {mode === 'register' && (
          <input className="auth-input" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="confirm" type="password" autoComplete="new-password" />
        )}
        <button className="btn btn-primary" style={{ padding: '7px 10px', fontSize: 12 }} disabled={busy} onClick={mode === 'login' ? login : register}>
          {mode === 'login' ? 'Login' : 'Register'}
        </button>
      </div>
      <div className="auth-message">{message}</div>
    </div>
  );
}
