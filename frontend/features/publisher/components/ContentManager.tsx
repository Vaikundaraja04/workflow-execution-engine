import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { formatMoney } from '@/features/marketing/components/PackageCatalog';
import type { PublisherContentItemDTO } from '@/services/marketplaceEcosystemApi';

function priceLabel(item: PublisherContentItemDTO): string {
  if (!item.pricingModel) return 'Not priced';
  if (item.pricingModel === 'FREE') return 'Free';
  return `${item.pricingModel} · ${formatMoney(item.price ?? 0, item.currency ?? 'usd')}`;
}

export function ContentManager({ content }: { content: PublisherContentItemDTO[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Content manager</CardTitle>
        <CardDescription>
          Every listing this workspace publishes, with its pricing, installs and recorded revenue
        </CardDescription>
      </CardHeader>
      <CardContent>
        {content.length === 0 ? (
          <EmptyState
            title="No marketplace listings yet"
            description="Publish an agent listing or a premium workflow to start selling."
          />
        ) : (          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Pricing</TableHead>
                <TableHead>Installs</TableHead>
                <TableHead>Sales</TableHead>
                <TableHead>Revenue</TableHead>
                <TableHead>Rating</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {content.map((item) => (
                <TableRow key={`${item.assetType}-${item.listingId}`}>
                  <TableCell>{item.name}</TableCell>
                  <TableCell>{item.assetType}</TableCell>
                  <TableCell>{item.status}</TableCell>
                  <TableCell>{priceLabel(item)}</TableCell>
                  <TableCell>{item.installs}</TableCell>
                  <TableCell>{item.sales}</TableCell>
                  <TableCell>{formatMoney(item.grossRevenue, item.currency ?? 'usd')}</TableCell>
                  <TableCell>
                    {item.rating.count > 0
                      ? `${item.rating.average.toFixed(1)} (${item.rating.count})`
                      : 'No ratings'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}