'use client';

import * as React from 'react';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import type { InvoiceDTO } from '@/types/saas';

const STATUS_VARIANTS: Record<InvoiceDTO['status'], 'success' | 'warning' | 'secondary' | 'destructive'> = {
  paid: 'success',
  open: 'warning',
  draft: 'secondary',
  void: 'secondary',
  uncollectible: 'destructive',
};

export function formatAmount(amount: number, currency = 'usd'): string {
  return `${(amount / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })} ${currency.toUpperCase()}`;
}

export function InvoiceHistory({ invoices }: { invoices: InvoiceDTO[] }) {
  if (invoices.length === 0) {
    return (
      <EmptyState
        title="No invoices yet"
        description="Invoices appear here once the billing provider issues them."
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Invoice</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Due</TableHead>
          <TableHead>Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoices.map((invoice) => (
          <TableRow key={invoice.id}>
            <TableCell className="font-medium">{invoice.id}</TableCell>
            <TableCell>
              <Badge variant={STATUS_VARIANTS[invoice.status]}>{invoice.status}</Badge>
            </TableCell>
            <TableCell>{new Date(invoice.created * 1000).toLocaleDateString()}</TableCell>
            <TableCell>
              {invoice.dueDate ? new Date(invoice.dueDate * 1000).toLocaleDateString() : '—'}
            </TableCell>
            <TableCell>{formatAmount(invoice.amountDue, invoice.currency)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default InvoiceHistory;