import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { useAppContext } from '../context';
import { LoginModal } from './LoginModal';

const navItems = [
  ['/tournaments', 'Tournaments'],
  ['/agents', 'Agents'],
  ['/evaluations', 'Evaluations'],
] as const;
const tickerItems = ['Arc', 'USDC', 'CCTP', 'Escrow', 'GenLayer', 'GenVM'] as const;

export function Layout() {
  const { account, disconnectWallet } = useAppContext();
  const location = useLocation();
  const isHome = location.pathname === '/';
  const [loginOpen, setLoginOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [tickerPaused, setTickerPaused] = useState(false);
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

  useEffect(() => {
    if (!accountOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) setAccountOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [accountOpen]);

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

      {isHome ? <div
        className="header-ticker"
        role="region"
        aria-label="Arena ISS technology ticker"
        data-paused={tickerPaused}
      >
        <div className="header-ticker-viewport">
          <div className="header-ticker-track">
            {[0, 1].map((group) => <div
              key={group}
              className="header-ticker-group"
              aria-hidden={group === 1 ? 'true' : undefined}
            >
              {tickerItems.map((item) => <span className="header-ticker-item" key={`${group}-${item}`}>{item}</span>)}
            </div>)}
          </div>
        </div>
        <button
          type="button"
          className="header-ticker-toggle"
          aria-label={`${tickerPaused ? 'Play' : 'Pause'} technology ticker`}
          onClick={() => setTickerPaused((paused) => !paused)}
        >
          {tickerPaused ? 'Play' : 'Pause'}
        </button>
      </div> : account ? <nav id="site-nav" aria-label="Primary" data-open={menuOpen} className="primary-nav">
        {navItems.map(([to, label]) => <NavLink key={to} to={to} className={({ isActive }) => clsx('nav-link', isActive && 'is-active')}>{label}</NavLink>)}
      </nav> : <div />}

      <div className="header-actions" ref={accountRef}>
        {!isHome && account ? <>
          <button className="header-account" onClick={() => setAccountOpen((open) => !open)} aria-expanded={accountOpen} aria-haspopup="menu">
            <span>{account.slice(0, 6)}…{account.slice(-4)}</span>
          </button>
          {accountOpen && <div role="menu" className="account-menu">
            <Link role="menuitem" to="/account">View account</Link>
            <button role="menuitem" onClick={disconnect}>Disconnect</button>
          </div>}
        </> : !account ? <button onClick={() => setLoginOpen(true)} className="header-cta login-trigger" aria-label="Login">Login</button> : null}
        {!isHome && account && <button
          onClick={() => setMenuOpen((open) => !open)}
          className="menu-toggle"
          aria-controls="site-nav"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        >
          <span /><span /><span />
        </button>}
      </div>
    </header>

    <main className={isHome ? 'home-main' : 'editorial-main'}><Outlet context={{ openLogin: () => setLoginOpen(true) }} /></main>
    {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} />}
  </div>;
}
