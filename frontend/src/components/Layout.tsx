import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { BookOpen, Bot, ClipboardCheck, Store, Swords, Trophy, UserRound } from 'lucide-react';
import { useAppContext } from '../context';
import { LoginModal } from './LoginModal';

const navItems = [
  { to: '/agents', label: 'Agents', icon: Bot, paths: ['/agents'], children: [
    { to: '/agents', label: 'My Agents' },
    { to: '/agents/new', label: 'Create Agent' },
  ] },
  { to: '/evaluations', label: 'Evaluations', icon: ClipboardCheck, paths: ['/evaluations', '/evaluation-runs'] },
  { to: '/pairs/open', label: 'Pair matches', icon: Swords, paths: ['/pairs'], children: [
    { to: '/pairs/open', label: 'Open rooms' },
    { to: '/pairs/mine', label: 'My rooms' },
    { to: '/pairs/completed', label: 'Completed' },
  ] },
  { to: '/tournaments', label: 'Tournaments', icon: Trophy, paths: ['/tournaments', '/matches'] },
  { to: '/marketplace', label: 'Marketplace', icon: Store, paths: ['/marketplace'], children: [
    { to: '/marketplace', label: 'Agents for sale' },
    { to: '/marketplace?view=sell', label: 'Sell my Agent' },
  ] },
  { to: '/docs', label: 'Docs', icon: BookOpen, paths: ['/docs'] },
  { to: '/account', label: 'Account', icon: UserRound, paths: ['/account'], children: [
    { to: '/account', label: 'Overview' },
    { to: '/account?tab=claim', label: 'Claim' },
  ] },
] as const;

export function Layout() {
  const { account } = useAppContext();
  const location = useLocation();
  const navigate = useNavigate();
  const isHome = location.pathname === '/';
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginDestination, setLoginDestination] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    const resize = () => { if (window.innerWidth >= 1024) setMenuOpen(false); };
    document.addEventListener('keydown', close);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('keydown', close);
      window.removeEventListener('resize', resize);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !actionsRef.current?.contains(target)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [menuOpen]);

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

  function childIsActive(to: string) {
    const [pathname, search = ''] = to.split('?');
    return location.pathname === pathname && location.search === (search ? `?${search}` : '');
  }

  return <div className={clsx('app-shell', isHome && 'app-shell--hero')} data-surface={isHome ? 'immersive' : 'editorial'}>
    <div className="site-grain" aria-hidden="true" />
    {!isHome && <header className="site-header site-sidebar">
      <Link to="/" aria-label="Arena ISS" className="brand-lockup">
        <span className="brand-copy">
          <span className="brand-name">Arena ISS</span>
          <span className="brand-tagline">Arena Intelligence, Safety &amp; Standards.</span>
        </span>
        <img className="brand-mark" src="/brand/arena-iss-mark.png" alt="" aria-hidden="true" draggable="false" />
      </Link>

      {account ? <div className="sidebar-nav-block">
        <p className="sidebar-section-label">Workspace</p>
        <nav ref={menuRef} id="site-nav" aria-label="Primary" data-open={menuOpen} className="primary-nav primary-nav--vertical">
          {navItems.map(({ to, label, icon: Icon, paths, ...item }) => {
            const isActive = paths.some((path) => location.pathname === path || location.pathname.startsWith(`${path}/`));
            const hasChildren = 'children' in item && Boolean(item.children);
            return <div className="sidebar-nav-group" key={to}>
              <Link to={to} className={clsx('nav-link', isActive && 'is-active')} aria-current={!hasChildren && isActive ? 'page' : undefined} aria-expanded={hasChildren ? isActive : undefined} onClick={() => { if (!hasChildren) setMenuOpen(false); }}>
                <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                <span>{label}</span>
              </Link>
              {hasChildren && item.children && isActive && <nav className="sidebar-child-nav" aria-label={`${label} pages`}>
                {item.children.map((child) => {
                  const childActive = childIsActive(child.to);
                  return <Link key={child.to} to={child.to} className={clsx('sidebar-child-link', childActive && 'is-active')} aria-current={childActive ? 'page' : undefined} onClick={() => setMenuOpen(false)}>{child.label}</Link>;
                })}
              </nav>}
            </div>;
          })}
        </nav>
      </div> : null}

      <div className="header-actions" ref={actionsRef}>
        {!account && <button onClick={() => openLogin()} className="header-cta login-trigger" aria-label="Login">Login</button>}
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
