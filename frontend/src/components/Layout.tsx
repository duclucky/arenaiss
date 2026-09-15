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

function TickerLogo({ brand }: { brand: 'arc' | 'usdc' | 'genlayer' }) {
  if (brand === 'arc') return <svg className="ticker-brand-logo" data-brand-logo="arc" viewBox="0 0 47.72 50" aria-hidden="true">
    <path fill="currentColor" d="M23.8574 0C31.0115 0 37.371 6.19775 41.7656 17.4521C44.0513 23.3056 45.7332 30.2603 46.7295 37.8262C46.8186 38.5019 46.8939 39.1888 46.9717 39.874C46.9969 39.9162 47.0119 39.9553 47.0068 39.9873C47.0068 39.9873 47.5924 43.6447 47.7168 50H47.6514C46.7829 49.2873 36.54 41.2389 19.5615 43.5693C19.8177 40.6962 20.1699 37.9004 20.625 35.2207C20.6482 35.0838 20.6755 34.9514 20.6992 34.8154C27.3585 34.6146 33.1876 35.3879 37.6572 36.4014C37.6406 36.2954 37.6263 36.1865 37.6094 36.0811C36.6906 30.3599 35.3355 25.1217 33.5879 20.6455C30.7304 13.3264 27.001 8.77832 23.8574 8.77832C20.7141 8.77863 16.9853 13.3266 14.1279 20.6455C13.4363 22.4157 12.8068 24.3036 12.2422 26.2949C11.4483 29.0854 10.7807 32.0773 10.248 35.2207C9.45968 39.8629 8.96755 44.8418 8.78613 50H0C.405408 37.7593 2.48104 26.3352 5.9502 17.4521C10.3437 6.19798 16.7036.000184295 23.8574 0Z" />
  </svg>;
  if (brand === 'usdc') return <svg className="ticker-brand-logo ticker-brand-logo--usdc" data-brand-logo="usdc" viewBox="0 0 96 96" aria-hidden="true">
    <path d="M48 95C73.9574 95 95 73.9574 95 48C95 22.0426 73.9574 1 48 1C22.0426 1 1 22.0426 1 48C1 73.9574 22.0426 95 48 95Z" fill="#0B53BF" />
    <path d="M56.4609 13.7778V19.8291C68.5341 23.4716 77.3759 34.6928 77.3759 47.9997C77.3759 61.3066 68.5341 72.5278 56.4609 76.1703V82.2216C71.8534 78.4616 83.2509 64.5672 83.2509 47.9997C83.2509 31.4322 71.8534 17.5378 56.4609 13.7778ZM18.625 47.9997C18.625 34.6928 27.4669 23.4716 39.54 19.8291V13.7778C24.1475 17.5378 12.75 31.4322 12.75 47.9997C12.75 64.5672 24.1475 78.4616 39.54 82.2216V76.1703C27.4669 72.5572 18.625 61.3066 18.625 47.9997ZM60.6319 54.5506C60.6319 42.5362 41.8025 47.4713 41.8025 40.8325C41.8025 38.4531 43.7119 36.9256 47.3544 36.9256C51.7019 36.9256 53.2 39.0406 53.67 41.89H59.6625C59.1279 36.5426 56.0588 33.1662 50.9382 32.1604V27.4375H45.0632V31.9918C39.4534 32.7062 35.9275 35.973 35.9275 40.8325C35.9275 52.9056 54.7863 48.3819 54.7863 54.9031C54.7863 57.3706 52.4069 59.0156 48.3825 59.0156C43.1244 59.0156 41.3913 56.695 40.745 53.4931H34.8994C35.2781 59.3502 38.8897 63.0159 45.0632 63.9307V68.5625H50.9382V63.9923C56.9633 63.2139 60.6319 59.7089 60.6319 54.5506Z" fill="white" />
  </svg>;
  return <svg className="ticker-brand-logo" data-brand-logo="genlayer" viewBox="0 0 97.76 91.93" aria-hidden="true">
    <path fill="currentColor" d="M44.26 32.35L27.72 67.12L43.29 74.9L0 91.93L44.26 0L44.26 32.35ZM53.5 32.35L70.04 67.12L54.47 74.9L97.76 91.93L53.5 0L53.5 32.35ZM48.64 43.78L58.33 62.94L48.64 67.69L39.47 62.92L48.64 43.78Z" />
  </svg>;
}

function TickerItem({ label }: { label: typeof tickerItems[number] }) {
  const brand = label === 'Arc' ? 'arc' : label === 'USDC' ? 'usdc' : label === 'GenLayer' ? 'genlayer' : null;
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
      {!isHome && <Link to="/" aria-label="Arena ISS" className="brand-lockup">
        <span>Arena ISS</span><span className="brand-star" aria-hidden="true">✳︎</span>
      </Link>}

      {isHome ? <div
        className="header-ticker"
        role="region"
        aria-label="Arena ISS technology ticker"
      >
        <div className="header-ticker-viewport">
          <div className="header-ticker-track" data-motion="continuous">
            {[0, 1, 2].map((group) => <div
              key={group}
              className="header-ticker-group"
              aria-hidden={group > 0 ? 'true' : undefined}
            >
              {tickerItems.map((item) => <TickerItem label={item} key={`${group}-${item}`} />)}
            </div>)}
          </div>
        </div>
      </div> : account ? <nav id="site-nav" aria-label="Primary" data-open={menuOpen} className="primary-nav">
        {navItems.map(([to, label]) => <NavLink key={to} to={to} className={({ isActive }) => clsx('nav-link', isActive && 'is-active')}>{label}</NavLink>)}
      </nav> : <div />}

      {!isHome && <div className="header-actions" ref={accountRef}>
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
      </div>}
    </header>

    <main className={isHome ? 'home-main' : 'editorial-main'}><Outlet context={{ openLogin }} /></main>
    {loginOpen && <LoginModal onClose={closeLogin} onAuthenticated={completeLogin} />}
  </div>;
}
