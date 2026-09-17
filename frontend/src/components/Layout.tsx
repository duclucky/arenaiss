import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useAppContext } from '../context';
import { LoginModal } from './LoginModal';

const navItems = [
  ['/agents', 'Agents'],
  ['/evaluations', 'Evaluations'],
  ['/pairs', 'Pair matches'],
  ['/tournaments', 'Tournaments'],
  ['/marketplace', 'Marketplace'],
  ['/docs', 'Docs'],
] as const;

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
    {!isHome && <header className="site-header">
      <Link to="/" aria-label="Arena ISS" className="brand-lockup">
        <span>Arena ISS</span><img className="brand-mark" src="/brand/arena-iss-mark.png" alt="" aria-hidden="true" draggable="false" />
      </Link>

      {account ? <nav id="site-nav" aria-label="Primary" data-open={menuOpen} className="primary-nav">
        {navItems.map(([to, label]) => <NavLink key={to} to={to} className={({ isActive }) => clsx('nav-link', isActive && 'is-active')}>{label}</NavLink>)}
      </nav> : null}

      <div className="header-actions" ref={accountRef}>
        {account ? <>
          <button className="header-account" onClick={() => setAccountOpen((open) => !open)} aria-label="Account" aria-expanded={accountOpen} aria-haspopup="menu">
            <span>Account · Signed in</span>
          </button>
          {accountOpen && <div role="menu" className="account-menu">
            <Link role="menuitem" to="/account">View account</Link>
            <button role="menuitem" onClick={disconnect}>Disconnect</button>
          </div>}
        </> : <button onClick={() => openLogin()} className="header-cta login-trigger" aria-label="Login">Login</button>}
        {account && <button
          onClick={() => setMenuOpen((open) => !open)}
          className="menu-toggle"
          aria-controls="site-nav"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        >
          <span /><span /><span />
        </button>}
      </div>
    </header>}

    <main className={isHome ? 'home-main' : 'editorial-main'}><Outlet context={{ openLogin }} /></main>
    {loginOpen && <LoginModal onClose={closeLogin} onAuthenticated={completeLogin} />}
  </div>;
}
