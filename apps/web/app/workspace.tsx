'use client';
import { CorePanel, FinancialPanel, FocusedWorkspace, CustomerAccountPanel } from './core-panels';
import { newOperationId } from './idempotency';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  BookOpen,
  Box,
  ChartNoAxesCombined,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Landmark,
  LogOut,
  MoreHorizontal,
  Package,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Store,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type {
  ApiError,
  Permission,
  Context,
  Customer,
  Dashboard,
  JournalView,
  Product,
  Receipt,
} from '../../../packages/contracts/src/index';
import { can } from '../../../packages/domain/src/index';
import {
  hasEffectiveModule,
  industryById,
  type IndustryModule,
} from '../../../packages/domain/src/industries';
import { money, type Locale } from '../../../packages/i18n/src/index';

import {
  BusinessAdmin,
  TeamPanel,
  ReconciliationPanel,
  AccommodationPanel,
  RestaurantPanel,
} from './review-panels';
import { MutationForm } from './forms';
import { SecuritySettings } from './security-settings';
import { PointOfSale, ReceiptModal } from './pos';
import { Empty, IconButton, request, State, useT, type Page } from './ui';
function dateToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Bujumbura',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
export function WorkspacePage({
  page,
  context,
  navigate,
  locale,
  onLogout,
}: {
  page: Page;
  context: Context;
  navigate: (p: Page) => void;
  locale: Locale;
  onLogout: () => void;
}) {
  const t = useT(),
    productTerm = context.industryId
      ? (industryById(context.industryId)?.terminology.products[locale] ?? t('products'))
      : t('products'),
    q = useQueryClient(),
    [form, setForm] = useState<'product' | 'customer' | 'stock' | 'open' | 'close' | null>(null),
    [editingProduct, setEditingProduct] = useState<Product | undefined>(),
    [archived, setArchived] = useState(false),
    [receiptId, setReceiptId] = useState(''),
    [customerId, setCustomerId] = useState(''),
    [search, setSearch] = useState(''),
    [currentPage, setCurrentPage] = useState(1),
    [period, setPeriod] = useState('week'),
    [to, setTo] = useState(dateToday),
    [from, setFrom] = useState(() => {
      const d = new Date(`${dateToday()}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 6);
      return d.toISOString().slice(0, 10);
    }),
    [toast, setToast] = useState('');
  const allowed = (permission: Parameters<typeof can>[1], module: IndustryModule) =>
    can(context.role, permission) &&
    (!context.industryId || hasEffectiveModule(context.industryId, module));
  const key = ['data', context.tenantId, context.businessId, context.branchId];
  const productData = useQuery({
    queryKey: [...key, 'products', search, currentPage, archived],
    queryFn: () =>
      request<{ items: Product[]; total: number }>(
        `v1/products?search=${encodeURIComponent(search)}&page=${currentPage}&limit=30&archived=${archived}`,
        context,
      ),
    enabled:
      (['products', 'sell'].includes(page) && allowed('catalog.read', 'catalog')) ||
      (form === 'stock' && allowed('stock.receive', 'inventory')),
  });
  const customerData = useQuery({
    queryKey: [...key, 'customers', search, currentPage],
    queryFn: () =>
      request<{ items: Customer[]; total: number }>(
        `v1/customers?search=${encodeURIComponent(search)}&page=${currentPage}`,
        context,
      ),
    enabled: page === 'customers' && allowed('customer.read', 'crm'),
  });
  const salesData = useQuery({
    queryKey: [...key, 'sales', search, currentPage],
    queryFn: () =>
      request<{ items: Receipt[]; total: number }>(
        `v1/sales?search=${encodeURIComponent(search)}&page=${currentPage}`,
        context,
      ),
    enabled: page === 'sales' && allowed('sale.read', 'sales'),
  });
  const report = useQuery({
    queryKey: [...key, 'dashboard', from, to],
    queryFn: () => request<Dashboard>(`v1/dashboard?from=${from}&to=${to}`, context),
    enabled: ['overview', 'reports'].includes(page) && allowed('report.read', 'reporting'),
  });
  const journalData = useQuery({
    queryKey: [...key, 'journals', currentPage],
    queryFn: () =>
      request<{ items: JournalView[]; total: number }>(`v1/journals?page=${currentPage}`, context),
    enabled: page === 'accounting' && allowed('journal.read', 'accounting'),
  });
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(''), 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  const changePeriod = (value: string) => {
    setPeriod(value);
    setTo(dateToday());
    const d = new Date(`${dateToday()}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (value === 'today' ? 0 : value === 'week' ? 6 : 29));
    setFrom(d.toISOString().slice(0, 10));
  };
  const header = (title: string, subtitle?: string, action?: ReactNode) => (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
  const filter = (
    <div className="period-controls">
      <div className="segmented">
        {(['today', 'week', 'month'] as const).map((value) => (
          <button
            className={period === value ? 'selected' : ''}
            key={value}
            onClick={() => changePeriod(value)}
          >
            {t(value)}
          </button>
        ))}
      </div>
      <div className="date-range">
        <label>
          <span className="sr-only">{t('from')}</span>
          <input
            aria-label={t('from')}
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPeriod('custom');
            }}
          />
        </label>
        <span>—</span>
        <label>
          <span className="sr-only">{t('to')}</span>
          <input
            aria-label={t('to')}
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPeriod('custom');
            }}
          />
        </label>
      </div>
    </div>
  );
  const success = () => {
    setForm(null);
    setToast(t('saved'));
    void q.invalidateQueries({ queryKey: key });
  };
  const paginate = (total: number) => (
    <div className="pagination">
      <span>
        {t('page')} {currentPage} · {total}{' '}
        {page === 'products' ? t('products') : page === 'customers' ? t('customers') : t('sales')}
      </span>
      <div>
        <button
          className="button secondary"
          disabled={currentPage <= 1}
          onClick={() => setCurrentPage(currentPage - 1)}
        >
          <ChevronLeft size={16} />
          {t('previous')}
        </button>
        <button
          className="button secondary"
          disabled={currentPage * 30 >= total}
          onClick={() => setCurrentPage(currentPage + 1)}
        >
          {t('next')}
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
  const searchBox = (
    <div className="search-field">
      <Search size={18} />
      <input
        aria-label={t('searchRecords')}
        placeholder={page === 'products' ? t('search') : t('searchRecords')}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setCurrentPage(1);
        }}
      />
      {search && (
        <button onClick={() => setSearch('')} aria-label="Clear search">
          <X size={16} />
        </button>
      )}
    </div>
  );
  const pageAccess: Partial<Record<Page, [Permission, IndustryModule]>> = {
    products: ['catalog.read', 'catalog'],
    customers: ['customer.read', 'crm'],
    sales: ['sale.read', 'sales'],
    sell: ['sale.create', 'sales'],
    accounting: ['journal.read', 'accounting'],
    reports: ['report.read', 'reporting'],
    team: ['business.manage', 'accounting'],
  };
  const access = pageAccess[page];
  let content: ReactNode;
  if (access && !allowed(access[0], access[1])) {
    content = (
      <section className="panel core-panel">
        <Empty
          icon={ShieldCheck}
          title="Access denied"
          hint="Your role or enabled business modules do not allow this page."
        />
      </section>
    );
  } else if (page === 'overview' && !allowed('report.read', 'reporting')) {
    content = <FocusedWorkspace context={context} navigate={navigate} />;
  } else if (page === 'overview' || page === 'reports') {
    const d = report.data;
    content = (
      <>
        {header(
          page === 'overview' ? t('greeting') : t('reports'),
          page === 'overview' ? t('subtitle') : `${context.businessName} · ${context.branchName}`,
          allowed('sale.create', 'sales') ? (
            <button className="button primary" onClick={() => navigate('sell')}>
              <Plus size={17} />
              {t('newSale')}
            </button>
          ) : undefined,
        )}
        {!allowed('report.read', 'reporting') ? (
          <Empty icon={ShieldCheck} title={t('availableSoon')} hint={t('registerRequired')} />
        ) : (
          <>
            {filter}
            {report.isPending || report.isError ? (
              <State
                loading={report.isPending}
                error={report.error}
                retry={() => void report.refetch()}
              />
            ) : (
              d && (
                <>
                  <div className="metrics">
                    {(
                      [
                        ['netSales', d.netSales, ShoppingBag, 'netSalesHint'],
                        ['grossProfit', d.grossProfit, ChartNoAxesCombined, 'profitHint'],
                        ['cashCollected', d.cashCollected, Wallet, 'cashHint'],
                        ['refunds', d.refunds, RotateCcw, 'refundHint'],
                      ] as const
                    ).map(([label, value, Icon, hint], i) => (
                      <div className={`metric metric-${i}`} key={label}>
                        <div className="metric-label">
                          {t(label)}
                          <Icon size={17} />
                        </div>
                        <strong>{money(value, locale)}</strong>
                        <span>{t(hint)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="dashboard-grid">
                    <section className="panel chart-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>{t('salesOverview')}</h2>
                          <p>{t('dailySales')}</p>
                        </div>
                        <span className="chart-legend">
                          <i />
                          {t('netSales')}
                        </span>
                      </div>
                      <SalesChart data={d.trend} locale={locale} />
                      <div className="chart-summary">
                        <span>
                          <b>{d.transactionCount}</b> {t('saleCount')}
                        </span>
                        <span>
                          {t('freshness')}{' '}
                          {new Intl.DateTimeFormat(locale, {
                            timeZone: context.timezone,
                            hour: '2-digit',
                            minute: '2-digit',
                          }).format(new Date(d.freshness))}
                        </span>
                      </div>
                    </section>
                    <section className="panel quick-panel">
                      <div className="panel-heading">
                        <h2>{t('quickActions')}</h2>
                        <span className="muted">
                          <MoreHorizontal size={20} />
                        </span>
                      </div>
                      <div className="quick-grid">
                        {(
                          [
                            [
                              'newSale',
                              ShoppingBag,
                              () => navigate('sell'),
                              allowed('sale.create', 'sales'),
                            ],
                            [
                              'openingStock',
                              Box,
                              () => setForm('stock'),
                              allowed('stock.receive', 'inventory'),
                            ],
                            [
                              'products',
                              Package,
                              () => navigate('products'),
                              allowed('catalog.read', 'catalog'),
                            ],
                            [
                              'customers',
                              Users,
                              () => navigate('customers'),
                              allowed('customer.read', 'crm'),
                            ],
                            [
                              'openRegister',
                              Wallet,
                              () => setForm('open'),
                              allowed('cash.manage', 'sales'),
                            ],
                          ] as const
                        )
                          .filter(([, , , allowed]) => allowed)
                          .map(([label, Icon, action]) => (
                            <button key={label} onClick={action}>
                              <span>
                                <Icon size={23} strokeWidth={1.6} />
                              </span>
                              {t(label)}
                            </button>
                          ))}
                      </div>
                      <div className="quick-foot">
                        <ShieldCheck size={16} />
                        {t('provisional')}
                      </div>
                    </section>
                  </div>
                  <div className="dashboard-grid lower-grid">
                    <section className="panel transactions">
                      <div className="panel-heading">
                        <h2>{t('recentTransactions')}</h2>
                        <button className="text-button" onClick={() => navigate('sales')}>
                          {t('viewAll')}
                          <ArrowUpRight size={15} />
                        </button>
                      </div>
                      <SalesTable items={d.recent} locale={locale} onSelect={setReceiptId} />
                    </section>
                    <section className="panel stock-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>{t('lowStock')}</h2>
                          <p>{t('lowStockHint')}</p>
                        </div>
                        <span className="count-badge">{d.lowStock.length}</span>
                      </div>
                      {d.lowStock.length ? (
                        <div className="stock-list">
                          {d.lowStock.map((p, i) => (
                            <button
                              className="stock-row"
                              key={p.id}
                              onClick={() => navigate('products')}
                            >
                              <span className={`product-mini shade-${i % 4}`}>
                                <Package size={20} />
                              </span>
                              <span>
                                <b>{p.name}</b>
                                <small>{p.sku}</small>
                              </span>
                              <span className={`stock-count ${p.onHand === 0 ? 'zero' : ''}`}>
                                {p.onHand}
                                <small>{t('units')}</small>
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <Empty icon={CheckCircle2} title={t('noAlerts')} hint={t('noAlertsHint')} />
                      )}
                    </section>
                  </div>
                  {page === 'reports' && (
                    <section className="panel report-detail">
                      <div className="panel-heading">
                        <h2>{t('topProducts')}</h2>
                        <button
                          className="button secondary"
                          onClick={async () => {
                            const response = await fetch(
                              `/api/v1/reports/sales.csv?from=${from}&to=${to}`,
                              {
                                headers: {
                                  'x-tenant-id': context.tenantId,
                                  'x-business-id': context.businessId,
                                  'x-branch-id': context.branchId,
                                },
                              },
                            );
                            if (!response.ok) {
                              const e = (await response.json()) as ApiError;
                              setToast(e.message);
                              return;
                            }
                            const url = URL.createObjectURL(await response.blob()),
                              a = document.createElement('a');
                            a.href = url;
                            a.download = 'mybusiness-sales.csv';
                            a.click();
                            setTimeout(() => URL.revokeObjectURL(url), 1000);
                          }}
                        >
                          <Download size={16} />
                          {t('export')}
                        </button>
                      </div>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>{t('name')}</th>
                              <th className="numeric">{t('quantity')}</th>
                              <th className="numeric">{t('netSales')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {d.topProducts.map((p) => (
                              <tr key={p.name}>
                                <td>{p.name}</td>
                                <td className="numeric">{p.quantity}</td>
                                <td className="numeric">{money(p.sales, locale)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}
                </>
              )
            )}
          </>
        )}
      </>
    );
  } else if (page === 'products') {
    content = (
      <>
        {header(
          productTerm,
          t('inventory'),
          <div className="heading-buttons">
            {allowed('stock.receive', 'inventory') && (
              <button className="button secondary" onClick={() => setForm('stock')}>
                <Box size={17} />
                {t('openingStock')}
              </button>
            )}
            {allowed('catalog.write', 'catalog') && (
              <button
                className="button primary"
                onClick={() => {
                  setEditingProduct(undefined);
                  setForm('product');
                }}
              >
                <Plus size={17} />
                {t('addProduct')}
              </button>
            )}
          </div>,
        )}
        <section className="panel">
          <div className="list-toolbar">
            {searchBox}
            <label>
              <input
                type="checkbox"
                checked={archived}
                onChange={(e) => {
                  setArchived(e.target.checked);
                  setCurrentPage(1);
                }}
              />
              {locale === 'fr' ? 'Produits archivés' : 'Archived products'}
            </label>
            <span className="muted small">
              {productData.data?.total ?? '—'} {productTerm}
            </span>
          </div>
          {productData.isPending || productData.isError ? (
            <State
              loading={productData.isPending}
              error={productData.error}
              retry={() => void productData.refetch()}
            />
          ) : productData.data.items.length ? (
            <>
              <div className="table-wrap">
                <table className="product-table">
                  <thead>
                    <tr>
                      <th>{t('name')}</th>
                      <th>{t('sku')}</th>
                      <th>{t('category')}</th>
                      <th className="numeric">{t('price')}</th>
                      <th className="numeric">{t('stock')}</th>
                      <th>
                        <span className="sr-only">{t('actions')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {productData.data.items.map((p, i) => (
                      <tr key={p.id}>
                        <td>
                          <div className="product-name">
                            <span className={`product-mini shade-${i % 4}`}>
                              <Package size={20} />
                            </span>
                            <b>{p.name}</b>
                          </div>
                        </td>
                        <td className="muted mono">{p.sku}</td>
                        <td>
                          <span className="category-chip">{p.category}</span>
                        </td>
                        <td className="numeric">{money(p.price, locale)}</td>
                        <td className="numeric">
                          <span
                            className={
                              p.onHand <= p.lowStock && p.type === 'goods' ? 'stock-warning' : ''
                            }
                          >
                            {p.type === 'service' ? '—' : p.onHand}
                          </span>
                        </td>
                        <td>
                          {allowed('catalog.write', 'catalog') && (
                            <button
                              className="text-button"
                              onClick={() => {
                                setEditingProduct(p);
                                setForm('product');
                              }}
                            >
                              {locale === 'fr' ? 'Modifier' : 'Edit'}
                            </button>
                          )}
                          {allowed('catalog.write', 'catalog') && (
                            <button
                              className="text-button danger"
                              onClick={async () => {
                                if (!p.archived && !confirm(t('confirmArchive'))) return;
                                try {
                                  await request(
                                    `v1/products/${p.id}${p.archived ? '/restore' : ''}`,
                                    context,
                                    p.archived ? 'POST' : 'DELETE',
                                    undefined,
                                    newOperationId(),
                                  );
                                  success();
                                } catch (e) {
                                  setToast(e instanceof Error ? e.message : 'Error');
                                }
                              }}
                            >
                              {p.archived
                                ? locale === 'fr'
                                  ? 'Restaurer'
                                  : 'Restore'
                                : t('archive')}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {paginate(productData.data.total)}
            </>
          ) : (
            <Empty title={t('noData')} hint={t('noDataHint')} />
          )}
        </section>
      </>
    );
  } else if (['purchases', 'invoices', 'expenses'].includes(page)) {
    content = (
      <CorePanel
        key={page + context.branchId}
        context={context}
        section={page as 'purchases' | 'invoices' | 'expenses'}
      />
    );
  } else if (page === 'customers') {
    content = (
      <>
        {header(
          t('customers'),
          undefined,
          allowed('customer.write', 'crm') && (
            <button className="button primary" onClick={() => setForm('customer')}>
              <Plus size={17} />
              {t('addCustomer')}
            </button>
          ),
        )}
        <section className="panel">
          <div className="list-toolbar">{searchBox}</div>
          {customerData.isPending || customerData.isError ? (
            <State
              loading={customerData.isPending}
              error={customerData.error}
              retry={() => void customerData.refetch()}
            />
          ) : customerData.data.items.length ? (
            <>
              <div className="customer-list">
                {customerData.data.items.map((c) => (
                  <div className="customer-row" key={c.id}>
                    <span className="avatar">
                      {c.name
                        .split(' ')
                        .map((p) => p[0])
                        .slice(0, 2)
                        .join('')}
                    </span>
                    <div>
                      <b>{c.name}</b>
                      <small>{c.phone || '—'}</small>
                    </div>
                    <span>{c.email}</span>
                    {allowed('invoice.read', 'invoicing') && (
                      <button className="text-button" onClick={() => setCustomerId(c.id)}>
                        Account & invoices
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {paginate(customerData.data.total)}
            </>
          ) : (
            <Empty icon={Users} title={t('noData')} hint={t('noDataHint')} />
          )}
        </section>
      </>
    );
  } else if (page === 'sales') {
    content = (
      <>
        {header(
          t('sales'),
          undefined,
          <div className="heading-buttons">
            {allowed('cash.manage', 'sales') && (
              <button className="button secondary" onClick={() => setForm('close')}>
                <Landmark size={17} />
                {t('closeRegister')}
              </button>
            )}
            {allowed('sale.create', 'sales') && (
              <button className="button primary" onClick={() => navigate('sell')}>
                <Plus size={17} />
                {t('newSale')}
              </button>
            )}
          </div>,
        )}
        <section className="panel">
          <div className="list-toolbar">{searchBox}</div>
          {salesData.isPending || salesData.isError ? (
            <State
              loading={salesData.isPending}
              error={salesData.error}
              retry={() => void salesData.refetch()}
            />
          ) : (
            <>
              <SalesTable items={salesData.data.items} locale={locale} onSelect={setReceiptId} />
              {paginate(salesData.data.total)}
            </>
          )}
        </section>
      </>
    );
  } else if (page === 'sell') {
    content = (
      <>
        {header(t('newSale'), `${context.branchName} · ${t('cash')}`)}
        <PointOfSale
          context={context}
          locale={locale}
          onReceipt={setReceiptId}
          openCash={() => setForm('open')}
        />
      </>
    );
  } else if (page === 'accounting') {
    content = (
      <>
        {header(t('journal'), t('journalHint'))}
        <div className="notice">
          <ShieldCheck size={17} />
          {t('provisional')}
        </div>
        {journalData.isPending || journalData.isError ? (
          <State
            loading={journalData.isPending}
            error={journalData.error}
            retry={() => void journalData.refetch()}
          />
        ) : journalData.data.items.length ? (
          <>
            {journalData.data.items.map((j) => (
              <section className="panel journal-panel" key={j.id}>
                <div className="panel-heading">
                  <h2>
                    {j.sourceType} <span className="muted small">· {j.sourceId.slice(0, 8)}</span>
                  </h2>
                  <span className="muted small">
                    {new Date(j.createdAt).toLocaleDateString(locale, {
                      timeZone: context.timezone,
                    })}
                  </span>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>{t('account')}</th>
                      <th className="numeric">{t('debit')}</th>
                      <th className="numeric">{t('credit')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {j.lines.map((l, i) => (
                      <tr key={i}>
                        <td>{l.account}</td>
                        <td className="numeric">{money(l.debit, locale)}</td>
                        <td className="numeric">{money(l.credit, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
            {paginate(journalData.data.total)}
          </>
        ) : (
          <Empty icon={BookOpen} title={t('noData')} />
        )}
      </>
    );
  } else if (page === 'team') {
    content = <TeamPanel context={context} locale={locale} />;
  } else if (page === 'settings') {
    content = (
      <>
        {header(t('settings'))}
        <section className="panel settings-panel">
          <div className="panel-heading">
            <h2>{t('businessDetails')}</h2>
            <Store size={22} />
          </div>
          {[
            [t('business'), context.businessName],
            [t('branch'), context.branchName],
            [t('currency'), context.currency],
            [t('timezone'), context.timezone],
            ['Role', context.role],
          ].map(([label, value]) => (
            <div className="settings-row" key={label}>
              <span>{label}</span>
              <b>{value}</b>
            </div>
          ))}
          <div className="panel-heading">
            <button className="button secondary" onClick={onLogout}>
              <LogOut size={17} />
              {t('signOut')}
            </button>
            <span className="muted small">{context.demo ? t('demo') : ''}</span>
          </div>
        </section>
        <SecuritySettings />
      </>
    );
  } else
    content = (
      <>
        {header(t(page))}
        <section className="panel availability">
          <Empty
            icon={page === 'purchases' ? ShoppingCart : page === 'invoices' ? FileText : Wallet}
            title={t('availableSoon')}
            hint={t('moduleHint')}
          />
          <button className="button secondary" onClick={() => navigate('overview')}>
            <ChevronLeft size={17} />
            {t('home')}
          </button>
        </section>
      </>
    );
  return (
    <>
      {page === 'overview' &&
        context.industryId &&
        ['restaurant', 'bar_pub', 'fast_food'].includes(context.industryId) && (
          <RestaurantPanel context={context} locale={locale} onReceipt={setReceiptId} />
        )}
      {page === 'overview' &&
        context.industryId &&
        hasEffectiveModule(context.industryId, 'accommodation') && (
          <AccommodationPanel
            context={context}
            locale={locale}
            onGuest={() => setForm('customer')}
          />
        )}
      {['overview', 'reports'].includes(page) && !!report.data?.unverifiedPayments && (
        <p className="notice">
          {report.data.unverifiedPayments}{' '}
          {locale === 'fr'
            ? 'paiements avec justificatif non vérifié'
            : 'payments with unverified evidence'}
        </p>
      )}
      {['overview', 'reports'].includes(page) && report.data?.valuationPending && (
        <p className="notice warning">
          {locale === 'fr'
            ? 'Bénéfice provisoire : coûts des unités manquantes en attente de valorisation.'
            : 'Profit is provisional: shortage costs await valuation.'}
        </p>
      )}
      {content}
      {page === 'customers' && customerId && (
        <CustomerAccountPanel
          key={customerId}
          context={context}
          id={customerId}
          onClose={() => setCustomerId('')}
        />
      )}
      {['overview', 'reports'].includes(page) &&
        can(context.role, 'finance.read') &&
        (!context.industryId || hasEffectiveModule(context.industryId, 'accounting')) && (
          <FinancialPanel context={context} from={from} to={to} />
        )}
      {page === 'products' &&
        (can(context.role, 'stock.transfer') || can(context.role, 'stock.count')) && (
          <CorePanel key={context.branchId} context={context} section="inventory" />
        )}
      {page === 'products' && can(context.role, 'business.manage') && (
        <ReconciliationPanel context={context} locale={locale} onReceipt={setReceiptId} />
      )}
      {page === 'settings' && can(context.role, 'business.manage') && (
        <>
          <BusinessAdmin context={context} locale={locale} />
          <TeamPanel context={context} locale={locale} />
        </>
      )}
      {form && (
        <MutationForm
          key={form}
          kind={form}
          product={form === 'product' ? editingProduct : undefined}
          context={context}
          products={productData.data?.items ?? []}
          onClose={() => setForm(null)}
          onSaved={success}
        />
      )}{' '}
      {receiptId && (
        <ReceiptModal
          id={receiptId}
          context={context}
          locale={locale}
          onClose={() => setReceiptId('')}
        />
      )}{' '}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
          <IconButton icon={X} label={t('cancel')} onClick={() => setToast('')} />
        </div>
      )}
    </>
  );
}
function SalesTable({
  items,
  locale,
  onSelect,
}: {
  items: Receipt[];
  locale: Locale;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  if (!items.length) return <Empty icon={ReceiptText} title={t('noData')} hint={t('noDataHint')} />;
  return (
    <div className="table-wrap">
      <table className="sales-table">
        <thead>
          <tr>
            <th>{t('reference')}</th>
            <th>{t('customer')}</th>
            <th>{t('date')}</th>
            <th className="numeric">{t('amount')}</th>
            <th>{t('status')}</th>
            <th>
              <span className="sr-only">{t('receipt')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id}>
              <td>
                <button className="reference-button" onClick={() => onSelect(s.id)}>
                  <span className="transaction-icon">
                    <ReceiptText size={17} />
                  </span>
                  {s.number}
                </button>
              </td>
              <td>{s.customerName ?? t('walkIn')}</td>
              <td className="muted">
                {new Date(s.createdAt).toLocaleDateString(locale, {
                  timeZone: 'Africa/Bujumbura',
                  day: '2-digit',
                  month: 'short',
                })}
              </td>
              <td className="numeric">
                <b>{money(s.total, locale)}</b>
              </td>
              <td>
                <span className={`status ${s.returnedTotal !== '0' ? 'return' : ''}`}>
                  <i />
                  {s.returnedTotal !== '0' ? t('returned') : t('paid')}
                </span>
              </td>
              <td>
                <IconButton
                  icon={ArrowUpRight}
                  label={`${t('receipt')} ${s.number}`}
                  onClick={() => onSelect(s.id)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mobile-transactions">
        {items.map((s) => (
          <button key={s.id} onClick={() => onSelect(s.id)}>
            <span className="transaction-icon">
              <ReceiptText size={19} />
            </span>
            <span>
              <b>{s.number}</b>
              <small>{s.customerName ?? t('walkIn')}</small>
            </span>
            <span>
              <b>{money(s.total, locale)}</b>
              <small>
                {new Date(s.createdAt).toLocaleDateString(locale, {
                  timeZone: 'Africa/Bujumbura',
                })}
              </small>
            </span>
            <ChevronRight size={16} />
          </button>
        ))}
      </div>
    </div>
  );
}
function SalesChart({ data, locale }: { data: { date: string; sales: string }[]; locale: Locale }) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width:767px)');
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const width = narrow ? 400 : 720,
    height = 220,
    left = 64,
    right = 16,
    top = 16,
    bottom = 35,
    plotHeight = height - top - bottom,
    plotWidth = width - left - right;
  const raw = data.map((d) => Number(d.sales)),
    max = Math.max(100, ...raw),
    min = Math.min(0, ...raw),
    range = max - min;
  const pts = data.map((d, i) => ({
    x: left + (data.length <= 1 ? 0.5 : i / (data.length - 1)) * plotWidth,
    y: top + ((max - Number(d.sales)) / range) * plotHeight,
    ...d,
  }));
  const path = pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(' '),
    zero = top + (max / range) * plotHeight;
  const labels = pts.filter(
    (_, i) => i === 0 || i === pts.length - 1 || i % Math.max(1, Math.ceil(pts.length / 6)) === 0,
  );
  return (
    <svg
      className="sales-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={locale === 'fr' ? 'Ventes nettes quotidiennes en BIF' : 'Daily net sales in BIF'}
    >
      <defs>
        <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#18745d" stopOpacity=".13" />
          <stop offset="100%" stopColor="#18745d" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const y = top + f * plotHeight,
          v = max - f * range;
        return (
          <g key={f}>
            <line
              x1={left}
              x2={width - right}
              y1={y}
              y2={y}
              stroke="#e9ede8"
              strokeDasharray="3 5"
            />
            <text x={left - 13} y={y + 4} textAnchor="end">
              {new Intl.NumberFormat(locale, {
                notation: 'compact',
                maximumFractionDigits: 1,
              }).format(v)}
            </text>
          </g>
        );
      })}
      {pts.length > 0 && (
        <>
          <path
            d={`${path} L${pts[pts.length - 1]?.x},${zero} L${pts[0]?.x},${zero} Z`}
            fill="url(#area)"
          />
          <path
            d={path}
            fill="none"
            stroke="#18745d"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {pts.map((p) => (
            <circle
              key={p.date}
              cx={p.x}
              cy={p.y}
              r={data.length > 31 ? 1.5 : 3}
              fill="#fff"
              stroke="#18745d"
              strokeWidth="2"
            >
              <title>
                {p.date}: {money(p.sales, locale)}
              </title>
            </circle>
          ))}
        </>
      )}
      {labels.map((p) => (
        <text key={p.date} x={p.x} y={height - 7} textAnchor="middle">
          {new Date(`${p.date}T12:00:00Z`).toLocaleDateString(locale, {
            day: 'numeric',
            month: 'short',
            timeZone: 'Africa/Bujumbura',
          })}
        </text>
      ))}
    </svg>
  );
}
