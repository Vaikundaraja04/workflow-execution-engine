import * as React from 'react';
import Link from 'next/link';

const NAV_LINKS = [
  { href: '/features', label: 'Features' },
  { href: '/solutions', label: 'Solutions' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/demo', label: 'Demo' },
  { href: '/contact-sales', label: 'Contact sales' },
  { href: '/enterprise', label: 'Enterprise' },
  { href: '/documentation', label: 'Documentation' },
];

const FOOTER_LINKS = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/features', label: 'Features' },
  { href: '/solutions', label: 'Solutions' },
  { href: '/demo', label: 'Demo' },
  { href: '/contact-sales', label: 'Contact sales' },
  { href: '/enterprise', label: 'Enterprise' },
  { href: '/documentation', label: 'Documentation' },
  { href: '/login', label: 'Sign in' },
  { href: '/register', label: 'Create account' },
];

export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-600 to-teal-600 text-sm font-bold text-white">
              W
            </span>
            <span className="text-sm font-semibold">Workflow Execution Engine</span>
          </Link>

          <nav className="hidden items-center gap-6 md:flex" aria-label="Marketing">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-slate-600 transition-colors hover:text-slate-900"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm font-medium text-slate-600 hover:text-slate-900">
              Sign in
            </Link>
            <Link
              href="/register"
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
            >
              Start free
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-slate-200 py-8">
        <div className="mx-auto grid max-w-6xl gap-4 px-4 sm:px-6 lg:px-8">
          <p className="text-sm text-slate-500">
            Workflow Execution Engine — durable workflow automation, AI agents, governance and
            metered usage.
          </p>
          <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Footer">
            {FOOTER_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-slate-600 transition-colors hover:text-slate-900"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}

export default MarketingShell;
