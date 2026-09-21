'use client';

import { useCallback } from 'react';
import { customerApi, type CustomerListParams } from '@/services/customerApi';
import { useResource, type ResourceState } from '@/hooks/useResource';
import type { ApiClientError } from '@/services/apiClient';
import type { CustomerDetailDTO, CustomerListDTO } from '@/types/saas';

export function useCustomerList(params: CustomerListParams = {}): ResourceState<CustomerListDTO> {
  const { status, plan, demo, search, limit, offset } = params;
  const load = useCallback(
    () => customerApi.listCustomers({ status, plan, demo, search, limit, offset }),
    [status, plan, demo, search, limit, offset],
  );
  return useResource(load);
}

export function useCustomerDetail(workspaceId: string): ResourceState<CustomerDetailDTO> {
  const load = useCallback(() => {
    if (!workspaceId) {
      const error: ApiClientError = {
        code: 'INVALID_REQUEST',
        message: 'A workspace id is required to load a customer.',
        status: 400,
      };
      return Promise.reject(error);
    }
    return customerApi.getCustomer(workspaceId);
  }, [workspaceId]);
  return useResource(load);
}
