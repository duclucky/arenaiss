import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useAppContext } from '../context';
import { LoginModal } from './LoginModal';

const navItems = [
  ['/agents', 'Agents'],
  ['/evaluations', 'Evaluations'],
  ['/tournaments', 'Tournaments'],
] as const;
const tickerItems = ['Arc', 'USDC', 'CCTP', 'Escrow', 'GenLayer', 'GenVM', 'Judge', 'Marketplace'] as const;

function TickerLogo({ brand }: { brand: 'arc' | 'genlayer' }) {
  return brand === 'arc'
    ? <svg className="ticker-brand-logo" data-brand-logo="arc" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.75" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path d="M7.2 13.1c1.45-3.2 4-5.05 7.65-5.55" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" />
    </svg>
    : <svg className="ticker-brand-logo" data-brand-logo="genlayer" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 2.8 7.9 4.55v9.3L12 21.2l-7.9-4.55v-9.3L12 2.8Z" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="m8.2 9.2 3.8-2.15 3.8 2.15v5.6L12 16.95 8.2 14.8Z" fill="currentColor" />
    </svg>;
}

function TickerItem({ label }: { label: typeof tickerItems[number] }) {
  const brand = label === 'Arc' ? 'arc' : label === 'GenLayer' ? 'genlayer' : null;
  return <span className="header-ticker-item">
    {brand && <TickerLogo brand={brand} />}
    <span>{label}</span>
  </span>;
}

export function Layout() {
  const { account, disconnectWallet } = useAppContext();
  const location = useLocation();
  const navigate = useNavigate();
  const isHome = location.pathname === '/';
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginDestination, setLoginDestination] = useState<string | null>(null);
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

  function openLogin(destination?: string) {
    setLoginDestination(destination ?? null);
    setLoginOpen(true);
  }

  function closeLogin() {
    setLoginDestination(null);
    setLoginOpen(false);
  }

  function completeLogin() {
    const destination = loginDestination;
    setLoginDestination(null);
    setLoginOpen(false);
    if (destination) navigate(destination);
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
      >
        <div className="header-ticker-viewport">
          <div className="header-ticker-track">
            {[0, 1].map((group) => <div
              key={group}
              className="header-ticker-group"
              aria-hidden={group === 1 ? 'true' : undefined}
            >
              {tickerItems.map((item) => <TickerItem label={item} key={`${group}-${item}`} />)}
            </div>)}
          </div>
        </div>
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
        </> : !isHome && !account ? <button onClick={() => openLogin()} className="header-cta login-trigger" aria-label="Login">Login</button> : null}
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

    <main className={isHome ? 'home-main' : 'editorial-main'}><Outlet context={{ openLogin }} /></main>
    {loginOpen && <LoginModal onClose={closeLogin} onAuthenticated={completeLogin} />}
  </div>;
}
