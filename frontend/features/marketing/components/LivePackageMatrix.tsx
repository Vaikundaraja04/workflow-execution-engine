'use client';

import * as React from 'react';
import { PackageMatrix } from './PackageCatalog';
import { useResource } from '@/hooks/useResource';
import { marketingApi } from '@/services/marketingApi';
import { Loading } from '@/components/ui/Loading';
import { ErrorState } from '@/components/ui/ErrorState';

const loadPlans = () => marketingApi.getPlans();

export function LivePackageMatrix() {
  const catalog = useResource(loadPlans);

  if (catalog.isLoading) {
    return <Loading message="Loading the package comparison..." />;
  }

  if (catalog.error || !catalog.data) {
    return (
      <ErrorState
        title="Could not load the package comparison"
        message={catalog.error?.message}
        onRetry={catalog.reload}
      />
    );
  }

  return <PackageMatrix plans={catalog.data.plans} />;
}

export default LivePackageMatrix;
