'use client';
import { newOperationId } from './idempotency';
import { webDraftSchema } from '../../../packages/contracts/src/index';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Landmark,
  Minus,
  Package,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Search,
  ShieldCheck,
  ShoppingBag,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type {
  CashSession,
  Context,
  Customer,
  Product,
  Receipt,
  SaleInput,
} from '../../../packages/contracts/src/index';
import { can, lineAmount } from '../../../packages/domain/src/index';
import {
  money,
  paymentMethodLabel,
  paymentStatusLabel,
  type Locale,
} from '../../../packages/i18n/src/index';

import { Empty, ErrorText, Modal, request, RequestError, State, useT, useWrite } from './ui';
interface Draft {
  lines: { productId: string; quantity: number }[];
  tendered: string;
  customerId: string;
  operationId: string;
  pending: boolean;
  submitted?: SaleInput;
  products?: Product[];
}
export function PointOfSale({
  context,
  locale,
  onReceipt,
  openCash,
}: {
  context: Context;
  locale: Locale;
  onReceipt: (id: string) => void;
  openCash: () => void;
}) {
  const t = useT(),
    q = useQueryClient(),
    [search, setSearch] = useState(''),
    [category, setCategory] = useState('all'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [loaded, setLoaded] = useState(false),
    [method, setMethod] = useState<'cash' | 'card' | 'mobile_money'>('cash'),
    [provider, setProvider] = useState<'Lumicash' | 'Ecocash' | 'iHela'>('Lumicash'),
    [reference, setReference] = useState('');
  const storageKey = `mb-draft:${context.userId}:${context.tenantId}:${context.businessId}:${context.branchId}`;
  const blank = useCallback(
    (): Draft => ({
      lines: [],
      tendered: '',
      customerId: '',
      operationId: newOperationId(),
      pending: false,
    }),
    [],
  );
  const [draft, setDraft] = useState<Draft>(blank);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const result = webDraftSchema.safeParse(
          (() => {
            try {
              return JSON.parse(saved) as unknown;
            } catch {
              return null;
            }
          })(),
        );
        if (result.success) setDraft(result.data);
        else {
          localStorage.setItem(`${storageKey}:quarantine`, saved);
          setError('The saved draft needs review. Its original data has been retained.');
        }
      }
    } catch {
      setError('The saved draft could not be read.');
    }
    setLoaded(true);
  }, [storageKey]);
  useEffect(() => {
    if (loaded) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(draft));
      } catch {
        setError('The draft could not be saved on this device. Keep this page open.');
      }
    }
  }, [draft, loaded, storageKey]);
  const queryKey = ['data', context.tenantId, context.businessId, context.branchId];
  const products = useQuery({
    queryKey: [...queryKey, 'pos-products', search],
    queryFn: () =>
      request<{ items: Product[]; total: number }>(
        `v1/products?search=${encodeURIComponent(search)}&limit=100`,
        context,
      ),
  });
  const cartProducts = useQuery({
    queryKey: [...queryKey, 'cart-products', draft.lines.map((l) => l.productId).join(',')],
    queryFn: async () => {
      const all = await request<{ items: Product[] }>('v1/products?limit=100', context);
      return all.items;
    },
  });
  const customers = useQuery({
    queryKey: [...queryKey, 'pos-customers'],
    queryFn: () => request<{ items: Customer[] }>('v1/customers?limit=100', context),
    enabled: can(context.role, 'customer.read'),
  });
  const register = useQuery({
    queryKey: [...queryKey, 'cash-session'],
    queryFn: () => request<CashSession | null>('v1/cash-session', context),
    enabled: can(context.role, 'cash.manage'),
  });
  const map = new Map(
    [
      ...(cartProducts.data ?? []),
      ...(products.data?.items ?? []),
      ...(draft.pending ? (draft.products ?? []) : []),
    ].map((p) => [p.id, p]),
  );
  const update = (fn: (d: Draft) => Draft) => {
    if (draft.pending || busy) return;
    setError('');
    setDraft((d) => ({ ...fn(d), operationId: newOperationId() }));
  };
  const add = (p: Product) =>
    update((d) => {
      const line = d.lines.find((l) => l.productId === p.id);
      return {
        ...d,
        lines: line
          ? d.lines.map((l) => (l.productId === p.id ? { ...l, quantity: l.quantity + 1 } : l))
          : [...d.lines, { productId: p.id, quantity: 1 }],
      };
    });
  const total = draft.lines.reduce(
    (n, l) => n + lineAmount(map.get(l.productId)?.price ?? '0', l.quantity),
    0n,
  );
  const categories = [...new Set(products.data?.items.map((p) => p.category) ?? [])];
  const complete = async () => {
    if ((!register.data && !draft.submitted) || busy || !navigator.onLine) {
      setError(t('onlineRequired'));
      return;
    }
    setBusy(true);
    setError('');
    const submitted = draft.submitted ?? {
      lines: draft.lines,
      tendered: draft.tendered,
      customerId: draft.customerId || undefined,
      cashSessionId: register.data!.id,
      payment: {
        method,
        provider: method === 'mobile_money' ? provider : undefined,
        reference: reference || undefined,
      },
    };
    const pending = {
      ...draft,
      pending: true,
      submitted,
      products: draft.lines.flatMap((l) => (map.get(l.productId) ? [map.get(l.productId)!] : [])),
    };
    setDraft(pending);
    try {
      try {
        localStorage.setItem(storageKey, JSON.stringify(pending));
      } catch {
        throw new RequestError(
          'DRAFT_STORAGE_FAILED',
          'The draft could not be saved on this device.',
        );
      }
      const r = await request<{ id: string }>(
        'v1/sales',
        context,
        'POST',
        submitted,
        draft.operationId,
      );
      setDraft(blank());
      localStorage.removeItem(storageKey);
      void q.invalidateQueries({ queryKey });
      onReceipt(r.id);
    } catch (e) {
      if (e instanceof RequestError && e.uncertain) {
        setError(t('unknownOutcome'));
      } else {
        setDraft((d) => ({ ...d, pending: false, submitted: undefined }));
        setError(e instanceof Error ? e.message : 'Sale failed');
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pos-layout">
      <section className="pos-catalog">
        <div className="search-field">
          <Search size={19} />
          <input
            placeholder={t('search')}
            aria-label={t('search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const exact = products.data?.items.find(
                  (p) => p.barcode === search || p.sku === search,
                );
                if (exact) {
                  add(exact);
                  setSearch('');
                }
              }
            }}
          />
          <ScanLine size={20} />
        </div>
        <div className="category-tabs">
          <button className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>
            {t('all')}
          </button>
          {categories.map((c) => (
            <button
              key={c}
              className={category === c ? 'active' : ''}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
        {products.isPending || products.isError ? (
          <State
            loading={products.isPending}
            error={products.error}
            retry={() => void products.refetch()}
          />
        ) : (
          <>
            <div className="pos-products">
              {products.data.items
                .filter((p) => category === 'all' || p.category === category)
                .map((p, i) => (
                  <button
                    key={p.id}
                    className="pos-product"
                    onClick={() => add(p)}
                    disabled={draft.pending || busy || (p.type === 'goods' && p.onHand <= 0)}
                  >
                    <span className={`product-visual shade-${i % 4}`}>
                      <Package size={36} strokeWidth={1.25} />
                      <span>{p.category}</span>
                    </span>
                    <b>{p.name}</b>
                    <small>{p.sku}</small>
                    <span className="pos-product-price">
                      {money(p.price, locale)}
                      <span className="add-product">
                        <Plus size={16} />
                      </span>
                    </span>
                    <span className="product-availability">
                      {p.type === 'service' ? t('service') : `${p.onHand} ${t('available')}`}
                    </span>
                  </button>
                ))}
            </div>
            {!products.data.items.length && <Empty title={t('noData')} />}
          </>
        )}
      </section>
      <aside className="panel pos-cart">
        <div className="panel-heading">
          <h2>{t('cart')}</h2>
          <span className="count-badge">{draft.lines.reduce((n, l) => n + l.quantity, 0)}</span>
        </div>
        <div className="cart-customer">
          <Users size={18} />
          <select
            aria-label={t('customer')}
            value={draft.customerId}
            disabled={draft.pending || busy}
            onChange={(e) => update((d) => ({ ...d, customerId: e.target.value }))}
          >
            <option value="">{t('walkIn')}</option>
            {customers.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="cart-lines">
          {draft.lines.length ? (
            draft.lines.map((l) => {
              const p = map.get(l.productId);
              return (
                <div className="cart-line" key={l.productId}>
                  <span className="product-mini">
                    <Package size={20} />
                  </span>
                  <div>
                    <b>{p?.name ?? l.productId}</b>
                    <small>{p ? money(p.price, locale) : '…'}</small>
                    <div className="quantity-control">
                      <button
                        disabled={draft.pending || busy}
                        aria-label={`${t('quantity')} −`}
                        onClick={() =>
                          update((d) => ({
                            ...d,
                            lines: d.lines.flatMap((item) =>
                              item.productId === l.productId
                                ? item.quantity <= 1
                                  ? []
                                  : [{ ...item, quantity: item.quantity - 1 }]
                                : [item],
                            ),
                          }))
                        }
                      >
                        <Minus size={13} />
                      </button>
                      <input
                        aria-label={`${t('quantity')} ${p?.name ?? ''}`}
                        type="number"
                        min="0.001"
                        max="1000000"
                        step="0.001"
                        value={l.quantity}
                        disabled={draft.pending || busy}
                        onChange={(e) => {
                          const quantity = Number(e.target.value);
                          if (quantity > 0)
                            update((d) => ({
                              ...d,
                              lines: d.lines.map((item) =>
                                item.productId === l.productId ? { ...item, quantity } : item,
                              ),
                            }));
                        }}
                      />
                      <button
                        disabled={draft.pending || busy}
                        aria-label={`${t('quantity')} +`}
                        onClick={() => {
                          if (p) add(p);
                        }}
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                  </div>
                  <b className="cart-line-total">
                    {p ? money(lineAmount(p.price, l.quantity).toString(), locale) : '—'}
                  </b>
                </div>
              );
            })
          ) : (
            <Empty icon={ShoppingBag} title={t('emptyCart')} hint={t('emptyCartHint')} />
          )}
        </div>
        <div className="cart-checkout">
          <div className="cart-total">
            <span>{t('total')}</span>
            <strong>{money(total.toString(), locale)}</strong>
          </div>
          <p className="small muted">{t('checkoutHint')}</p>
          <ErrorText error={error} />
          {register.isError ? (
            <State error={register.error} retry={() => void register.refetch()} />
          ) : register.isPending ? (
            <p className="muted small">{t('loading')}</p>
          ) : !register.data && !draft.pending ? (
            <>
              <p className="notice small">{t('registerRequired')}</p>
              <button className="button secondary full" onClick={openCash}>
                <Landmark size={17} />
                {t('openRegister')}
              </button>
            </>
          ) : (
            <>
              <label className="field">
                <span>{locale === 'fr' ? 'Mode de paiement' : 'Payment method'}</span>
                <select
                  value={method}
                  disabled={draft.pending || busy}
                  onChange={(e) => setMethod(e.target.value as typeof method)}
                >
                  <option value="cash">{t('cash')}</option>
                  <option value="card">{locale === 'fr' ? 'Carte' : 'Card'}</option>
                  <option value="mobile_money">Mobile money</option>
                </select>
              </label>
              {method === 'mobile_money' && (
                <>
                  <label className="field">
                    <span>{locale === 'fr' ? 'Fournisseur' : 'Provider'}</span>
                    <select
                      value={provider}
                      disabled={draft.pending || busy}
                      onChange={(e) => setProvider(e.target.value as typeof provider)}
                    >
                      {['Lumicash', 'Ecocash', 'iHela'].map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>
                      {locale === 'fr'
                        ? 'Référence de transaction / message'
                        : 'Transaction / message reference'}
                    </span>
                    <input
                      required
                      value={reference}
                      disabled={draft.pending || busy}
                      onChange={(e) => setReference(e.target.value)}
                    />
                  </label>
                </>
              )}
              {method !== 'cash' && (
                <p className="small muted">
                  {locale === 'fr'
                    ? 'Justificatif enregistré ; paiement non vérifié par le fournisseur.'
                    : 'Payment evidence recorded; provider verification pending.'}
                </p>
              )}
              <label className="field">
                <span>{t('tendered')} (Fbu)</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={draft.tendered}
                  disabled={draft.pending || busy}
                  onChange={(e) => update((d) => ({ ...d, tendered: e.target.value }))}
                />
              </label>
              <div className="change-row">
                <span>{t('change')}</span>
                <b>
                  {money(
                    (/^\d+$/.test(draft.tendered) && BigInt(draft.tendered) >= total
                      ? BigInt(draft.tendered) - total
                      : 0n
                    ).toString(),
                    locale,
                  )}
                </b>
              </div>
              <button
                className="button primary full"
                onClick={() => void complete()}
                disabled={
                  busy ||
                  !draft.lines.length ||
                  !draft.tendered ||
                  !can(context.role, 'sale.create')
                }
              >
                {busy ? <RefreshCw className="spin" size={18} /> : <Check size={18} />}{' '}
                {draft.pending ? t('retry') : t('completeSale')}
              </button>
            </>
          )}
          <span className="draft-note">
            <ShieldCheck size={13} />
            {t('draft')}
          </span>
        </div>
      </aside>
    </div>
  );
}
export function ReceiptModal({
  id,
  context,
  locale,
  onClose,
}: {
  id: string;
  context: Context;
  locale: Locale;
  onClose: () => void;
}) {
  const t = useT(),
    q = useQueryClient(),
    [returning, setReturning] = useState(false),
    [counts, setCounts] = useState<Record<string, string>>({}),
    [disposition, setDisposition] = useState('restockable'),
    [reason, setReason] = useState(''),
    [validationError, setValidationError] = useState('');
  const receipt = useQuery({
    queryKey: ['data', context.tenantId, context.businessId, context.branchId, 'receipt', id],
    queryFn: () => request<Receipt>(`v1/sales/${id}`, context),
  });
  const { busy, error, uncertain, submit, changed, retry } = useWrite(
    context,
    () => {
      setReturning(false);
      setCounts({});
      void q.invalidateQueries();
    },
    `return:${id}`,
  );
  const refund = async (e: FormEvent) => {
    e.preventDefault();
    setValidationError('');
    if (uncertain) {
      void retry();
      return;
    }
    try {
      const session = await request<CashSession | null>('v1/cash-session', context);
      if (!session) {
        setValidationError(t('registerRequired'));
        return;
      }
      await submit(`v1/sales/${id}/returns`, {
        lines: Object.entries(counts)
          .filter(([, qty]) => Number(qty) > 0)
          .map(([saleLineId, qty]) => ({ saleLineId, quantity: Number(qty), disposition })),
        reason,
        cashSessionId: session.id,
      });
    } catch (e) {
      setValidationError(e instanceof Error ? e.message : 'Request failed');
    }
  };
  const r = receipt.data;
  return (
    <Modal title={returning ? t('processReturn') : t('receipt')} onClose={onClose}>
      {receipt.isPending || receipt.isError ? (
        <State
          loading={receipt.isPending}
          error={receipt.error}
          retry={() => void receipt.refetch()}
        />
      ) : (
        r && (
          <>
            <div className="receipt-print">
              <div className="receipt-header">
                <div className="receipt-success">
                  <Check size={24} />
                </div>
                <h2>{r.businessName}</h2>
                <p>{r.branchName}</p>
                <b>{r.number}</b>
                <small>
                  {new Date(r.createdAt).toLocaleString(locale, {
                    timeZone: context.timezone,
                  })}
                </small>
              </div>
              {r.offline && (
                <p className="notice">
                  {locale === 'fr' ? 'Vente hors ligne synchronisée' : 'Synchronized offline sale'}{' '}
                  · {r.syncedAt}
                </p>
              )}
              {(r.reviewRequired || r.valuationPending) && (
                <p className="notice warning">
                  {locale === 'fr'
                    ? 'Examen du stock / coût requis'
                    : 'Inventory / cost review required'}
                </p>
              )}
              {r.payment && (
                <p>
                  {paymentMethodLabel(r.payment.method, locale)} · {r.payment.provider} ·{' '}
                  {r.payment.reference}
                  <br />
                  {paymentStatusLabel(r.payment.status, locale)}
                </p>
              )}
              <div className="receipt-customer">
                {t('customer')}
                <b>{r.customerName ?? t('walkIn')}</b>
              </div>
              <div className="receipt-lines">
                {r.lines.map((l) => (
                  <div key={l.id}>
                    <span>
                      <b>{l.name}</b>
                      <small>
                        {l.quantity} × {money(l.unitPrice, locale)}
                        {l.returned > 0 ? ` · ${l.returned} ${t('returned')}` : ''}
                      </small>
                    </span>
                    <b>{money(l.total, locale)}</b>
                  </div>
                ))}
              </div>
              <div className="receipt-total">
                <span>{t('total')}</span>
                <strong>{money(r.total, locale)}</strong>
              </div>
              <div className="receipt-meta">
                <span>{t('tendered')}</span>
                <b>{money(r.tendered, locale)}</b>
              </div>
              <div className="receipt-meta">
                <span>{t('change')}</span>
                <b>{money(r.change, locale)}</b>
              </div>
              {r.returnedTotal !== '0' && (
                <div className="receipt-meta">
                  <span>{t('refunds')}</span>
                  <b>{money(r.returnedTotal, locale)}</b>
                </div>
              )}
              <p className="small muted receipt-disclaimer">{t('provisional')}</p>
            </div>
            {returning ? (
              <form
                className="form return-form"
                onSubmit={(e) => void refund(e)}
                onChange={changed}
              >
                <p className="small muted">{t('returnSummary')}</p>
                <ErrorText error={error || validationError} />
                {r.lines
                  .filter((l) => l.quantity > l.returned)
                  .map((l) => (
                    <label className="return-line" key={l.id}>
                      <span>
                        {l.name}
                        <small>
                          {l.quantity - l.returned} {t('available')}
                        </small>
                      </span>
                      <input
                        aria-label={`${t('returnQuantity')} ${l.name}`}
                        type="number"
                        min="0"
                        max={l.quantity - l.returned}
                        step="1"
                        value={counts[l.id] ?? '0'}
                        onChange={(e) => setCounts({ ...counts, [l.id]: e.target.value })}
                      />
                    </label>
                  ))}
                <label className="field">
                  <span>{t('status')}</span>
                  <select value={disposition} onChange={(e) => setDisposition(e.target.value)}>
                    <option value="restockable">{t('restockable')}</option>
                    <option value="damaged">{t('damaged')}</option>
                  </select>
                </label>
                <label className="field">
                  <span>{t('returnReason')}</span>
                  <input
                    required={!uncertain}
                    minLength={uncertain ? undefined : 3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <button
                  className="button primary"
                  disabled={
                    busy || (!uncertain && !Object.values(counts).some((v) => Number(v) > 0))
                  }
                >
                  {busy ? t('working') : uncertain ? t('retry') : t('processReturn')}
                </button>
              </form>
            ) : (
              <div className="receipt-actions">
                <button className="button secondary" onClick={() => window.print()}>
                  <Printer size={17} />
                  {t('print')}
                </button>
                {can(context.role, 'sale.refund') &&
                  r.lines.some((l) => l.quantity > l.returned) && (
                    <button className="button secondary" onClick={() => setReturning(true)}>
                      <RotateCcw size={16} />
                      {t('processReturn')}
                    </button>
                  )}
              </div>
            )}
          </>
        )
      )}
    </Modal>
  );
}
