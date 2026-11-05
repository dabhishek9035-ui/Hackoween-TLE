'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import SceneCanvas from './SceneCanvas';
import { useAppStore } from '@/state/store';

const links = [
  { href: '/', label: 'Home' },
  { href: '/predict', label: 'Predict' },
  { href: '/custom', label: 'Custom Lab' },
  { href: '/history', label: 'History' },
  { href: '/map', label: 'Map' },
  { href: '/watchlist', label: 'Watch List' },
];

export default function SiteShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const setScene = useAppStore((s) => s.setScene);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    setScene('underwater');
    setMenuOpen(false);
  }, [path, setScene]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);
  const pageKey = path === '/predict' || path === '/custom' ? 'predict' : path === '/history' ? 'history' : path === '/map' ? 'map' : path === '/watchlist' ? 'watchlist' : 'home';
  return <>
    <SceneCanvas />
    <header className="site-header">
      <Link href="/" className="brand" aria-label="BASINSHIFT home"><span className="brand-mark"><span /></span><span className="brand-copy"><strong>basinshift</strong><small>FLOOD INTELLIGENCE</small></span></Link>
      <nav className="desktop-nav" aria-label="Main navigation">{links.map((link) => <Link key={link.href} href={link.href} className={`nav-link ${path === link.href ? 'active' : ''}`}>{link.label}</Link>)}</nav>
      <div className="header-status"><span className="status-dot" /> CARAVAN BENCHMARK NETWORK · LIVE</div>
      <button type="button" className={`menu-toggle ${menuOpen ? 'open' : ''}`} aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><i /><i /><i /></button>
    </header>
    {menuOpen && <div className="mobile-drawer"><nav aria-label="Mobile navigation">{links.map((link) => <Link key={link.href} href={link.href} className={path === link.href ? 'active' : ''}>{link.label}<span>↗</span></Link>)}
      <p>Flood intelligence for monitored basins</p></nav></div>}
    <main className={`page-shell page-${pageKey}`}>{children}</main>
    <div className="scene-caption"><span className="caption-line" /> UNDERWATER OBSERVATORY</div>
  </>;
}
