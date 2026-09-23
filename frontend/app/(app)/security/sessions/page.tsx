'use client';

import React from 'react';
import SessionManager from '@/features/security/components/SessionManager';

export default function SecuritySessionsPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <SessionManager />
      </div>
    </div>
  );
}