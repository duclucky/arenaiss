import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { useAppContext } from '../context';
import { WalletModal } from './WalletModal';
import { EmailLoginModal } from './EmailLoginModal';

const navItems = [
  ['/tournaments', 'Tournaments'],
  ['/agents', 'Agents'],
  ['/evaluations', 'Evaluations'],
  ['/account', 'Account'],
] as const;

export function Layout() {
  const { account, disconnectWallet, managedIdentityEnabled } = useAppContext();
  const location = useLocation();
  const isHome = location.pathname === '/';
  const [walletOpen, setWalletOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMenuOpen(false);
    setAccountOpen(false);
    document.body.classList.remove('menu-open');
  }, [location.pathname]);

  useEffect(() => {
    document.body.classList.toggle('menu-open', menuOpen);
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        setAccountOpen(false);
      }
    };
    const resize = () => { if (window.innerWidth >= 768) setMenuOpen(false); };
    document.addEventListener('keydown', close);
    window.addEventListener('resize', resize);
    return () => {
      document.body.classList.remove('menu-open');
      document.removeEventListener('keydown', close);
      window.removeEventListener('resize', resize);
    };
  }, [menuOpen]);

  async function disconnect() {
    await disconnectWallet();
    setAccountOpen(false);
  }

  return <div className={clsx('app-shell', isHome && 'app-shell--hero')} data-surface={isHome ? 'immersive' : 'editorial'}>
    <div className="site-grain" aria-hidden="true" />
    <header className={clsx('site-header', isHome && 'site-header--hero')}>
      <Link to="/" aria-label="Arena ISS" className="brand-lockup">
        <span>Arena ISS</span><span className="brand-star" aria-hidden="true">✳︎</span>
      </Link>

      <nav id="site-nav" aria-label="Primary" data-open={menuOpen} className="primary-nav">
        {navItems.map(([to, label]) => <NavLink key={to} to={to} className={({ isActive }) => clsx('nav-link', isActive && 'is-active')}>{label}</NavLink>)}
      </nav>

      <div className="header-actions" ref={accountRef}>
        {account ? <>
          <button className="header-account" onClick={() => setAccountOpen((open) => !open)} aria-expanded={accountOpen} aria-haspopup="menu">
            <span>{account.slice(0, 6)}…{account.slice(-4)}</span>
          </button>
          {accountOpen && <div role="menu" className="account-menu">
            <Link role="menuitem" to="/account">View account</Link>
            <button role="menuitem" onClick={disconnect}>Disconnect</button>
          </div>}
        </> : <>
          <button onClick={() => setWalletOpen(true)} className="header-cta wallet-login-trigger" aria-label="Connect Wallet">Connect Wallet</button>
          <button onClick={() => setEmailOpen(true)} disabled={!managedIdentityEnabled} className="header-cta email-login-trigger" aria-label={managedIdentityEnabled ? 'Sign in with email' : 'Email sign-in is not configured'}>{managedIdentityEnabled ? 'Sign in with email' : 'Email unavailable'}</button>
        </>}
        <button
          onClick={() => setMenuOpen((open) => !open)}
          className="menu-toggle"
          aria-controls="site-nav"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        >
          <span /><span /><span />
        </button>
      </div>
    </header>

    <main className={isHome ? 'home-main' : 'editorial-main'}><Outlet /></main>
    {walletOpen && <WalletModal onClose={() => setWalletOpen(false)} />}
    {emailOpen && <EmailLoginModal onClose={() => setEmailOpen(false)} />}
  </div>;
}
