'use client';
import { useRef, useState, useEffect, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Context, Product } from '../../../packages/contracts/src/index';
import { can } from '../../../packages/domain/src/index';
import { workspaceMessages, type Locale } from '../../../packages/i18n/src/index';
import { request, RequestError, State, Empty } from './ui';
import { newOperationId } from './idempotency';
export type PurchaseRow = {
  id: string;
  number: string;
  status: string;
  supplierId: string;
  supplierName: string;
  total: string;
  orderDate: string;
  notes: string;
  orderedQuantity: string;
  receivedQuantity: string;
  receivedValue: string;
  paid: string | null;
  owed: string | null;
  supplierOwed: string | null;
  lines: {
    id: string;
    productId: string;
    name: string;
    quantity: string;
    received: string;
    remaining: number;
    batchTracked?: boolean;
    unitCost: string;
  }[];
  receipts: { id: string; number: string; total: string; createdAt: string }[];
  payments: { id: string; amount: string; reference: string; createdAt: string }[];
};
type Supplier = {
  remainingQuantity?: string;
  id: string;
  name: string;
  active: boolean;
  owed?: string | null;
};
const bif = (value: string, locale: Locale) =>
  new Intl.NumberFormat(locale).format(BigInt(value)) + ' BIF';
const day = (context: Context) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: context.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export function PurchasingWorkspace({
  context,
  locale,
  legacy,
}: {
  context: Context;
  locale: Locale;
  legacy?: () => void;
}) {
  const t = workspaceMessages[locale],
    cache = useQueryClient(),
    partition = ['data', context.tenantId, context.businessId, context.branchId];
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(''),
    [showSuppliers, setShowSuppliers] = useState(false),
    [form, setForm] = useState<'new' | 'receive' | 'pay' | null>(null),
    [suggestedSupplier, setSuggestedSupplier] = useState(''),
    [editing, setEditing] = useState<PurchaseRow | null>(null),
    [detail, setDetail] = useState(''),
    [quickSupplier, setQuickSupplier] = useState(false),
    [productSearch, setProductSearch] = useState(''),
    [lines, setLines] = useState([{ productId: '', quantity: '1', unitCost: '' }]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const [linkedId, setLinkedId] = useState(() =>
    typeof window === 'undefined'
      ? ''
      : (new URLSearchParams(window.location.search).get('purchase') ?? ''),
  );
  const query = useQuery({
    queryKey: [...partition, 'purchasing', page, search, linkedId],
    queryFn: () =>
      request<{ items: PurchaseRow[]; total: number; suppliers: Supplier[] }>(
        `v1/purchasing?page=${page}&search=${encodeURIComponent(search)}${linkedId ? `&id=${linkedId}` : ''}`,
        context,
      ),
  });
  const products = useQuery({
    queryKey: [...partition, 'purchase-products', productSearch],
    queryFn: () =>
      request<{ items: Product[] }>(
        `v1/products?limit=100&search=${encodeURIComponent(productSearch)}`,
        context,
      ),
    enabled: form === 'new',
  });
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('reorder');
    if (!id) return;
    let active = true;
    void request<{
      productId: string;
      quantity: number;
      unitCost: string;
      supplierId: string | null;
    }>(`v1/products/${id}/reorder`, context)
      .then((p) => {
        if (!active) return;
        setLines([{ productId: p.productId, quantity: String(p.quantity), unitCost: p.unitCost }]);
        setSuggestedSupplier(p.supplierId ?? '');
        setForm('new');
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : t.failed);
      });
    return () => {
      active = false;
    };
  }, [context, t.failed]);
  const inFlight = useRef(false);
  const pending = useRef<{ path: string; body: unknown; key: string } | null>(null);
  async function mutate(path: string, body: unknown) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    if (!uncertain) pending.current = { path, body, key: newOperationId() };
    try {
      const p = pending.current!;
      await request(`v1/${p.path}`, context, 'POST', p.body, p.key);
      setUncertain(false);
      setForm(null);
      await cache.invalidateQueries({ queryKey: partition });
    } catch (e) {
      setUncertain(e instanceof RequestError && e.uncertain);
      setError(
        e instanceof RequestError && e.code === 'FORBIDDEN'
          ? t.actionDenied
          : e instanceof RequestError && e.code === 'VALIDATION_ERROR'
            ? t.invalid
            : e instanceof RequestError && e.uncertain
              ? t.uncertain
              : e instanceof Error
                ? e.message
                : t.failed,
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function open(kind: 'new' | 'receive' | 'pay', row?: PurchaseRow) {
    setError('');
    setEditing(row ?? null);
    setForm(kind);
    setQuickSupplier(false);
    setLines(
      row?.lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        unitCost: l.unitCost,
      })) ?? [{ productId: '', quantity: '1', unitCost: '' }],
    );
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (uncertain) {
      void mutate('', {});
      return;
    }
    const data = new FormData(e.currentTarget);
    if (form === 'new') {
      const mode = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') ?? 'order';
      void mutate(editing ? `purchasing/${editing.id}/update` : 'purchasing', {
        ...(quickSupplier
          ? {
              supplier: {
                name: String(data.get('supplierName')),
                phone: String(data.get('phone') ?? ''),
              },
            }
          : { supplierId: data.get('supplierId') }),
        mode,
        orderDate: day(context),
        notes: String(data.get('notes') ?? ''),
        lines: lines.map((l) => ({ ...l, quantity: Number(l.quantity) })),
      });
    } else if (form === 'receive' && editing) {
      const received = editing.lines
        .filter((l) => l.remaining > 0)
        .map((l) => ({
          lineId: l.id,
          quantity: Number(data.get(l.id)),
          expiresOn: String(data.get('expiry-' + l.id) || '') || undefined,
        }))
        .filter((l) => l.quantity > 0);
      if (!received.length) {
        setError(t.chooseItems);
        return;
      }
      void mutate(`purchasing/${editing.id}/receive`, { lines: received });
    } else if (form === 'pay' && editing)
      void mutate(`purchasing/${editing.id}/pay`, {
        amount: String(data.get('amount')),
        account: data.get('account'),
        reference: String(data.get('reference') || editing.number + ' / ' + newOperationId()),
      });
  }
  if (!can(context.role, 'purchase.read'))
    return (
      <section className="panel core-panel">
        <p>{t.denied}</p>
      </section>
    );
  return (
    <section className="panel core-panel">
      <div className="panel-heading">
        <h1>{t.purchases}</h1>
        <div>
          {can(context.role, 'purchase.create') && (
            <button
              className="button primary"
              disabled={busy || uncertain}
              onClick={() => open('new')}
            >
              {t.newPurchase}
            </button>
          )}
          {can(context.role, 'supplier.read') && (
            <button className="button secondary" onClick={() => setShowSuppliers(!showSuppliers)}>
              {t.suppliers}
            </button>
          )}
          {legacy && can(context.role, 'payable.manage') && (
            <details>
              <summary>{t.financeMore}</summary>
              <button className="text-button" onClick={legacy}>
                {t.expert}
              </button>
            </details>
          )}
        </div>
      </div>
      <p>
        {context.businessName} · {context.branchName}
      </p>
      <p className="muted">{t.receivedOnly}</p>
      <label>
        {t.search}
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </label>
      {linkedId && (
        <button className="text-button" onClick={() => setLinkedId('')}>
          {t.all}
        </button>
      )}
      {error && (
        <p role="alert" className="notice warning">
          {error}
        </p>
      )}
      {uncertain && !form && <button onClick={() => void mutate('', {})}>{t.retry}</button>}
      {form && (
        <section
          className="panel"
          aria-label={form === 'new' ? t.newPurchase : form === 'receive' ? t.receive : t.markPaid}
        >
          <h2>
            {form === 'new' ? t.newPurchase : form === 'receive' ? t.receive : t.markPaid}{' '}
            {editing?.number}
          </h2>
          <form onSubmit={submit}>
            <fieldset disabled={busy || uncertain}>
              {form === 'new' ? (
                <>
                  <div className="form-grid">
                    {quickSupplier ? (
                      <>
                        <label>
                          {t.supplierName}
                          <input required minLength={2} maxLength={300} name="supplierName" />
                        </label>
                        <label>
                          {t.phone}
                          <input name="phone" maxLength={300} />
                        </label>
                      </>
                    ) : (
                      <label>
                        {t.supplier}
                        <select
                          name="supplierId"
                          required
                          defaultValue={editing?.supplierId ?? suggestedSupplier}
                        >
                          <option value="">—</option>
                          {query.data?.suppliers
                            .filter((s) => s.active)
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                    {can(context.role, 'supplier.create') && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setQuickSupplier(!quickSupplier)}
                      >
                        {quickSupplier ? t.existingSupplier : t.newSupplier}
                      </button>
                    )}
                    <label>
                      {t.notes}
                      <input name="notes" defaultValue={editing?.notes ?? ''} maxLength={300} />
                    </label>
                  </div>
                  <label>
                    {t.searchProducts}
                    <input
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                    />
                  </label>
                  {products.isError && (
                    <State
                      loading={false}
                      error={products.error}
                      retry={() => void products.refetch()}
                    />
                  )}
                  {lines.map((line, index) => (
                    <div className="form-grid" key={index}>
                      <label>
                        {t.product}
                        <select
                          required
                          aria-label={t.product + ' ' + (index + 1)}
                          value={line.productId}
                          onChange={(e) =>
                            setLines(
                              lines.map((l, i) =>
                                i === index ? { ...l, productId: e.target.value } : l,
                              ),
                            )
                          }
                        >
                          <option value="">—</option>
                          {products.data?.items
                            .filter((p) => p.type === 'goods')
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} · {p.sku}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        {t.quantity}
                        <input
                          required
                          type="number"
                          min="0.001"
                          max="1000000"
                          step="0.001"
                          value={line.quantity}
                          onChange={(e) =>
                            setLines(
                              lines.map((l, i) =>
                                i === index ? { ...l, quantity: e.target.value } : l,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        {t.unitCost}
                        <input
                          required
                          type="number"
                          min="1"
                          step="1"
                          value={line.unitCost}
                          onChange={(e) =>
                            setLines(
                              lines.map((l, i) =>
                                i === index ? { ...l, unitCost: e.target.value } : l,
                              ),
                            )
                          }
                        />
                      </label>
                      {lines.length > 1 && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setLines(lines.filter((_, i) => i !== index))}
                        >
                          {t.remove}
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() =>
                      setLines([...lines, { productId: '', quantity: '1', unitCost: '' }])
                    }
                  >
                    {t.addItem}
                  </button>
                </>
              ) : form === 'receive' ? (
                <div className="form-grid">
                  {editing?.lines
                    .filter((l) => l.remaining > 0)
                    .map((l) => (
                      <label key={l.id}>
                        {l.name} · {t.remaining}: {l.remaining}
                        {l.batchTracked && (
                          <input
                            type="date"
                            name={'expiry-' + l.id}
                            required
                            aria-label={locale === 'fr' ? 'Date de péremption' : 'Expiry date'}
                          />
                        )}
                        <input
                          name={l.id}
                          aria-label={l.name}
                          type="number"
                          min="0"
                          max={l.remaining}
                          step="0.001"
                          defaultValue={l.remaining}
                        />
                      </label>
                    ))}
                </div>
              ) : (
                <div className="form-grid">
                  <label>
                    {t.amount}
                    <input
                      name="amount"
                      required
                      type="number"
                      min="1"
                      max={editing?.owed ?? '0'}
                      step="1"
                      defaultValue={editing?.owed ?? ''}
                      id="purchase-amount"
                    />
                  </label>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      const input = document.getElementById('purchase-amount') as HTMLInputElement;
                      input.value = editing?.owed ?? '';
                    }}
                  >
                    {t.fullAmount}
                  </button>
                  <label>
                    {t.paymentMethod}
                    <select name="account">
                      <option value="1000 Cash">{t.cash}</option>
                      <option value="1010 Bank">{t.bank}</option>
                    </select>
                  </label>
                  <label>
                    {t.paymentNote}
                    <input name="reference" maxLength={300} />
                  </label>
                </div>
              )}
            </fieldset>
            <button name="mode" value="order" className="button primary" disabled={busy}>
              {busy
                ? t.saving
                : uncertain
                  ? t.retry
                  : form === 'new'
                    ? t.saveOrder
                    : form === 'receive'
                      ? t.confirmReceive
                      : t.confirmPayment}
            </button>
            {form === 'new' && !uncertain && (
              <button name="mode" value="draft" className="button secondary" disabled={busy}>
                {t.saveDraft}
              </button>
            )}
            {!uncertain && (
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() => setForm(null)}
              >
                {t.cancel}
              </button>
            )}
          </form>
        </section>
      )}
      {query.isPending || query.isError ? (
        <State loading={query.isPending} error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          <div className="table-wrap purchase-table">
            <table>
              <thead>
                <tr>
                  <th>
                    {t.supplier} / {t.items} / {t.total}
                  </th>
                  <th>{t.ordered}</th>
                  <th>{t.received}</th>
                  <th>{t.paid}?</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((row) => (
                  <tr key={row.id}>
                    <td data-label={t.supplier}>
                      <b>{row.supplierName}</b>
                      <p>
                        {row.number} · {bif(row.total, locale)}
                      </p>
                      <small>{row.lines.map((l) => l.name).join(', ')}</small>
                      {row.supplierOwed !== null && (
                        <p>
                          {t.supplierOwed}: {bif(row.supplierOwed, locale)}
                        </p>
                      )}
                      <button
                        className="text-button"
                        onClick={() => setDetail(detail === row.id ? '' : row.id)}
                      >
                        {t.details}
                      </button>
                      {detail === row.id && (
                        <div>
                          <ul>
                            {row.lines.map((l) => (
                              <li key={l.id}>
                                {l.name} · {l.received} {t.of} {l.quantity}
                              </li>
                            ))}
                          </ul>
                          <h3>{t.receipts}</h3>
                          {row.receipts.map((r) => (
                            <p key={r.id}>
                              {new Date(r.createdAt).toLocaleDateString(locale, {
                                timeZone: context.timezone,
                              })}{' '}
                              · {r.number} · {bif(r.total, locale)}
                            </p>
                          ))}
                          {can(context.role, 'payable.manage') && (
                            <>
                              <h3>{t.payments}</h3>
                              {row.payments.length ? (
                                row.payments.map((p) => (
                                  <p key={p.id}>
                                    {new Date(p.createdAt).toLocaleDateString(locale, {
                                      timeZone: context.timezone,
                                    })}{' '}
                                    · {bif(p.amount, locale)} · {p.reference}
                                  </p>
                                ))
                              ) : (
                                <p>{t.noHistory}</p>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </td>
                    <td data-label={t.ordered}>
                      {row.status === 'draft'
                        ? t.draft
                        : row.status === 'cancelled'
                          ? t.cancelled
                          : t.yes}
                      {row.status === 'draft' && can(context.role, 'purchase.create') && (
                        <button
                          className="text-button"
                          disabled={busy || uncertain}
                          onClick={() => open('new', row)}
                        >
                          {t.edit}
                        </button>
                      )}
                      {['draft', 'ordered'].includes(row.status) &&
                        can(context.role, 'purchase.approve') && (
                          <button
                            className="text-button"
                            disabled={busy || uncertain}
                            onClick={() => void mutate(`purchases/${row.id}/cancel`, {})}
                          >
                            {t.cancelOrder}
                          </button>
                        )}
                    </td>
                    <td data-label={t.received}>
                      {Number(row.receivedQuantity) / 1000} {t.of}{' '}
                      {Number(row.orderedQuantity) / 1000}
                      {['ordered', 'partially_received'].includes(row.status) &&
                        can(context.role, 'purchase.receive') && (
                          <button
                            className="button secondary"
                            disabled={busy || uncertain}
                            onClick={() => open('receive', row)}
                          >
                            {t.receive}
                          </button>
                        )}
                    </td>
                    <td data-label={t.paid}>
                      {row.owed === null
                        ? '—'
                        : row.receivedValue === '0'
                          ? t.noneReceived
                          : row.owed === '0'
                            ? t.paid
                            : row.paid !== '0'
                              ? t.partPaid
                              : t.owed}
                      {row.owed !== null && row.receivedValue !== '0' && (
                        <p>
                          {bif(row.owed, locale)} {t.owed}
                        </p>
                      )}
                      {can(context.role, 'payable.manage') &&
                        row.owed !== null &&
                        BigInt(row.owed) > 0n && (
                          <button
                            className="button secondary"
                            disabled={busy || uncertain}
                            onClick={() => open('pay', row)}
                          >
                            {t.markPaid}
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!query.data.items.length && <Empty title={t.noPurchases} />}
          <div className="panel-heading">
            <button
              className="button secondary"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              {t.previous}
            </button>
            <span>
              {t.page} {page}
            </span>
            <button
              className="button secondary"
              disabled={page * 30 >= query.data.total}
              onClick={() => setPage(page + 1)}
            >
              {t.next}
            </button>
          </div>
        </>
      )}
      {showSuppliers && (
        <section className="panel">
          <h2>{t.suppliers}</h2>
          <p>{t.supplierFinance}</p>
          {query.data?.suppliers.map((s) => (
            <div className="settings-row" key={s.id}>
              <b>{s.name}</b>
              <span>
                {t.remaining}: {s.remainingQuantity ?? '0'}
              </span>
              {s.owed !== null && s.owed !== undefined && (
                <span>
                  {t.owed}: {bif(s.owed, locale)}
                </span>
              )}
            </div>
          ))}
        </section>
      )}
    </section>
  );
}
