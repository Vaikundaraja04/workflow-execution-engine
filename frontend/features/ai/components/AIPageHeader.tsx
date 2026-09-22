'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ArrowLeft, Sparkles } from 'lucide-react';

const AI_NAV = [
  { href: '/ai/workflow-generator', label: 'Workflow Generator' },
  { href: '/ai/template-generator', label: 'Template Generator' },
  { href: '/ai/optimization', label: 'Optimization' },
  { href: '/ai/usage', label: 'Usage' },
];

interface AIPageHeaderProps {
  title: string;
  description?: string;
}

export function AIPageHeader({ title, description }: AIPageHeaderProps) {
  const pathname = usePathname();

  return (
    <header className="border-b bg-white shadow-2xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center">
          <div className="flex items-center space-x-3">
            <Link
              href="/dashboard"
              className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
              title="Back to dashboard"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-purple-600 text-white">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-gray-900">{title}</h1>
                {description && <p className="text-[11px] text-gray-500">{description}</p>}
              </div>
            </div>
          </div>


        </div>

        <nav className="-mb-px flex space-x-1 overflow-x-auto">
          {AI_NAV.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'border-b-2 px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors',
                  isActive
                    ? 'border-indigo-600 text-indigo-700'
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

export default AIPageHeader;
