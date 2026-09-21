'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { ArrowLeft, CreditCard } from 'lucide-react';

const CUSTOMER_NAV = [
  { href: '/customer', label: 'Overview' },
  { href: '/customer/subscription', label: 'Subscription' },
  { href: '/customer/usage', label: 'Usage' },
  { href: '/customer/settings', label: 'Settings' },
];

interface CustomerConsoleHeaderProps {
  title: string;
  description?: string;
}

export function CustomerConsoleHeader({ title, description }: CustomerConsoleHeaderProps) {
  const pathname = usePathname();
  const { currentWorkspace } = useWorkspaceStore();

  return (
    <header className="border-b bg-white sticky top-0 z-30 shadow-2xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <div className="flex items-center space-x-3">
            <Link
              href="/dashboard"
              className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
              title="Back to dashboard"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-600 to-teal-600 text-white">
                <CreditCard className="h-4 w-4" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-gray-900">{title}</h1>
                {description && <p className="text-[11px] text-gray-500">{description}</p>}
              </div>
            </div>
          </div>

          <WorkspaceSwitcher workspace={currentWorkspace} />
        </div>

        <nav className="-mb-px flex space-x-1 overflow-x-auto">
          {CUSTOMER_NAV.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'border-b-2 px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors',
                  isActive
                    ? 'border-emerald-600 text-emerald-700'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800'
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

export default CustomerConsoleHeader;