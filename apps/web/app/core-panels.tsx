'use client';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Context, Permission, Product } from '../../../packages/contracts/src/index';
import { can } from '../../../packages/domain/src/index';
import { hasEffectiveModule } from '../../../packages/domain/src/industries';
import { Empty, State, request, RequestError } from './ui';
import { newOperationId } from './idempotency';

type Row = { id: string; [key: string]: string | number | boolean | null | undefined };
type Rows = { items: Row[]; total?: number; lines?: Row[]; payments?: Row[] };
type Field = {
  name: string;
  label: string;
  type?: string;
  value?: string;
  optional?: boolean;
  options?: { id: string; name: string }[];
};
const val = (r: Row | undefined, k: string) =>
  String(r?.[k] ?? (k === 'displayStatus' ? r?.status : '') ?? '');
const today = (c: Context) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: c.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const field = (name: string, label: string, type = 'text', value?: string): Field => ({
  name,
  label,
  type,
  value,
});
const options = (name: string, label: string, rows: Row[]): Field => ({
  name,
  label,
  options: rows.map((r) => ({
    id: r.id,
    name: val(r, 'name') || val(r, 'number') || val(r, 'reference') || r.id,
  })),
});
const moneyAccount: Field = {
  name: 'account',
  label: 'Paid through',
  options: [
    { id: '1000 Cash', name: 'Business cash (outside the POS register)' },
    { id: '1010 Bank', name: 'Bank — confirmed transaction' },
  ],
};
const outstanding = (r: Row) =>
  (BigInt(val(r, 'total') || '0') - BigInt(val(r, 'paid') || '0')).toString();
function Grid({
  rows,
  columns,
  actions,
}: {
  rows: Row[];
  columns: [string, string][];
  actions?: (r: Row) => ReactNode;
}) {
  if (!rows.length) return <Empty title="No records yet" hint="Create a record to get started." />;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map(([key, label]) => (
              <th key={key}>{label}</th>
            ))}
            {actions && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {columns.map(([key]) => (
                <td key={key}>
                  {key === 'balance'
                    ? outstanding(r)
                    : key === 'paymentStatus'
                      ? val(r, key)
                      : val(r, key)}
                </td>
              ))}
              {actions && <td>{actions(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function EntryForm({
  title,
  fields,
  products,
  lineKind,
  initialLines,
  onSave,
  onClose,
}: {
  title: string;
  fields: Field[];
  products?: Product[];
  lineKind?: 'purchase' | 'invoice' | 'transfer' | 'count';
  initialLines?: Row[];
  onSave: (v: Record<string, unknown>, key: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [lines, setLines] = useState(
      initialLines?.map((l) => ({
        productId: val(l, 'productId'),
        quantity: val(l, 'quantity'),
        unitCost: val(l, 'unitCost'),
        unitPrice: val(l, 'unitPrice'),
        counted: val(l, 'counted') || '0',
      })) ?? [{ productId: '', quantity: '1', unitCost: '', unitPrice: '', counted: '0' }],
    );
  const attempt = useRef<{ body: Record<string, unknown>; key: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (!uncertain) {
        const body: Record<string, unknown> = Object.fromEntries(new FormData(event.currentTarget));
        for (const f of fields) if (f.optional && body[f.name] === '') delete body[f.name];
        if (lineKind)
          body.lines = lines.map((l) => ({
            productId: l.productId,
            ...(lineKind === 'count'
              ? { counted: Number(l.counted), unitCost: l.unitCost }
              : {
                  quantity: Number(l.quantity),
                  ...(lineKind === 'purchase'
                    ? { unitCost: l.unitCost }
                    : lineKind === 'invoice'
                      ? { unitPrice: l.unitPrice }
                      : {}),
                }),
          }));
        attempt.current = { body, key: newOperationId() };
      }
      await onSave(attempt.current!.body, attempt.current!.key);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save.');
      setUncertain(e instanceof RequestError && e.uncertain);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel core-panel">
      <h2>{title}</h2>
      <form onSubmit={(e) => void submit(e)}>
        <fieldset disabled={busy || uncertain} style={{ border: 0, padding: 0 }}>
          <div className="form-grid">
            {fields.map((f) => (
              <label key={f.name}>
                {f.label}
                {f.options ? (
                  <select name={f.name} required={!f.optional} defaultValue={f.value ?? ''}>
                    <option value="">Select…</option>
                    {f.options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    name={f.name}
                    type={f.type ?? 'text'}
                    step={f.type === 'number' ? '0.001' : undefined}
                    min={f.type === 'number' ? '0' : undefined}
                    defaultValue={f.value ?? ''}
                    required={!f.optional}
                    maxLength={300}
                  />
                )}
              </label>
            ))}
          </div>
          {lineKind && (
            <>
              <h3>Items</h3>
              {lines.map((l, index) => (
                <div className="form-grid" key={index}>
                  <label>
                    Product
                    <select
                      required
                      value={l.productId}
                      onChange={(e) =>
                        setLines(
                          lines.map((v, i) =>
                            i === index ? { ...v, productId: e.target.value } : v,
                          ),
                        )
                      }
                    >
                      <option value="">Select…</option>
                      {products
                        ?.filter((p) => lineKind === 'invoice' || p.type === 'goods')
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} · {p.sku}
                          </option>
                        ))}
                    </select>
                  </label>
                  {(lineKind === 'count'
                    ? ['counted', 'unitCost']
                    : lineKind === 'purchase'
                      ? ['quantity', 'unitCost']
                      : lineKind === 'invoice'
                        ? ['quantity', 'unitPrice']
                        : ['quantity']
                  ).map((k) => (
                    <label key={k}>
                      {
                        {
                          quantity: 'Quantity',
                          unitCost: 'Unit cost (BIF)',
                          unitPrice: 'Unit price (BIF)',
                          counted: 'Counted quantity',
                        }[k]
                      }
                      <input
                        required
                        type="number"
                        min={k === 'quantity' ? '0.001' : '0'}
                        step={k === 'quantity' || k === 'counted' ? '0.001' : '1'}
                        value={l[k as keyof typeof l]}
                        onChange={(e) =>
                          setLines(
                            lines.map((v, i) => (i === index ? { ...v, [k]: e.target.value } : v)),
                          )
                        }
                      />
                    </label>
                  ))}
                  {lines.length > 1 && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setLines(lines.filter((_, i) => i !== index))}
                    >
                      Remove item
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  setLines([
                    ...lines,
                    { productId: '', quantity: '1', unitCost: '', unitPrice: '', counted: '0' },
                  ])
                }
              >
                Add item
              </button>
            </>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="notice warning">
            {error}
          </p>
        )}
        {uncertain && (
          <p>Connection interrupted. Retry the same operation to confirm its result.</p>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? 'Saving…' : uncertain ? 'Retry same operation' : 'Save'}
        </button>
        {!uncertain && (
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        )}
      </form>
    </section>
  );
}
export function CorePanel({
  context,
  section,
}: {
  context: Context;
  section: 'purchases' | 'invoices' | 'expenses' | 'inventory';
}) {
  const cache = useQueryClient(),
    [tab, setTab] = useState(
      section === 'purchases'
        ? can(context.role, 'supplier.read')
          ? 'suppliers'
          : 'purchases'
        : section === 'inventory'
          ? 'transfers'
          : section,
    ),
    [selected, setSelected] = useState(''),
    [form, setForm] = useState<{
      title: string;
      fields: Field[];
      path: string;
      lineKind?: 'purchase' | 'invoice' | 'transfer' | 'count';
      extra?: Record<string, unknown>;
      initialLines?: Row[];
    } | null>(null),
    [error, setError] = useState(''),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(''),
    [from, setFrom] = useState(today(context)),
    [to, setTo] = useState(today(context)),
    [categoryFilter, setCategoryFilter] = useState('');
  const partition = ['data', context.tenantId, context.businessId, context.branchId];
  const permission: Permission =
    tab === 'suppliers'
      ? 'supplier.read'
      : tab === 'purchases'
        ? 'purchase.read'
        : tab === 'payables'
          ? 'payable.manage'
          : tab === 'expenses'
            ? 'expense.read'
            : tab === 'transfers'
              ? 'stock.transfer'
              : tab === 'stock-counts'
                ? 'stock.count'
                : 'invoice.read';
  const module =
    section === 'purchases'
      ? tab === 'payables'
        ? 'accounting'
        : 'purchasing'
      : section === 'invoices'
        ? 'invoicing'
        : section === 'inventory'
          ? 'inventory'
          : 'accounting';
  const allowed =
    can(context.role, permission) &&
    (!context.industryId || hasEffectiveModule(context.industryId, module));
  const url =
    tab === 'expenses'
      ? `expenses?from=${from}&to=${to}${categoryFilter ? `&categoryId=${categoryFilter}` : ''}`
      : tab === 'suppliers'
        ? `suppliers?page=${page}&search=${encodeURIComponent(search)}`
        : tab === 'purchases'
          ? `purchases?page=${page}`
          : tab;
  const data = useQuery({
    queryKey: [...partition, 'core', url],
    queryFn: () => request<Rows>(`v1/${url}`, context),
    enabled: allowed,
  });
  const products = useQuery({
    queryKey: [...partition, 'core-products'],
    queryFn: () => request<{ items: Product[] }>('v1/products?limit=100', context),
    enabled: !!form?.lineKind,
  });
  const suppliers = useQuery({
    queryKey: [...partition, 'core-suppliers'],
    queryFn: () => request<Rows>('v1/suppliers', context),
    enabled: !!form && can(context.role, 'supplier.read'),
  });
  const customers = useQuery({
    queryKey: [...partition, 'core-customers'],
    queryFn: () => request<Rows>('v1/customers?limit=100', context),
    enabled: !!form && section === 'invoices',
  });
  const receiptChoices = useQuery({
    queryKey: [...partition, 'core-receipt-choices'],
    queryFn: () =>
      request<{
        items: { id: string; number: string; customerName: string | null; total: string }[];
      }>('v1/sales?limit=100', context),
    enabled: !!form?.fields.some((f) => f.name === 'saleId'),
  });
  const categories = useQuery({
    queryKey: [...partition, 'core-categories'],
    queryFn: () => request<Row[]>('v1/expense-categories', context),
    enabled: section === 'expenses' && allowed,
  });
  const contexts = useQuery({
    queryKey: [...partition, 'core-contexts'],
    queryFn: () => request<Context[]>('v1/contexts', context),
    enabled: tab === 'transfers' && allowed,
  });
  const detail = useQuery({
    queryKey: [...partition, 'core-detail', tab, selected],
    queryFn: () =>
      request<{
        order?: Row;
        invoice?: Row;
        supplier?: Row;
        lines?: Row[];
        receipts?: Row[];
        payments?: Row[];
        orders?: Row[];
        bills?: Row[];
        customer?: Row;
      }>(`v1/${tab}/${selected}`, context),
    enabled: !!selected && ['suppliers', 'purchases', 'invoices'].includes(tab) && allowed,
  });
  const actionAttempt = useRef<{ path: string; key: string } | null>(null),
    [busy, setBusy] = useState(false),
    [uncertainAction, setUncertainAction] = useState(false);
  async function action(path: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    if (!uncertainAction) actionAttempt.current = { path, key: newOperationId() };
    try {
      await request(
        `v1/${actionAttempt.current!.path}`,
        context,
        'POST',
        {},
        actionAttempt.current!.key,
      );
      setUncertainAction(false);
      await cache.invalidateQueries({ queryKey: partition });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed.');
      setUncertainAction(e instanceof RequestError && e.uncertain);
    } finally {
      setBusy(false);
    }
  }
  const btn = (label: string, path: string, p: Permission) =>
    can(context.role, p) && (
      <button
        disabled={busy || uncertainAction}
        className="text-button"
        onClick={() => void action(path)}
      >
        {label}
      </button>
    );
  const open = (
    title: string,
    path: string,
    fields: Field[],
    lineKind?: 'purchase' | 'invoice' | 'transfer' | 'count',
    extra?: Record<string, unknown>,
    initialLines?: Row[],
  ) => setForm({ title, path, fields, lineKind, extra, initialLines });
  const dateFields = [
    field('billDate', 'Bill date', 'date', today(context)),
    field('dueDate', 'Due date', 'date', today(context)),
  ];
  const settlement = (kind: 'bill' | 'invoice', r: Row) =>
    open(
      'Record confirmed payment',
      `${kind === 'bill' ? 'payables' : 'invoices'}/${r.id}/payments`,
      [
        field('amount', 'Amount (BIF)', 'number', outstanding(r)),
        moneyAccount,
        field('reference', 'Payment reference'),
      ],
    );
  if (!allowed)
    return (
      <section className="panel">
        <Empty
          title="Access unavailable"
          hint="Your role or business modules do not allow this page."
        />
      </section>
    );
  const tabs =
    section === 'purchases'
      ? [
          ...(can(context.role, 'supplier.read') ? ['suppliers'] : []),
          'purchases',
          ...(can(context.role, 'payable.manage') ? ['payables'] : []),
        ]
      : section === 'inventory'
        ? ['transfers', 'stock-counts']
        : [section];
  return (
    <section className="panel core-panel">
      <div className="panel-heading">
        <h2>
          {section === 'inventory'
            ? 'Inventory operations'
            : section === 'purchases'
              ? 'Purchasing'
              : section === 'invoices'
                ? 'Invoices & receivables'
                : 'Expenses'}
        </h2>
        <div className="segmented">
          {tabs.map((t) => (
            <button
              key={t}
              className={t === tab ? 'selected' : ''}
              onClick={() => {
                setTab(t);
                setSelected('');
                setPage(1);
                setForm(null);
              }}
            >
              {t === 'stock-counts' ? 'Stock counts' : t[0]!.toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <p className="muted">
        {context.businessName} · {context.branchName} · BIF
      </p>
      {tab === 'suppliers' && (
        <label>
          Find supplier
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
      )}
      {tab === 'expenses' && (
        <label>
          Category
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">All categories</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {val(c, 'name')}
              </option>
            ))}
          </select>
        </label>
      )}
      {tab === 'expenses' && (
        <div className="date-range">
          <label>
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      )}
      {tab === 'suppliers' && can(context.role, 'supplier.create') && (
        <button
          className="button primary"
          onClick={() =>
            open('New supplier', 'suppliers', [
              field('name', 'Supplier name'),
              ...['contact', 'phone', 'email', 'address', 'taxReference', 'notes'].map((k) => ({
                ...field(
                  k,
                  {
                    contact: 'Contact person',
                    phone: 'Phone',
                    email: 'Email',
                    address: 'Address',
                    taxReference: 'Tax / reference ID',
                    notes: 'Notes',
                  }[k]!,
                  k === 'email' ? 'email' : 'text',
                ),
                optional: true,
              })),
            ])
          }
        >
          New supplier
        </button>
      )}
      {tab === 'purchases' && can(context.role, 'purchase.create') && (
        <button
          className="button primary"
          onClick={() =>
            open(
              'New purchase order',
              'purchases',
              [
                options('supplierId', 'Supplier', suppliers.data?.items ?? []),
                field('orderDate', 'Order date', 'date', today(context)),
                { ...field('expectedDate', 'Expected delivery', 'date'), optional: true },
                { ...field('notes', 'Notes'), optional: true },
              ],
              'purchase',
            )
          }
        >
          New purchase order
        </button>
      )}
      {tab === 'expenses' && (
        <>
          {can(context.role, 'expense.create') && (
            <>
              <button
                className="button secondary"
                onClick={() =>
                  open('New expense category', 'expense-categories', [
                    field('name', 'Category name'),
                  ])
                }
              >
                New category
              </button>
              <button
                className="button primary"
                onClick={() =>
                  open('Record expense', 'expenses', [
                    options('categoryId', 'Category', categories.data ?? []),
                    field('expenseDate', 'Expense date', 'date', today(context)),
                    field('amount', 'Amount (BIF)', 'number'),
                    moneyAccount,
                    field('description', 'Description'),
                    { ...field('reference', 'Receipt / reference'), optional: true },
                  ])
                }
              >
                Record expense
              </button>
            </>
          )}
          <p>Posted expense total: {data.data?.total ?? '—'} BIF</p>
        </>
      )}
      {tab === 'invoices' && can(context.role, 'invoice.create') && (
        <>
          <button
            className="button primary"
            onClick={() =>
              open(
                'New customer invoice',
                'invoices',
                [
                  options('customerId', 'Customer', customers.data?.items ?? []),
                  field('invoiceDate', 'Invoice date', 'date', today(context)),
                  field('dueDate', 'Due date', 'date', today(context)),
                  { ...field('notes', 'Notes'), optional: true },
                ],
                'invoice',
              )
            }
          >
            New invoice
          </button>
          <button
            className="button secondary"
            onClick={() =>
              open('Invoice an existing paid sale', 'invoices', [
                options('customerId', 'Customer', customers.data?.items ?? []),
                field('saleId', 'Existing receipt'),
                field('invoiceDate', 'Invoice date', 'date', today(context)),
                field('dueDate', 'Due date', 'date', today(context)),
              ])
            }
          >
            Link paid receipt
          </button>
        </>
      )}
      {tab === 'transfers' && (
        <button
          className="button primary"
          onClick={() =>
            open(
              'New branch transfer',
              'transfers',
              [
                {
                  name: 'destinationId',
                  label: 'Destination branch',
                  options:
                    contexts.data
                      ?.filter(
                        (c) =>
                          c.businessId === context.businessId && c.branchId !== context.branchId,
                      )
                      .map((c) => ({ id: c.branchId, name: c.branchName })) ?? [],
                },
              ],
              'transfer',
            )
          }
        >
          New transfer
        </button>
      )}
      {tab === 'stock-counts' && (
        <button
          className="button primary"
          onClick={() =>
            open(
              'New physical stock count',
              'stock-counts',
              [field('notes', 'Reason / count notes')],
              'count',
            )
          }
        >
          New stock count
        </button>
      )}
      {error && (
        <p className="notice warning" role="alert">
          {error}
        </p>
      )}
      {uncertainAction && (
        <button className="button primary" onClick={() => void action(actionAttempt.current!.path)}>
          Retry same operation
        </button>
      )}
      {form && (
        <EntryForm
          key={form.path}
          title={form.title}
          fields={form.fields.map((f) =>
            f.name === 'saleId'
              ? {
                  name: f.name,
                  label: f.label,
                  options:
                    receiptChoices.data?.items.map((r) => ({
                      id: r.id,
                      name:
                        r.number + ' · ' + (r.customerName ?? 'Walk-in') + ' · ' + r.total + ' BIF',
                    })) ?? [],
                }
              : f.name === 'supplierId'
                ? { ...options(f.name, f.label, suppliers.data?.items ?? []), value: f.value }
                : f.name === 'customerId'
                  ? options(f.name, f.label, customers.data?.items ?? [])
                  : f,
          )}
          products={products.data?.items}
          lineKind={form.lineKind}
          initialLines={form.initialLines}
          onClose={() => setForm(null)}
          onSave={async (body, key) => {
            const payload = form.extra?.lineId
              ? { lines: [{ lineId: form.extra.lineId, quantity: Number(body.quantity) }] }
              : { ...body, ...form.extra };
            await request(`v1/${form.path}`, context, 'POST', payload, key);
            await cache.invalidateQueries({ queryKey: partition });
          }}
        />
      )}
      {data.isPending || data.isError ? (
        <State loading={data.isPending} error={data.error} retry={() => void data.refetch()} />
      ) : (
        <Grid
          rows={data.data.items}
          columns={
            tab === 'suppliers'
              ? [
                  ['name', 'Supplier'],
                  ['contact', 'Contact'],
                  ['phone', 'Phone'],
                  ['active', 'Active'],
                ]
              : tab === 'expenses'
                ? [
                    ['expenseDate', 'Date'],
                    ['description', 'Description'],
                    ['amount', 'Amount'],
                    ['displayStatus', 'Status'],
                  ]
                : tab === 'payables'
                  ? [
                      ['reference', 'Bill reference'],
                      ['supplierName', 'Supplier'],
                      ['displayStatus', 'Status'],
                      ['dueDate', 'Due date'],
                      ['total', 'Total'],
                      ['paid', 'Paid'],
                      ['balance', 'Outstanding'],
                    ]
                  : tab === 'invoices'
                    ? [
                        ['number', 'Invoice'],
                        ['dueDate', 'Due date'],
                        ['displayStatus', 'Status'],
                        ['total', 'Total'],
                        ['paid', 'Paid'],
                        ['balance', 'Outstanding'],
                      ]
                    : [
                        ['number', 'Reference'],
                        ['displayStatus', 'Status'],
                        ['total', 'Total'],
                      ]
          }
          actions={(r) => (
            <>
              {['suppliers', 'purchases', 'invoices'].includes(tab) && (
                <button className="text-button" onClick={() => setSelected(r.id)}>
                  View
                </button>
              )}
              {tab === 'suppliers' && can(context.role, 'supplier.update') && (
                <>
                  <button
                    className="text-button"
                    onClick={() =>
                      open(
                        'Edit supplier',
                        `suppliers/${r.id}`,
                        [
                          'name',
                          'contact',
                          'phone',
                          'email',
                          'address',
                          'taxReference',
                          'notes',
                        ].map((k) => ({
                          ...field(
                            k,
                            k === 'taxReference'
                              ? 'Tax / reference ID'
                              : k[0]!.toUpperCase() + k.slice(1),
                            'text',
                            val(r, k),
                          ),
                          optional: k !== 'name',
                        })),
                        undefined,
                        { active: r.active },
                      )
                    }
                  >
                    Edit
                  </button>
                  <button
                    className="text-button"
                    onClick={() =>
                      open(
                        r.active ? 'Deactivate supplier' : 'Reactivate supplier',
                        `suppliers/${r.id}`,
                        [field('name', 'Supplier name', 'text', val(r, 'name'))],
                        undefined,
                        {
                          ...r,
                          active: !r.active,
                          id: undefined,
                          tenantId: undefined,
                          businessId: undefined,
                          createdAt: undefined,
                          updatedAt: undefined,
                        },
                      )
                    }
                  >
                    {r.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </>
              )}
              {tab === 'purchases' && (
                <>
                  {r.status === 'draft' &&
                    btn('Order', `purchases/${r.id}/order`, 'purchase.approve')}
                  {['draft', 'ordered'].includes(val(r, 'status')) &&
                    btn('Cancel', `purchases/${r.id}/cancel`, 'purchase.approve')}
                </>
              )}
              {tab === 'payables' && outstanding(r) !== '0' && (
                <button className="text-button" onClick={() => settlement('bill', r)}>
                  Pay
                </button>
              )}
              {tab === 'expenses' &&
                r.status === 'posted' &&
                can(context.role, 'expense.reverse') && (
                  <button
                    className="text-button"
                    onClick={() =>
                      open('Reverse expense', `expenses/${r.id}/reverse`, [
                        field('reason', 'Reason for reversal'),
                      ])
                    }
                  >
                    Reverse
                  </button>
                )}
              {tab === 'invoices' && (
                <>
                  {r.status === 'draft' && (
                    <>
                      {btn('Issue', `invoices/${r.id}/issue`, 'invoice.issue')}
                      {btn('Void', `invoices/${r.id}/void`, 'invoice.issue')}
                    </>
                  )}
                  {r.status === 'issued' &&
                    outstanding(r) !== '0' &&
                    can(context.role, 'invoice.payment') && (
                      <button className="text-button" onClick={() => settlement('invoice', r)}>
                        Record payment
                      </button>
                    )}
                </>
              )}
              {tab === 'transfers' && (
                <>
                  {r.status === 'draft' &&
                    r.branchId === context.branchId &&
                    btn('Send', `transfers/${r.id}/send`, 'stock.transfer')}
                  {r.status === 'sent' &&
                    r.destinationId === context.branchId &&
                    btn('Receive', `transfers/${r.id}/receive`, 'stock.transfer')}
                </>
              )}
              {tab === 'stock-counts' &&
                r.status === 'draft' &&
                btn('Finalize', `stock-counts/${r.id}/finalize`, 'stock.count')}
            </>
          )}
        />
      )}
      {(tab === 'suppliers' || tab === 'purchases') && (
        <div>
          <button disabled={page === 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>{' '}
          Page {page}{' '}
          <button
            disabled={page * 30 >= Number(data.data?.total ?? 0)}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}
      {selected &&
        (detail.isPending || detail.isError ? (
          <State
            loading={detail.isPending}
            error={detail.error}
            retry={() => void detail.refetch()}
          />
        ) : (
          <section className="panel">
            <div className="panel-heading">
              <h3>
                {val(detail.data.order ?? detail.data.invoice ?? detail.data.supplier!, 'number') ||
                  val(detail.data.supplier!, 'name')}
              </h3>
              <button className="text-button" onClick={() => setSelected('')}>
                Close details
              </button>
              {tab === 'invoices' && (
                <button
                  className="text-button"
                  onClick={() =>
                    printCustomerInvoice(
                      context,
                      detail.data.invoice!,
                      detail.data.customer,
                      detail.data.lines ?? [],
                    )
                  }
                >
                  Print invoice
                </button>
              )}
            </div>
            {tab === 'purchases' &&
              detail.data.order?.status === 'draft' &&
              can(context.role, 'purchase.create') && (
                <button
                  className="button secondary"
                  onClick={() => {
                    const r = detail.data.order!;
                    open(
                      'Edit draft purchase',
                      `purchases/${selected}/update`,
                      [
                        {
                          ...options('supplierId', 'Supplier', suppliers.data?.items ?? []),
                          value: val(r, 'supplierId'),
                        },
                        field('orderDate', 'Order date', 'date', val(r, 'orderDate')),
                        {
                          ...field(
                            'expectedDate',
                            'Expected delivery',
                            'date',
                            val(r, 'expectedDate'),
                          ),
                          optional: true,
                        },
                        { ...field('notes', 'Notes', 'text', val(r, 'notes')), optional: true },
                      ],
                      'purchase',
                      undefined,
                      detail.data.lines,
                    );
                  }}
                >
                  Edit draft
                </button>
              )}
            {tab === 'purchases' &&
              ['ordered', 'partially_received'].includes(val(detail.data.order, 'status')) &&
              can(context.role, 'purchase.receive') && (
                <button
                  className="button primary"
                  onClick={() =>
                    open(
                      'Receive all remaining items',
                      `purchases/${selected}/receive`,
                      [],
                      undefined,
                      {
                        lines: detail.data.lines
                          ?.filter((l) => Number(l.quantity) > Number(l.received))
                          .map((l) => ({
                            lineId: l.id,
                            quantity: Number((Number(l.quantity) - Number(l.received)).toFixed(3)),
                          })),
                      },
                    )
                  }
                >
                  Receive all remaining
                </button>
              )}
            {detail.data.customer && <p>Customer: {val(detail.data.customer, 'name')}</p>}
            {detail.data.lines && (
              <Grid
                rows={detail.data.lines}
                columns={
                  tab === 'purchases'
                    ? [
                        ['productName', 'Product'],
                        ['quantity', 'Ordered'],
                        ['received', 'Received'],
                        ['unitCost', 'Unit cost'],
                      ]
                    : [
                        ['name', 'Item'],
                        ['quantity', 'Quantity'],
                        ['unitPrice', 'Price'],
                        ['total', 'Total'],
                      ]
                }
                actions={
                  tab === 'purchases'
                    ? (l) =>
                        can(context.role, 'purchase.receive') &&
                        Number(l.received) < Number(l.quantity) && (
                          <button
                            className="text-button"
                            onClick={() =>
                              open(
                                'Receive purchase item',
                                `purchases/${selected}/receive`,
                                [
                                  field(
                                    'quantity',
                                    'Receiving quantity',
                                    'number',
                                    String(Number(l.quantity) - Number(l.received)),
                                  ),
                                ],
                                undefined,
                                { lineId: l.id },
                              )
                            }
                          >
                            Receive item
                          </button>
                        )
                    : undefined
                }
              />
            )}
            {detail.data.receipts && (
              <>
                <h3>Goods receipts</h3>
                <Grid
                  rows={detail.data.receipts}
                  columns={[
                    ['number', 'Receipt'],
                    ['total', 'Value'],
                  ]}
                  actions={(r) =>
                    can(context.role, 'payable.manage') &&
                    Number(r.total) > 0 && (
                      <button
                        className="text-button"
                        onClick={() =>
                          open(
                            'Create supplier bill',
                            'payables',
                            [field('reference', 'Supplier invoice reference'), ...dateFields],
                            undefined,
                            { receiptId: r.id },
                          )
                        }
                      >
                        Create bill
                      </button>
                    )
                  }
                />
              </>
            )}
            {detail.data.orders && (
              <>
                <h3>Purchase history in this branch</h3>
                <Grid
                  rows={detail.data.orders}
                  columns={[
                    ['number', 'Order'],
                    ['status', 'Status'],
                    ['total', 'Total'],
                  ]}
                />
              </>
            )}
            {detail.data.bills && (
              <>
                <h3>Supplier bills in this branch</h3>
                <Grid
                  rows={detail.data.bills}
                  columns={[
                    ['reference', 'Bill'],
                    ['total', 'Total'],
                    ['paid', 'Paid'],
                    ['balance', 'Outstanding'],
                  ]}
                />
              </>
            )}
            {detail.data.payments && (
              <>
                <h3>Payment history</h3>
                <Grid
                  rows={detail.data.payments}
                  columns={[
                    ['createdAt', 'Date'],
                    ['amount', 'Amount'],
                    ['account', 'Account'],
                    ['reference', 'Reference'],
                  ]}
                />
              </>
            )}
          </section>
        ))}
      {data.data?.payments && (
        <>
          <h3>Payment history</h3>
          <Grid
            rows={data.data.payments}
            columns={[
              ['createdAt', 'Date'],
              ['amount', 'Amount'],
              ['reference', 'Reference'],
            ]}
          />
        </>
      )}
      {data.data?.lines && (
        <details>
          <summary>Item quantities and audit details</summary>
          <Grid
            rows={data.data.lines}
            columns={
              tab === 'stock-counts'
                ? [
                    ['productId', 'Product'],
                    ['expected', 'Expected'],
                    ['counted', 'Counted'],
                  ]
                : [
                    ['productId', 'Product'],
                    ['quantity', 'Quantity'],
                    ['value', 'Value'],
                  ]
            }
          />
        </details>
      )}
    </section>
  );
}

type Financial = {
  revenue: string;
  cogs: string;
  grossProfit: string;
  stockLoss: string;
  expenses: string;
  netOperatingProfit: string;
  cashMovement: string;
  bankMovement: string;
  inventoryValue: string;
  valuationPending: boolean;
  receivables: Row[];
  payables: Row[];
  productPerformance: Row[];
};
export function FinancialPanel({
  context,
  from,
  to,
}: {
  context: Context;
  from: string;
  to: string;
}) {
  const [showComparison, setShowComparison] = useState(false),
    [showBranches, setShowBranches] = useState(false);
  const validDates =
    Number.isFinite(Date.parse(from + 'T12:00:00Z')) &&
    Number.isFinite(Date.parse(to + 'T12:00:00Z')) &&
    from <= to;
  const duration = Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z') + 86400000;
  const previousFrom = new Date(
      validDates ? Date.parse(from + 'T12:00:00Z') - duration : Date.now(),
    )
      .toISOString()
      .slice(0, 10),
    previousTo = new Date(validDates ? Date.parse(from + 'T12:00:00Z') - 86400000 : Date.now())
      .toISOString()
      .slice(0, 10);
  const previous = useQuery({
    queryKey: [
      'data',
      context.tenantId,
      context.businessId,
      context.branchId,
      'previous-financial',
      previousFrom,
      previousTo,
    ],
    queryFn: () =>
      request<Financial>(`v1/reports/financial?from=${previousFrom}&to=${previousTo}`, context),
    enabled: validDates && showComparison && can(context.role, 'finance.read'),
  });
  const branches = useQuery({
    queryKey: [
      'data',
      context.tenantId,
      context.businessId,
      context.branchId,
      'branch-financial',
      from,
      to,
    ],
    queryFn: () => request<Rows>(`v1/reports/branches?from=${from}&to=${to}`, context),
    enabled: validDates && showBranches && can(context.role, 'finance.read'),
  });
  const data = useQuery({
    queryKey: [
      'data',
      context.tenantId,
      context.businessId,
      context.branchId,
      'financial',
      from,
      to,
    ],
    queryFn: () => request<Financial>(`v1/reports/financial?from=${from}&to=${to}`, context),
    enabled: can(context.role, 'finance.read'),
  });
  if (!can(context.role, 'finance.read')) return null;
  if (data.isPending || data.isError)
    return <State loading={data.isPending} error={data.error} retry={() => void data.refetch()} />;
  const d = data.data;
  return (
    <section className="panel core-panel">
      <h2>Financial overview · {context.branchName}</h2>
      <p>
        {from} — {to} · BIF · Posting date basis
      </p>
      {d.valuationPending && (
        <p className="notice warning">Provisional profit: some stock costs still need review.</p>
      )}
      <div className="form-grid">
        {[
          ['revenue', 'Net revenue'],
          ['cogs', 'Cost of goods sold'],
          ['grossProfit', 'Gross profit'],
          ['stockLoss', 'Stock losses / variances'],
          ['expenses', 'Operating expenses'],
          ['netOperatingProfit', 'Net operating profit'],
          ['cashMovement', 'Business cash movement'],
          ['bankMovement', 'Bank movement'],
          ['inventoryValue', 'Current inventory value'],
        ].map(([key, label]) => (
          <div className="settings-row" key={key}>
            <span>{label}</span>
            <b>{String(d[key as keyof Financial])} BIF</b>
          </div>
        ))}
      </div>
      <p className="muted">
        Cash movement is posted inflows less outflows for this period; it is not a bank balance or
        POS drawer balance. Receivables, payables and inventory show current balances.
      </p>
      <button className="button secondary" onClick={() => setShowComparison(!showComparison)}>
        Compare previous period
      </button>
      <button className="button secondary" onClick={() => setShowBranches(!showBranches)}>
        Branch performance
      </button>
      {showComparison &&
        (previous.isPending || previous.isError ? (
          <State
            loading={previous.isPending}
            error={previous.error}
            retry={() => void previous.refetch()}
          />
        ) : (
          <>
            <h3>
              Previous period · {previousFrom} — {previousTo}
            </h3>
            <Grid
              rows={[
                {
                  id: 'prior',
                  ...previous.data,
                  receivables: undefined,
                  payables: undefined,
                  productPerformance: undefined,
                },
              ]}
              columns={[
                ['revenue', 'Revenue'],
                ['grossProfit', 'Gross profit'],
                ['expenses', 'Expenses'],
                ['netOperatingProfit', 'Net operating profit'],
              ]}
            />
          </>
        ))}
      {showBranches &&
        (branches.isPending || branches.isError ? (
          <State
            loading={branches.isPending}
            error={branches.error}
            retry={() => void branches.refetch()}
          />
        ) : (
          <>
            <h3>Branches you can access</h3>
            <Grid
              rows={branches.data.items}
              columns={[
                ['branchName', 'Branch'],
                ['revenue', 'Revenue'],
                ['grossProfit', 'Gross profit'],
                ['expenses', 'Expenses'],
                ['netOperatingProfit', 'Net operating profit'],
              ]}
            />
          </>
        ))}
      <h3>Accounts receivable</h3>
      <Grid
        rows={d.receivables.filter((r) => outstanding(r) !== '0')}
        columns={[
          ['number', 'Invoice'],
          ['customerName', 'Customer'],
          ['dueDate', 'Due date'],
          ['total', 'Total'],
          ['paid', 'Paid'],
          ['balance', 'Outstanding'],
        ]}
      />
      <h3>Accounts payable</h3>
      <Grid
        rows={d.payables.filter((r) => outstanding(r) !== '0')}
        columns={[
          ['reference', 'Bill'],
          ['supplierName', 'Supplier'],
          ['dueDate', 'Due date'],
          ['total', 'Total'],
          ['paid', 'Paid'],
          ['balance', 'Outstanding'],
        ]}
      />
      <h3>Product performance</h3>
      <Grid
        rows={d.productPerformance.map((r) => ({ ...r, id: val(r, 'productId') }))}
        columns={[
          ['productName', 'Product'],
          ['quantity', 'Sold'],
          ['revenue', 'Revenue'],
          ['cost', 'COGS'],
          ['grossProfit', 'Gross profit'],
        ]}
      />
    </section>
  );
}

export function FocusedWorkspace({
  context,
  navigate,
}: {
  context: Context;
  navigate: (page: 'sell' | 'products' | 'purchases' | 'customers' | 'sales') => void;
}) {
  const data = useQuery({
    queryKey: ['data', context.tenantId, context.businessId, context.branchId, 'focused-workspace'],
    queryFn: () =>
      request<{
        register: { status: string } | null;
        salesToday?: number;
        revenueToday?: string;
        lowStock?: Row[];
        pendingOrders?: number;
        pendingCounts?: number;
      }>('v1/workspace', context),
  });
  return (
    <section className="panel core-panel">
      <h1>
        {context.role === 'cashier'
          ? 'Cashier workspace'
          : context.role === 'purchasing'
            ? 'Purchasing workspace'
            : 'Inventory workspace'}
      </h1>
      <p>
        {context.businessName} · {context.branchName}
      </p>
      {data.isPending || data.isError ? (
        <State loading={data.isPending} error={data.error} retry={() => void data.refetch()} />
      ) : context.role === 'cashier' ? (
        <>
          <p>
            Register: {data.data.register?.status ?? 'Open your register in POS'} · Your sales
            today: {data.data.salesToday} · {data.data.revenueToday} BIF
          </p>
          <button className="button primary" onClick={() => navigate('sell')}>
            Open register / new sale
          </button>
          <button className="button secondary" onClick={() => navigate('sales')}>
            Recent receipts
          </button>
          <button className="button secondary" onClick={() => navigate('customers')}>
            Customers
          </button>
        </>
      ) : (
        <>
          <p>
            Pending purchase receipts: {data.data.pendingOrders} · Draft stock counts:{' '}
            {data.data.pendingCounts}
          </p>
          <h3>Low-stock items</h3>
          <Grid
            rows={data.data.lowStock ?? []}
            columns={[
              ['name', 'Product'],
              ['onHand', 'Available'],
            ]}
          />
          <button className="button primary" onClick={() => navigate('products')}>
            Inventory operations
          </button>
          <button className="button secondary" onClick={() => navigate('purchases')}>
            Purchasing / receiving
          </button>
        </>
      )}
    </section>
  );
}

export function CustomerAccountPanel({
  context,
  id,
  onClose,
}: {
  context: Context;
  id: string;
  onClose: () => void;
}) {
  const data = useQuery({
    queryKey: [
      'data',
      context.tenantId,
      context.businessId,
      context.branchId,
      'customer-balance',
      id,
    ],
    queryFn: () =>
      request<{ customer: Row; invoices: Row[]; payments: Row[]; balance: string }>(
        `v1/customers/${id}/balance`,
        context,
      ),
  });
  return (
    <section className="panel core-panel">
      <div className="panel-heading">
        <h2>Customer account</h2>
        <button className="text-button" onClick={onClose}>
          Close
        </button>
      </div>
      {data.isPending || data.isError ? (
        <State loading={data.isPending} error={data.error} retry={() => void data.refetch()} />
      ) : (
        <>
          <p>
            {val(data.data.customer, 'name')} · Outstanding: {data.data.balance} BIF
          </p>
          <Grid
            rows={data.data.invoices}
            columns={[
              ['number', 'Invoice'],
              ['dueDate', 'Due date'],
              ['total', 'Amount'],
              ['paid', 'Paid'],
              ['balance', 'Outstanding'],
            ]}
          />
          <h3>Payments</h3>
          <Grid
            rows={data.data.payments}
            columns={[
              ['createdAt', 'Date'],
              ['amount', 'Amount'],
              ['reference', 'Reference'],
            ]}
          />
        </>
      )}
    </section>
  );
}

function printCustomerInvoice(
  context: Context,
  invoice: Row,
  customer: Row | undefined,
  lines: Row[],
) {
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.append(frame);
  const doc = frame.contentDocument!;
  doc.title = 'Invoice ' + val(invoice, 'number');
  const add = (tag: string, text: string) => {
    const element = doc.createElement(tag);
    element.textContent = text;
    doc.body.append(element);
  };
  add('h1', context.businessName);
  add('h2', 'Invoice ' + val(invoice, 'number'));
  add('p', context.branchName + ' · ' + context.currency);
  add('p', 'Customer: ' + val(customer, 'name'));
  add('p', 'Invoice date: ' + val(invoice, 'invoiceDate') + ' · Due: ' + val(invoice, 'dueDate'));
  add(
    'p',
    'Status: ' + val(invoice, 'status') + (invoice.saleId ? ' · Linked to a paid POS sale' : ''),
  );
  const table = doc.createElement('table');
  table.style.width = '100%';
  const header = doc.createElement('tr');
  for (const title of ['Item', 'Quantity', 'Unit price', 'Total']) {
    const cell = doc.createElement('th');
    cell.textContent = title;
    header.append(cell);
  }
  table.append(header);
  for (const line of lines) {
    const row = doc.createElement('tr');
    for (const k of ['name', 'quantity', 'unitPrice', 'total']) {
      const cell = doc.createElement('td');
      cell.textContent = val(line, k);
      cell.style.padding = '8px';
      row.append(cell);
    }
    table.append(row);
  }
  doc.body.append(table);
  add('p', 'Total: ' + val(invoice, 'total') + ' BIF');
  add('p', 'Paid: ' + val(invoice, 'paid') + ' BIF');
  add('p', 'Outstanding: ' + outstanding(invoice) + ' BIF');
  add('p', val(invoice, 'notes'));
  frame.contentWindow!.onafterprint = () => frame.remove();
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
}
