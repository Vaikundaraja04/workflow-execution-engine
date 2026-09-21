'use client';

import { useCallback } from 'react';
import { customerApi } from '@/services/customerApi';
import { useResource, type ResourceState } from '@/hooks/useResource';
import type {
  AccountDTO,
  CatalogPlanDTO,
  InvoiceDTO,
  UsageHistoryDTO,
  UsageSummaryDTO,
} from '@/types/saas';

export function useAccount(): ResourceState<AccountDTO> {
  return useResource(customerApi.getAccount);
}

export function useUsage(): ResourceState<UsageSummaryDTO> {
  return useResource(customerApi.getUsage);
}

export function usePlans(): ResourceState<{ plans: CatalogPlanDTO[]; aliases: Record<string, string> }> {
  return useResource(customerApi.getPlans);
}

export function useInvoices(): ResourceState<InvoiceDTO[]> {
  return useResource(customerApi.getInvoices);
}

export function useUsageHistory(days: number): ResourceState<UsageHistoryDTO> {
  const load = useCallback(() => customerApi.getUsageHistory(days), [days]);
  return useResource(load);
}
