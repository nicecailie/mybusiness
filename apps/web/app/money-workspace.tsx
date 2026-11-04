'use client';
import { useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Context } from '../../../packages/contracts/src/index';
import { can } from '../../../packages/domain/src/index';
import { workspaceMessages, type Locale } from '../../../packages/i18n/src/index';
import { Empty, State, request, RequestError } from './ui';
import { newOperationId } from './idempotency';
const bif = (v: string, locale: Locale) => new Intl.NumberFormat(locale).format(BigInt(v)) + ' BIF';
const today = (c: Context) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: c.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
type SpendingRow = {
  id: string;
  kind: 'purchase' | 'running' | 'equipment' | 'other';
  reference: string;
  name: string;
  date: string;
  amount: string;
  purchaseId?: string;
  expenseId?: string;
  reversal?: boolean;
};
type Balance = {
  id: string;
  balance: string;
  number?: string;
  reference?: string;
  customerName?: string;
  supplierName?: string;
  dueDate: string;
};
type MoneyData = {
  metrics: Record<
    | 'restaurantRevenue'
    | 'accommodationRevenue'
    | 'guestDepositsHeld'
    | 'sales'
    | 'costOfGoods'
    | 'profitOnSales'
    | 'runningCosts'
    | 'stockLoss'
    | 'profitAfterCosts'
    | 'customersOwe'
    | 'suppliersOwed'
    | 'stockValue'
    | 'cashIn'
    | 'cashOut',
    string
  >;
  costsByType: Record<'running' | 'equipment' | 'other' | 'purchase', string>;
  spending: SpendingRow[];
  receivables: Balance[];
  payables: Balance[];
  valuationPending: boolean;
  inventory: { id: string; name: string; onHand: string; value: string }[];
  categoryPerformance: {
    category: string;
    revenue: string;
    cost: string;
    grossProfit: string;
    marginPercent: string | null;
  }[];
  productPerformance: {
    productId: string;
    productName: string;
    quantity: string;
    revenue: string;
    cost: string;
    grossProfit: string;
    marginPercent: string | null;
  }[];
};
export function MoneyWorkspace({ context, locale }: { context: Context; locale: Locale }) {
  const t = workspaceMessages[locale],
    [from, setFrom] = useState(today(context)),
    [to, setTo] = useState(today(context)),
    [kind, setKind] = useState('all'),
    [drill, setDrill] = useState<'spending' | 'customers' | 'suppliers' | 'products' | 'stock'>(
      'spending',
    );
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
  const data = useQuery({
    queryKey: ['data', context.tenantId, context.businessId, context.branchId, 'money', from, to],
    queryFn: () => request<MoneyData>(`v1/money?from=${from}&to=${to}`, context),
    enabled: can(context.role, 'finance.read') && valid,
  });
  if (!can(context.role, 'finance.read'))
    return (
      <section className="panel core-panel">
        <p>{t.denied}</p>
      </section>
    );
  function jump(target: typeof drill) {
    setDrill(target);
    document.getElementById('money-detail')?.scrollIntoView({ behavior: 'smooth' });
  }
  return (
    <section className="panel core-panel">
      <div className="panel-heading">
        <h1>{t.money}</h1>
        <a className="button secondary" href="?page=expenses">
          {t.newCost}
        </a>
      </div>
      <p>
        {context.businessName} · {context.branchName} · BIF
      </p>
      <div className="date-range">
        <label>
          {t.from}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          {t.to}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {!valid ? (
        <p role="alert">{t.invalidDates}</p>
      ) : data.isPending || data.isError ? (
        <State loading={data.isPending} error={data.error} retry={() => void data.refetch()} />
      ) : (
        <>
          {data.data.valuationPending && <p className="notice warning">{t.provisional}</p>}
          {context.industryId &&
            [
              'hotel',
              'guest_house',
              'lodge',
              'resort',
              'restaurant',
              'fast_food',
              'bar_pub',
            ].includes(context.industryId) && (
              <div className="workspace-cards">
                {(['restaurantRevenue', 'accommodationRevenue', 'guestDepositsHeld'] as const).map(
                  (k) => (
                    <section className="panel" key={k}>
                      <h3>{t[k]}</h3>
                      <strong>{bif(data.data.metrics[k], locale)}</strong>
                    </section>
                  ),
                )}
              </div>
            )}
          <div className="workspace-cards">
            {(
              [
                'sales',
                'costOfGoods',
                'profitOnSales',
                'runningCosts',
                'stockLoss',
                'profitAfterCosts',
                'customersOwe',
                'suppliersOwed',
                'stockValue',
              ] as const
            ).map((metric) => {
              const href =
                metric === 'sales'
                  ? '?page=sales'
                  : metric === 'costOfGoods' || metric === 'profitOnSales'
                    ? '#money-detail'
                    : metric === 'stockValue'
                      ? '#money-detail'
                      : metric === 'runningCosts'
                        ? `?page=expenses&from=${from}&to=${to}`
                        : undefined;
              const content = (
                <>
                  <span>{t[metric]}</span>
                  <strong>{bif(data.data.metrics[metric], locale)}</strong>
                </>
              );
              return href ? (
                <a
                  className="panel money-card"
                  key={metric}
                  href={href}
                  onClick={
                    metric === 'stockValue'
                      ? () => setDrill('stock')
                      : metric === 'costOfGoods' || metric === 'profitOnSales'
                        ? () => setDrill('products')
                        : undefined
                  }
                >
                  {content}
                </a>
              ) : (
                <button
                  className="panel money-card"
                  key={metric}
                  onClick={() =>
                    jump(
                      metric === 'customersOwe'
                        ? 'customers'
                        : metric === 'suppliersOwed'
                          ? 'suppliers'
                          : 'spending',
                    )
                  }
                >
                  {content}
                </button>
              );
            })}
          </div>
          <p className="muted">{t.currentBalances}</p>
          <h2>{t.cashFigures}</h2>
          <div className="workspace-cards">
            {(['cashIn', 'cashOut'] as const).map((metric) => (
              <div className="panel money-card" key={metric}>
                <span>{t[metric]}</span>
                <strong>{bif(data.data.metrics[metric], locale)}</strong>
              </div>
            ))}
          </div>
          <p>{t.cashHint}</p>
          <h2>{t.costsByType}</h2>
          <div className="workspace-cards">
            {(['purchase', 'running', 'equipment', 'other'] as const).map((key) => (
              <button
                className="panel money-card"
                key={key}
                onClick={() => {
                  setKind(key);
                  jump('spending');
                }}
              >
                <span>{t[key]}</span>
                <strong>{bif(data.data.costsByType[key], locale)}</strong>
              </button>
            ))}
          </div>
          <p className="muted">{t.equipmentHint}</p>
          <section id="money-detail">
            <div className="segmented">
              {(['spending', 'customers', 'suppliers', 'products'] as const).map((v) => (
                <button
                  key={v}
                  className={drill === v ? 'selected' : ''}
                  onClick={() => setDrill(v)}
                >
                  {v === 'spending'
                    ? t.allSpending
                    : v === 'customers'
                      ? t.customersOwe
                      : v === 'suppliers'
                        ? t.suppliersOwed
                        : t.profitProducts}
                </button>
              ))}
            </div>
            {drill === 'spending' ? (
              <>
                <label>
                  {t.kind}
                  <select value={kind} onChange={(e) => setKind(e.target.value)}>
                    {(['all', 'purchase', 'running', 'equipment', 'other'] as const).map((v) => (
                      <option key={v} value={v}>
                        {t[v]}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t.date}</th>
                        <th>{t.name}</th>
                        <th>{t.kind}</th>
                        <th>{t.amount}</th>
                        <th>{t.open}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.data.spending
                        .filter((s) => kind === 'all' || s.kind === kind)
                        .map((s) => (
                          <tr key={s.id}>
                            <td>{s.date}</td>
                            <td>
                              {s.name} {s.reversal && <small>{t.reversal}</small>}
                            </td>
                            <td>{t[s.kind]}</td>
                            <td>{bif(s.amount, locale)}</td>
                            <td>
                              <a
                                href={
                                  s.purchaseId
                                    ? `?page=purchases&purchase=${s.purchaseId}`
                                    : `?page=expenses&expense=${s.expenseId}&from=${from}&to=${to}`
                                }
                              >
                                {t.open}
                              </a>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {!data.data.spending.length && <Empty title={t.noSpending} />}
              </>
            ) : drill === 'stock' ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t.product}</th>
                      <th>{t.quantity}</th>
                      <th>{t.stockValue}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.inventory.map((i) => (
                      <tr key={i.id}>
                        <td>{i.name}</td>
                        <td>{i.onHand}</td>
                        <td>{bif(i.value, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : drill === 'products' ? (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t.product}</th>
                        <th>{t.quantity}</th>
                        <th>{t.sales}</th>
                        <th>{t.costOfGoods}</th>
                        <th>{t.profitOnSales}</th>
                        <th>{t.margin}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.data.productPerformance.map((p) => (
                        <tr key={p.productId}>
                          <td>{p.productName}</td>
                          <td>{p.quantity}</td>
                          <td>{bif(p.revenue, locale)}</td>
                          <td>{bif(p.cost, locale)}</td>
                          <td>{bif(p.grossProfit, locale)}</td>
                          <td>{p.marginPercent ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <h3>{t.profitCategories}</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t.category}</th>
                        <th>{t.sales}</th>
                        <th>{t.costOfGoods}</th>
                        <th>{t.profitOnSales}</th>
                        <th>{t.margin}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.data.categoryPerformance.map((c) => (
                        <tr key={c.category}>
                          <td>{c.category}</td>
                          <td>{bif(c.revenue, locale)}</td>
                          <td>{bif(c.cost, locale)}</td>
                          <td>{bif(c.grossProfit, locale)}</td>
                          <td>{c.marginPercent ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{drill === 'customers' ? t.customer : t.supplier}</th>
                      <th>{t.reference}</th>
                      <th>{t.due}</th>
                      <th>{t.owed}</th>
                      <th>{t.open}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(drill === 'customers' ? data.data.receivables : data.data.payables)
                      .filter((b) => b.balance !== '0')
                      .map((b) => (
                        <tr key={b.id}>
                          <td>{b.customerName ?? b.supplierName}</td>
                          <td>{b.number ?? b.reference}</td>
                          <td>{b.dueDate}</td>
                          <td>{bif(b.balance, locale)}</td>
                          <td>
                            <a href={drill === 'customers' ? '?page=invoices' : '?page=purchases'}>
                              {t.open}
                            </a>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}

type Category = {
  id: string;
  name: string;
  kind: 'running' | 'equipment' | 'other';
  systemKey: string | null;
};
type ExpenseRow = {
  id: string;
  categoryId: string;
  expenseDate: string;
  amount: string;
  description: string;
  status: string;
  postingAccount: string;
};
export function SpendingWorkspace({ context, locale }: { context: Context; locale: Locale }) {
  const t = workspaceMessages[locale],
    cache = useQueryClient(),
    partition = ['data', context.tenantId, context.businessId, context.branchId],
    params =
      typeof window === 'undefined'
        ? new URLSearchParams()
        : new URLSearchParams(window.location.search);
  const [from, setFrom] = useState(params.get('from') ?? today(context)),
    [to, setTo] = useState(params.get('to') ?? today(context)),
    [form, setForm] = useState(false),
    [categoryId, setCategoryId] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const valid = from !== '' && to !== '' && from <= to;
  const categories = useQuery({
    queryKey: [...partition, 'expense-categories'],
    queryFn: () => request<Category[]>('v1/expense-categories', context),
    enabled: can(context.role, 'expense.read'),
  });
  const expenses = useQuery({
    queryKey: [...partition, 'spending', from, to],
    queryFn: () =>
      request<{ items: ExpenseRow[]; total: string }>(`v1/expenses?from=${from}&to=${to}`, context),
    enabled: can(context.role, 'expense.read') && valid,
  });
  const attempt = useRef<{ path: string; key: string; body: unknown } | null>(null),
    inFlight = useRef(false);
  const label = (c: Category) =>
    c.systemKey === 'rent'
      ? t.defaultRent
      : c.systemKey === 'utilities'
        ? t.defaultUtilities
        : c.systemKey === 'equipment'
          ? t.defaultEquipment
          : c.systemKey === 'other'
            ? t.defaultOther
            : c.name;
  async function save(path: string, body: unknown) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    if (!uncertain) attempt.current = { path, body, key: newOperationId() };
    try {
      const p = attempt.current!;
      await request('v1/' + p.path, context, 'POST', p.body, p.key);
      setUncertain(false);
      setForm(false);
      await cache.invalidateQueries({ queryKey: partition });
    } catch (e) {
      setUncertain(e instanceof RequestError && e.uncertain);
      setError(
        e instanceof RequestError && e.uncertain
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
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (uncertain) {
      void save('', {});
      return;
    }
    const body = Object.fromEntries(new FormData(e.currentTarget));
    void save('expenses', body);
  }
  if (!can(context.role, 'expense.read'))
    return <section className="panel core-panel">{t.denied}</section>;
  return (
    <section className="panel core-panel">
      <div className="panel-heading">
        <h1>{t.spending}</h1>
        {can(context.role, 'expense.create') && (
          <button
            className="button primary"
            disabled={uncertain || busy}
            onClick={() => setForm(true)}
          >
            {t.newCost}
          </button>
        )}
      </div>
      <p>{t.kindHelp}</p>
      <div className="date-range">
        <label>
          {t.from}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          {t.to}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label>
          {t.category}
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">{t.all}</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {label(c)} · {t[c.kind]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      {uncertain && !form && <button onClick={() => void save('', {})}>{t.retry}</button>}
      {form && (
        <form className="panel" onSubmit={submit}>
          <h2>{t.newCost}</h2>
          <fieldset disabled={busy || uncertain}>
            <div className="form-grid">
              <label>
                {t.category}
                <select name="categoryId" required>
                  <option value="">—</option>
                  {categories.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {label(c)} · {t[c.kind]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t.date}
                <input name="expenseDate" type="date" required defaultValue={today(context)} />
              </label>
              <label>
                {t.amount}
                <input name="amount" type="number" min="1" step="1" required />
              </label>
              <label>
                {t.paymentMethod}
                <select name="account">
                  <option value="1000 Cash">{t.cash}</option>
                  <option value="1010 Bank">{t.bank}</option>
                </select>
              </label>
              <label>
                {t.description}
                <input name="description" required minLength={3} maxLength={300} />
              </label>
            </div>
          </fieldset>
          <button className="button primary" disabled={busy}>
            {busy ? t.saving : uncertain ? t.retry : t.save}
          </button>
          {!uncertain && (
            <button type="button" className="button secondary" onClick={() => setForm(false)}>
              {t.cancel}
            </button>
          )}
        </form>
      )}
      {!valid ? (
        <p>{t.invalidDates}</p>
      ) : expenses.isPending || expenses.isError ? (
        <State
          loading={expenses.isPending}
          error={expenses.error}
          retry={() => void expenses.refetch()}
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.date}</th>
                <th>{t.description}</th>
                <th>{t.kind}</th>
                <th>{t.amount}</th>
                <th>{t.paid}</th>
                <th>{t.more}</th>
              </tr>
            </thead>
            <tbody>
              {expenses.data.items
                .filter((e) => !categoryId || e.categoryId === categoryId)
                .map((e) => (
                  <tr key={e.id} id={'expense-' + e.id}>
                    <td>{e.expenseDate}</td>
                    <td>{e.description}</td>
                    <td>
                      {e.postingAccount === '1500 Equipment'
                        ? t.equipment
                        : e.postingAccount === '6100 Other spending'
                          ? t.other
                          : t.running}
                    </td>
                    <td>{bif(e.amount, locale)}</td>
                    <td>{e.status === 'posted' ? t.paid : t.reversal}</td>
                    <td>
                      {can(context.role, 'expense.reverse') && e.status === 'posted' && (
                        <details>
                          <summary>{t.reverse}</summary>
                          <form
                            onSubmit={(event) => {
                              event.preventDefault();
                              const data = new FormData(event.currentTarget);
                              void save(`expenses/${e.id}/reverse`, {
                                reason: String(data.get('reason')),
                              });
                            }}
                          >
                            <label>
                              {t.reason}
                              <input
                                required
                                minLength={3}
                                name="reason"
                                disabled={busy || uncertain}
                              />
                            </label>
                            <button className="button secondary" disabled={busy}>
                              {uncertain ? t.retry : t.reverse}
                            </button>
                          </form>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!expenses.data.items.length && <Empty title={t.noRecords} />}
        </div>
      )}
    </section>
  );
}
