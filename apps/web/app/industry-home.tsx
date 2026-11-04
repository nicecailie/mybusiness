'use client';
import { can } from '../../../packages/domain/src/index';
import { useQuery } from '@tanstack/react-query';
import type { Context } from '../../../packages/contracts/src/index';
import {
  workspaceLinks,
  industryById,
  type WorkspacePage,
} from '../../../packages/domain/src/industries';
import {
  workspaceMessages,
  operationsMessages,
  type Locale,
} from '../../../packages/i18n/src/index';
import { State, request } from './ui';
export function IndustryHome({
  context,
  locale,
  navigate,
}: {
  context: Context;
  locale: Locale;
  navigate: (page: WorkspacePage) => void;
}) {
  const t = workspaceMessages[locale],
    links = workspaceLinks(context.role, context.industryId, (p) => can(context.role, p)),
    money = links.some((l) => l.page === 'money'),
    date = new Intl.DateTimeFormat('en-CA', {
      timeZone: context.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  type HomeData = {
    metrics?: Record<string, string>;
    register?: { status: string } | null;
    salesToday?: number;
    revenueToday?: string;
    lowStock?: { id: string; name: string; onHand: number }[];
    pendingOrders?: number;
    pendingCounts?: number;
  };
  const data = useQuery<HomeData>({
    queryKey: [
      'data',
      context.tenantId,
      context.businessId,
      context.branchId,
      'industry-home',
      date,
      money,
    ],
    queryFn: () =>
      request<HomeData>(money ? `v1/money?from=${date}&to=${date}` : 'v1/workspace', context),
  });
  const title =
    context.role === 'cashier'
      ? t.cashierHome
      : context.role === 'inventory'
        ? t.inventoryHome
        : context.role === 'purchasing'
          ? t.purchasingHome
          : context.role === 'accountant'
            ? t.accountantHome
            : t.ownerHome;
  const expiry = useQuery({
    queryKey: ['data', context.tenantId, context.businessId, context.branchId, 'expiry-home'],
    queryFn: () =>
      request<{
        items: {
          id: string;
          name: string;
          expiresOn: string;
          quantity: number;
          status: 'expired' | 'expiring';
        }[];
      }>('v1/stock/expiry', context),
    enabled: can(context.role, 'stock.receive'),
  });
  return (
    <section className="panel core-panel">
      <h1>{title}</h1>
      <p>
        {context.businessName} · {context.branchName}
      </p>
      <div className="workspace-cards">
        {links
          .filter((l) => !l.expert && !['overview', 'settings', 'team'].includes(l.page))
          .slice(0, 6)
          .map((link) => (
            <button
              key={link.page}
              className="panel money-card"
              onClick={() => navigate(link.page)}
            >
              {link.page === 'products' && context.industryId
                ? industryById(context.industryId)?.terminology.products[locale]
                : t[link.label]}
            </button>
          ))}
      </div>
      {data.isPending || data.isError ? (
        <State loading={data.isPending} error={data.error} retry={() => void data.refetch()} />
      ) : data.data.metrics ? (
        <div className="workspace-cards">
          {(
            ['sales', 'profitAfterCosts', 'stockValue', 'customersOwe', 'suppliersOwed'] as const
          ).map((key) => (
            <button className="panel money-card" key={key} onClick={() => navigate('money')}>
              <span>{t[key]}</span>
              <strong>
                {new Intl.NumberFormat(locale).format(BigInt(data.data.metrics?.[key] ?? '0'))} BIF
              </strong>
            </button>
          ))}
        </div>
      ) : context.role === 'cashier' ? (
        <>
          <p>
            {t.yourSales}: {data.data.salesToday} · {data.data.revenueToday} BIF
          </p>
          <p>
            {t.register}:{' '}
            {data.data.register?.status === 'open' ? t.registerOpen : t.registerClosed}
          </p>
          <button className="button primary" onClick={() => navigate('sell')}>
            {t.register}
          </button>
        </>
      ) : (
        <>
          <p>
            {t.ordersPending}: {data.data.pendingOrders}
          </p>
          {context.role === 'inventory' && (
            <p>
              {t.countsPending}: {data.data.pendingCounts}
            </p>
          )}
          <h2>{t.lowStock}</h2>
          {data.data.lowStock?.map((p) => (
            <div className="settings-row" key={p.id}>
              <span>{p.name}</span>
              <b>{p.onHand}</b>
            </div>
          ))}
        </>
      )}
      {!!expiry.data?.items.length && (
        <section>
          <h2>{operationsMessages[locale].batches}</h2>
          {expiry.data.items.map((l) => (
            <button className="button secondary" key={l.id} onClick={() => navigate('stock')}>
              {operationsMessages[locale][l.status]} · {l.name} · {l.quantity} · {l.expiresOn}
            </button>
          ))}
        </section>
      )}
    </section>
  );
}
