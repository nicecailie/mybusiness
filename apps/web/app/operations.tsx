'use client';
import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Context, Product, CashSession } from '../../../packages/contracts/src/index';
import { hasEffectiveModule } from '../../../packages/domain/src/industries';
import { can } from '../../../packages/domain/src/index';
import { operationsMessages, type Locale } from '../../../packages/i18n/src/index';
import { request, useWrite, ErrorText } from './ui';
type Props = { context: Context; locale: Locale };
type Line = {
  productId: string;
  quantity: number;
  kind: 'food' | 'drink';
  notes?: string;
  name?: string;
};
type Order = {
  id: string;
  tableId?: string;
  saleId?: string;
  table?: string;
  status: string;
  total?: string;
  lines: Line[];
};
type Stay = {
  id: string;
  roomId: string;
  guest: string;
  status: string;
  checkIn: string;
  checkOut: string;
  total: string;
  deposit: string;
  balance: string | null;
  billTotal?: string;
  paid?: string;
};
type Room = { id: string; name: string; status: string; rate?: string };
type Board = { rooms: Room[]; stays: Stay[]; customers: { id: string; name: string }[] };
const field = (label: string, input: ReactNode) => (
  <label className="field">
    <span>{label}</span>
    {input}
  </label>
);
const get = (f: FormData, name: string) => String(f.get(name) ?? '');
const bif = (v: string | undefined) =>
  v === undefined ? '' : new Intl.NumberFormat().format(BigInt(v)) + ' BIF';
function useOperations(context: Context, operation: string, onSuccess?: () => void) {
  const q = useQueryClient();
  const partition = ['data', context.tenantId, context.businessId, context.branchId];
  const w = useWrite(
    context,
    () => {
      void q.invalidateQueries({ queryKey: partition });
      onSuccess?.();
    },
    operation,
  );
  return { ...w, partition };
}
function Feedback({
  w,
  t,
}: {
  w: ReturnType<typeof useOperations>;
  t: (typeof operationsMessages)[Locale];
}) {
  return (
    <>
      <ErrorText error={w.error} />
      {w.uncertain && (
        <button className="button secondary" disabled={w.busy} onClick={() => void w.retry()}>
          {t.retry}
        </button>
      )}
    </>
  );
}
export function RestaurantWorkspace({
  context,
  locale,
  kitchen = false,
  onReceipt,
  onOpenRegister,
}: Props & { kitchen?: boolean; onReceipt?: (id: string) => void; onOpenRegister?: () => void }) {
  const t = operationsMessages[locale],
    w = useOperations(context, 'restaurant-operations');
  const [table, setTable] = useState(''),
    [cart, setCart] = useState<Line[]>([]),
    [append, setAppend] = useState('');
  const board = useQuery({
    queryKey: [...w.partition, kitchen ? 'kitchen' : 'orders'],
    queryFn: () =>
      request<{
        orders: Order[];
        tables?: { id: string; name: string; active?: boolean }[];
        waiting?: number;
        preparing?: number;
        ready?: number;
        topMenu?: { name: string; quantity: number }[];
      }>(kitchen ? 'v1/restaurant/kitchen' : 'v1/restaurant', context),
    refetchInterval: 5000,
  });
  const products = useQuery({
    queryKey: [...w.partition, 'menu-products'],
    queryFn: () => request<{ items: Product[] }>('v1/products?limit=100', context),
    enabled: !kitchen && can(context.role, 'restaurant.order'),
  });
  const cash = useQuery({
    queryKey: [...w.partition, 'cash-session'],
    queryFn: () => request<CashSession | null>('v1/cash-session', context),
    enabled: !kitchen && can(context.role, 'cash.manage'),
  });
  const hotel = useQuery({
    queryKey: [...w.partition, 'guest-charge-options'],
    queryFn: () => request<Board>('v1/restaurant/charge-guests', context),
    enabled:
      !kitchen &&
      can(context.role, 'restaurant.pay') &&
      hasEffectiveModule(context.industryId, 'accommodation'),
  });
  const status = (o: Order, s: string) =>
    void w.submit(`v1/restaurant/orders/${o.id}/status`, { status: s });
  return (
    <>
      <h1>{kitchen ? t.kitchen : t.orders}</h1>
      <Feedback w={w} t={t} />
      {board.isPending ? (
        <p>{t.loading}</p>
      ) : board.isError ? (
        <button onClick={() => void board.refetch()}>{t.failed}</button>
      ) : (
        <>
          {!kitchen &&
            can(context.role, 'cash.manage') &&
            !cash.isPending &&
            !cash.data &&
            onOpenRegister && (
              <button className="button primary" onClick={onOpenRegister}>
                {t.openRegister}
              </button>
            )}
          {!kitchen && (
            <div className="workspace-cards">
              <p>
                {t.new}: {board.data.waiting ?? 0} · {t.preparing}: {board.data.preparing ?? 0} ·{' '}
                {t.ready}: {board.data.ready ?? 0}
              </p>
              {board.data.tables?.map((x) => (
                <button
                  className="button secondary"
                  key={x.id}
                  onClick={() => {
                    setTable(x.id);
                    setAppend(
                      board.data.orders.find(
                        (o) => o.tableId === x.id && !['paid', 'cancelled'].includes(o.status),
                      )?.id ?? '',
                    );
                  }}
                >
                  {x.name} · {x.active ? t.in_use : t.available}
                </button>
              ))}
              {board.data.topMenu?.map((x) => (
                <p key={x.name}>
                  {x.name} · {x.quantity}
                </p>
              ))}
            </div>
          )}
          {!kitchen && can(context.role, 'restaurant.order') && (
            <section className="panel operation-entry">
              <h2>{t.send}</h2>
              <fieldset disabled={w.busy || w.uncertain}>
                {field(
                  t.table,
                  <select
                    value={table}
                    onChange={(e) => {
                      setTable(e.target.value);
                      setAppend(
                        board.data?.orders.find(
                          (o) =>
                            o.tableId === e.target.value &&
                            !['paid', 'cancelled'].includes(o.status),
                        )?.id ?? '',
                      );
                    }}
                  >
                    <option value="">{t.counter}</option>
                    {board.data.tables?.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>,
                )}
                {field(
                  t.orders,
                  <select value={append} onChange={(e) => setAppend(e.target.value)}>
                    <option value="">{t.new}</option>
                    {board.data.orders
                      .filter(
                        (o) =>
                          o.tableId === (table || undefined) &&
                          !['paid', 'cancelled'].includes(o.status),
                      )
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.id.slice(0, 8)} · {t[o.status as 'new'] ?? o.status}
                        </option>
                      ))}
                  </select>,
                )}
                <div className="operation-items">
                  {products.data?.items.map((p) => (
                    <button
                      className="button secondary"
                      key={p.id}
                      onClick={() =>
                        setCart((c) => {
                          const l = c.find((l) => l.productId === p.id);
                          return l
                            ? c.map((x) => (x === l ? { ...x, quantity: x.quantity + 1 } : x))
                            : [...c, { productId: p.id, quantity: 1, kind: 'food', name: p.name }];
                        })
                      }
                    >
                      {p.name} · {bif(p.price)}
                    </button>
                  ))}
                </div>
                {cart.map((l) => (
                  <div className="operation-line" key={l.productId}>
                    <span>{l.name}</span>
                    <input
                      aria-label={t.quantity}
                      type="number"
                      min="0.001"
                      max="1000000"
                      step="0.001"
                      value={l.quantity}
                      onChange={(e) =>
                        setCart((c) =>
                          c.map((x) => (x === l ? { ...x, quantity: Number(e.target.value) } : x)),
                        )
                      }
                    />
                    <select
                      aria-label={t.item}
                      value={l.kind}
                      onChange={(e) =>
                        setCart((c) =>
                          c.map((x) => (x === l ? { ...x, kind: e.target.value as 'food' } : x)),
                        )
                      }
                    >
                      <option value="food">{t.food}</option>
                      <option value="drink">{t.drink}</option>
                    </select>
                    <input
                      aria-label={t.notes}
                      placeholder={t.notes}
                      maxLength={300}
                      value={l.notes ?? ''}
                      onChange={(e) =>
                        setCart((c) =>
                          c.map((x) => (x === l ? { ...x, notes: e.target.value } : x)),
                        )
                      }
                    />
                    <button onClick={() => setCart((c) => c.filter((x) => x !== l))}>
                      {t.remove}
                    </button>
                  </div>
                ))}
                <button
                  className="button primary"
                  disabled={!cart.length}
                  onClick={() =>
                    void w
                      .submit(
                        append ? `v1/restaurant/orders/${append}/items` : 'v1/restaurant/orders',
                        {
                          ...(table && !append ? { tableId: table } : {}),
                          lines: cart.map(({ productId, quantity, kind, notes }) => ({
                            productId,
                            quantity,
                            kind,
                            notes,
                          })),
                        },
                      )
                      .then((ok) => {
                        if (ok) setCart([]);
                      })
                  }
                >
                  {t.send}
                </button>
              </fieldset>
            </section>
          )}
          <div className="operation-grid">
            {board.data.orders.map((o) => (
              <section className="panel operation-card" key={o.id}>
                <h2>
                  {kitchen
                    ? (o.table ?? t.counter)
                    : (board.data.tables?.find((x) => x.id === o.tableId)?.name ?? t.counter)}{' '}
                  · {o.id.slice(0, 8)}
                </h2>
                <p className="badge">{t[o.status as 'new'] ?? o.status}</p>
                <ul>
                  {o.lines.map((l, i) => (
                    <li key={i}>
                      {l.quantity} × {l.name} {l.notes && <small> · {l.notes}</small>}
                    </li>
                  ))}
                </ul>
                {!kitchen && <p>{bif(o.total)}</p>}
                {!kitchen && o.saleId && can(context.role, 'sale.read') && onReceipt && (
                  <button className="button secondary" onClick={() => onReceipt(o.saleId!)}>
                    {t.receipt}
                  </button>
                )}
                <fieldset disabled={w.busy || w.uncertain}>
                  {can(context.role, 'restaurant.prepare') && o.status === 'new' && (
                    <button className="button primary" onClick={() => status(o, 'preparing')}>
                      {t.start}
                    </button>
                  )}
                  {can(context.role, 'restaurant.prepare') &&
                    (o.status === 'preparing' ||
                      (o.status === 'new' && !o.tableId && !o.table)) && (
                      <button className="button primary" onClick={() => status(o, 'ready')}>
                        {t.markReady}
                      </button>
                    )}
                  {!kitchen && can(context.role, 'restaurant.order') && o.status === 'ready' && (
                    <button className="button primary" onClick={() => status(o, 'served')}>
                      {t.serve}
                    </button>
                  )}
                  {!kitchen &&
                    can(context.role, 'restaurant.order') &&
                    !['paid', 'cancelled'].includes(o.status) && (
                      <button className="button secondary" onClick={() => status(o, 'cancelled')}>
                        {t.cancel}
                      </button>
                    )}
                  {!kitchen &&
                    can(context.role, 'restaurant.pay') &&
                    ['ready', 'served'].includes(o.status) && (
                      <>
                        {cash.data && (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const f = new FormData(e.currentTarget);
                              void w.submit(`v1/restaurant/orders/${o.id}/pay`, {
                                cashSessionId: cash.data!.id,
                                tendered: get(f, 'tendered'),
                                payment: { method: 'cash' },
                              });
                            }}
                          >
                            {field(
                              t.tendered,
                              <input
                                name="tendered"
                                inputMode="numeric"
                                pattern="[0-9]+"
                                required
                                defaultValue={o.total}
                              />,
                            )}
                            <button className="button primary">{t.pay}</button>
                          </form>
                        )}
                        {!!hotel.data?.stays.some((s) => s.status === 'in_use') && (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              void w.submit(`v1/restaurant/orders/${o.id}/room-charge`, {
                                stayId: get(new FormData(e.currentTarget), 'stayId'),
                              });
                            }}
                          >
                            {field(
                              t.guest,
                              <select name="stayId" required>
                                {hotel.data.stays
                                  .filter((s) => s.status === 'in_use')
                                  .map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.guest} ·{' '}
                                      {hotel.data.rooms.find((r) => r.id === s.roomId)?.name}
                                    </option>
                                  ))}
                              </select>,
                            )}
                            <button className="button secondary">{t.chargeRoom}</button>
                          </form>
                        )}
                      </>
                    )}
                </fieldset>
              </section>
            ))}
          </div>
          {board.data.orders.length === 0 && <p>{t.empty}</p>}
        </>
      )}
    </>
  );
}
export function HotelWorkspace({
  context,
  locale,
  cleaning = false,
}: Props & { cleaning?: boolean }) {
  const [selected, setSelected] = useState(''),
    [checkout, setCheckout] = useState(''),
    [guestChoice, setGuestChoice] = useState(''),
    [billId, setBillId] = useState('');
  const t = operationsMessages[locale],
    w = useOperations(context, 'hotel-operations', () => {
      setSelected('');
      setCheckout('');
    });
  const bill = useQuery({
    queryKey: [...w.partition, 'stay-bill', checkout || billId],
    queryFn: () =>
      request<{
        estimatedTotal: string;
        deposit: string;
        invoice: { number: string; total: string; paid: string; balance: string } | null;
        lines: { name: string; quantity: number; total: string }[];
        deposits: { kind: string; amount: string; reference: string }[];
        extras: { name: string; amount: string }[];
        restaurantCharges: {
          id: string;
          total: string;
          lines: { name: string; quantity: number; total: string }[];
        }[];
      }>(`v1/accommodation/stays/${checkout || billId}/bill`, context),
    enabled: !cleaning && !!(checkout || billId),
  });
  const board = useQuery({
    queryKey: [...w.partition, cleaning ? 'housekeeping' : 'hotel'],
    queryFn: () =>
      request<Board>(cleaning ? 'v1/accommodation/housekeeping' : 'v1/accommodation', context),
    refetchInterval: 10000,
  });
  const paymentFields = (required = false) => (
    <>
      {field(
        t.tendered,
        <input name="amount" inputMode="numeric" pattern="[0-9]+" required={required} />,
      )}
      {field(
        t.cash,
        <select name="account">
          <option value="1000 Cash">{t.cash}</option>
          <option value="1010 Bank">{t.bank}</option>
        </select>,
      )}
      {field(t.reference, <input name="reference" maxLength={200} required={required} />)}
    </>
  );
  return (
    <>
      <h1>{cleaning ? t.housekeeping : t.rooms}</h1>
      <Feedback w={w} t={t} />
      {board.isPending ? (
        <p>{t.loading}</p>
      ) : board.isError ? (
        <button onClick={() => void board.refetch()}>{t.failed}</button>
      ) : (
        <>
          <div className="operation-grid">
            {board.data.rooms.map((r) => (
              <section className="panel operation-card" data-status={r.status} key={r.id}>
                <h2>{r.name}</h2>
                <p className="badge">{t[r.status as 'available'] ?? r.status}</p>
                {!cleaning && (
                  <p>
                    {bif(r.rate)} / {t.nights}
                  </p>
                )}
                <fieldset disabled={w.busy || w.uncertain}>
                  {!cleaning && can(context.role, 'hotel.book') && r.status !== 'under_repair' && (
                    <button className="button primary" onClick={() => setSelected(r.id)}>
                      {t.book}
                    </button>
                  )}
                  {can(context.role, 'hotel.clean') &&
                    ['needs_cleaning', 'cleaning'].includes(r.status) && (
                      <button
                        className="button primary"
                        onClick={() =>
                          void w.submit(`v1/accommodation/rooms/${r.id}/clean`, {
                            status: r.status === 'needs_cleaning' ? 'cleaning' : 'available',
                          })
                        }
                      >
                        {r.status === 'cleaning' ? t.done : t.start}
                      </button>
                    )}
                  {!cleaning && can(context.role, 'business.manage') && r.status !== 'in_use' && (
                    <button
                      className="button secondary"
                      onClick={() =>
                        void w.submit(`v1/accommodation/rooms/${r.id}/repair`, {
                          repair: r.status !== 'under_repair',
                        })
                      }
                    >
                      {r.status === 'under_repair' ? t.release : t.repair}
                    </button>
                  )}
                </fieldset>
              </section>
            ))}
          </div>
          {!cleaning && selected && (
            <section className="panel operation-entry">
              <h2>
                {t.book} · {board.data.rooms.find((r) => r.id === selected)?.name}
              </h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void w.submit('v1/accommodation/stays', {
                    roomId: selected,
                    ...(guestChoice
                      ? { customerId: guestChoice }
                      : { guest: { name: get(f, 'guest'), phone: get(f, 'phone') } }),
                    guestCount: Number(get(f, 'guests')),
                    checkIn: get(f, 'checkIn'),
                    checkOut: get(f, 'checkOut'),
                    ...(get(f, 'amount')
                      ? {
                          deposit: {
                            amount: get(f, 'amount'),
                            account: get(f, 'account'),
                            reference: get(f, 'reference') || t.deposit,
                          },
                        }
                      : {}),
                  });
                }}
              >
                <fieldset disabled={w.busy || w.uncertain}>
                  {field(
                    t.chooseGuest,
                    <select value={guestChoice} onChange={(e) => setGuestChoice(e.target.value)}>
                      <option value="">{t.newGuest}</option>
                      {board.data.customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>,
                  )}
                  {!guestChoice &&
                    field(t.guest, <input name="guest" required minLength={2} maxLength={160} />)}
                  {field('☎', <input name="phone" maxLength={80} />)}
                  {field(
                    t.guests,
                    <input
                      name="guests"
                      type="number"
                      min={1}
                      max={100}
                      defaultValue={1}
                      required
                    />,
                  )}
                  {field(t.checkIn, <input name="checkIn" type="date" required />)}
                  {field(t.checkOut, <input name="checkOut" type="date" required />)}
                  <h3>
                    {t.deposit} · {t.optional}
                  </h3>
                  {paymentFields()}
                  <button className="button primary">{t.book}</button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setSelected('')}
                  >
                    {t.cancel}
                  </button>
                </fieldset>
              </form>
            </section>
          )}
          {!cleaning && (
            <section>
              <h2>{t.history}</h2>
              <div className="operation-grid">
                {board.data.stays.map((s) => (
                  <section className="panel operation-card" key={s.id}>
                    <h3>
                      {s.guest} · {board.data.rooms.find((r) => r.id === s.roomId)?.name}
                    </h3>
                    <p>
                      {s.checkIn} → {s.checkOut}
                    </p>
                    <p className="badge">{t[s.status as 'reserved'] ?? s.status}</p>
                    <p>
                      {t.total}: {bif(s.billTotal ?? s.total)} · {t.deposit}: {bif(s.deposit)}
                    </p>
                    {s.balance !== null && (
                      <p>
                        {t.balance}: {bif(s.balance)}
                      </p>
                    )}
                    <fieldset disabled={w.busy || w.uncertain}>
                      <button className="button secondary" onClick={() => setBillId(s.id)}>
                        {t.bill}
                      </button>
                      {s.status === 'reserved' && can(context.role, 'hotel.book') && (
                        <details>
                          <summary>{t.deposit}</summary>
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const f = new FormData(e.currentTarget);
                              void w.submit(`v1/accommodation/stays/${s.id}/deposit`, {
                                amount: get(f, 'amount'),
                                account: get(f, 'account'),
                                reference: get(f, 'reference'),
                              });
                            }}
                          >
                            {paymentFields(true)}
                            <button className="button primary">{t.deposit}</button>
                          </form>
                        </details>
                      )}
                      {s.status === 'reserved' && can(context.role, 'hotel.book') && (
                        <>
                          {(['check_in', 'cancelled', 'no_show'] as const).map((action, i) => (
                            <button
                              className={'button ' + (i ? 'secondary' : '')}
                              key={action}
                              onClick={() =>
                                void w.submit(`v1/accommodation/stays/${s.id}/action`, { action })
                              }
                            >
                              {[t.checkIn, t.cancel, t.noShow][i]}
                            </button>
                          ))}
                        </>
                      )}
                      {s.status === 'in_use' && can(context.role, 'hotel.checkout') && (
                        <button className="button primary" onClick={() => setCheckout(s.id)}>
                          {t.checkOut}
                        </button>
                      )}
                      {s.status === 'checked_out' &&
                        s.balance &&
                        BigInt(s.balance) > 0n &&
                        can(context.role, 'hotel.checkout') && (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const f = new FormData(e.currentTarget);
                              void w.submit(`v1/accommodation/stays/${s.id}/payment`, {
                                amount: get(f, 'amount'),
                                account: get(f, 'account'),
                                reference: get(f, 'reference'),
                              });
                            }}
                          >
                            {paymentFields(true)}
                            <button className="button primary">{t.payBalance}</button>
                          </form>
                        )}
                    </fieldset>
                  </section>
                ))}
              </div>
            </section>
          )}
          {!cleaning && bill.data && (checkout || billId) && (
            <section className="panel operation-entry">
              <h2>
                {t.bill} {bill.data.invoice?.number}
              </h2>
              <p>
                {t.total}: {bif(bill.data.invoice?.total ?? bill.data.estimatedTotal)} · {t.deposit}
                : {bif(bill.data.deposit)}
              </p>
              {bill.data.lines.map((l, i) => (
                <p key={i}>
                  {l.quantity} × {l.name} · {bif(l.total)}
                </p>
              ))}
              {bill.data.extras.map((e, i) => (
                <p key={'extra-' + i}>
                  {e.name} · {bif(e.amount)}
                </p>
              ))}
              {bill.data.restaurantCharges.map((o) => (
                <div key={o.id}>
                  <p>
                    {t.chargeRoom} · {o.id.slice(0, 8)} · {bif(o.total)}
                  </p>
                  {o.lines.map((l, i) => (
                    <p key={i}>
                      {l.quantity} × {l.name} · {bif(l.total)}
                    </p>
                  ))}
                </div>
              ))}
              {bill.data.deposits.map((d, i) => (
                <p key={i}>
                  {t[d.kind as 'received']} · {bif(d.amount)} · {d.reference}
                </p>
              ))}
            </section>
          )}
          {!cleaning && checkout && (
            <section className="panel operation-entry">
              <h2>
                {t.checkOut} · {board.data.stays.find((s) => s.id === checkout)?.guest}
              </h2>
              <p>{t.checkoutHint}</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void w.submit(`v1/accommodation/stays/${checkout}/checkout`, {
                    extras: get(f, 'extraAmount')
                      ? [{ name: get(f, 'extraName'), amount: get(f, 'extraAmount') }]
                      : [],
                    ...(get(f, 'amount')
                      ? {
                          payment: {
                            amount: get(f, 'amount'),
                            account: get(f, 'account'),
                            reference: get(f, 'reference') || t.checkOut,
                          },
                        }
                      : {}),
                  });
                }}
              >
                <fieldset disabled={w.busy || w.uncertain}>
                  {field(t.extraName, <input name="extraName" maxLength={100} />)}
                  {field(
                    t.extraAmount,
                    <input name="extraAmount" inputMode="numeric" pattern="[0-9]+" />,
                  )}
                  {paymentFields()}
                  <button className="button primary">{t.checkOut}</button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setCheckout('')}
                  >
                    {t.cancel}
                  </button>
                </fieldset>
              </form>
            </section>
          )}
        </>
      )}
    </>
  );
}
export function RetailTools({
  context,
  locale,
  navigate,
}: Props & { navigate: (page: 'purchases') => void }) {
  const t = operationsMessages[locale],
    w = useOperations(context, 'retail-tools'),
    [product, setProduct] = useState(''),
    [rows, setRows] = useState([
      { label: '', sku: '', barcode: '', price: '', cost: '', quantity: '', expiresOn: '' },
    ]),
    [ingredients, setIngredients] = useState([{ productId: '', quantity: 1 }]);
  const products = useQuery({
    queryKey: [...w.partition, 'retail-products'],
    queryFn: () => request<{ items: Product[] }>('v1/products?limit=100', context),
  });
  const expiry = useQuery({
    queryKey: [...w.partition, 'expiry'],
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
    <section className="panel operation-entry">
      <Feedback w={w} t={t} />
      {can(context.role, 'stock.receive') && (
        <>
          <h2>{t.batches}</h2>
          {expiry.data?.items.map((l) => (
            <p key={l.id}>
              <strong>{t[l.status]}</strong> · {l.name} · {l.quantity} · {l.expiresOn}
            </p>
          ))}
        </>
      )}
      {can(context.role, 'purchase.create') && (
        <div className="operation-items">
          {products.data?.items
            .filter((p) => p.type === 'goods' && p.onHand <= p.lowStock)
            .map((p) => (
              <button
                className="button secondary"
                key={p.id}
                onClick={() => {
                  navigate('purchases');
                  window.history.replaceState(null, '', `?page=purchases&reorder=${p.id}`);
                }}
              >
                {t.reorder} · {p.name}
              </button>
            ))}
        </div>
      )}
      {can(context.role, 'catalog.write') && (
        <>
          <h2>
            {t.variants} / {t.recipe}
          </h2>
          {field(
            t.item,
            <select
              value={product}
              onChange={(e) => {
                setProduct(e.target.value);
                setIngredients(
                  products.data?.items.find((p) => p.id === e.target.value)?.recipe ?? [],
                );
              }}
            >
              <option value="">{t.choose}</option>
              {products.data?.items
                .filter((p) => !p.parentId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>,
          )}
          {product && (
            <fieldset disabled={w.busy || w.uncertain}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void w.submit(`v1/products/${product}/variants`, {
                    variants: rows.map((r) => ({
                      ...r,
                      cost: r.cost || '0',
                      quantity: Number(r.quantity || 0),
                      expiresOn: r.expiresOn || undefined,
                    })),
                  });
                }}
              >
                {rows.map((v, i) => (
                  <div className="operation-line" key={i}>
                    {(['label', 'sku', 'barcode', 'price', 'cost', 'quantity'] as const).map((k) =>
                      field(
                        t[k],
                        <input
                          key={k}
                          required={!['barcode', 'cost', 'quantity'].includes(k)}
                          value={v[k]}
                          onChange={(e) =>
                            setRows(
                              rows.map((r, j) => (i === j ? { ...r, [k]: e.target.value } : r)),
                            )
                          }
                        />,
                      ),
                    )}
                    {products.data?.items.find((p) => p.id === product)?.batchTracked &&
                      field(
                        t.expiry,
                        <input
                          type="date"
                          value={v.expiresOn}
                          onChange={(e) =>
                            setRows(
                              rows.map((r, j) =>
                                i === j ? { ...r, expiresOn: e.target.value } : r,
                              ),
                            )
                          }
                        />,
                      )}
                  </div>
                ))}
                <button
                  type="button"
                  className="button secondary"
                  onClick={() =>
                    setRows([
                      ...rows,
                      {
                        label: '',
                        sku: '',
                        barcode: '',
                        price: '',
                        cost: '',
                        quantity: '',
                        expiresOn: '',
                      },
                    ])
                  }
                >
                  {t.add}
                </button>
                <button className="button primary">
                  {t.save} · {t.variants}
                </button>
              </form>
              {products.data?.items.find((p) => p.id === product)?.type === 'service' && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void w.submit(`v1/products/${product}/recipe`, {
                      ingredients: ingredients.filter((i) => i.productId),
                    });
                  }}
                >
                  <h3>{t.recipe}</h3>
                  <p>{t.recipeHint}</p>
                  {ingredients.map((l, i) => (
                    <div className="operation-line" key={i}>
                      {field(
                        t.ingredient,
                        <select
                          value={l.productId}
                          onChange={(e) =>
                            setIngredients(
                              ingredients.map((r, j) =>
                                j === i ? { ...r, productId: e.target.value } : r,
                              ),
                            )
                          }
                        >
                          <option value="">{t.choose}</option>
                          {products.data?.items
                            .filter((p) => p.type === 'goods')
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                        </select>,
                      )}
                      {field(
                        t.quantity,
                        <input
                          type="number"
                          min="0.001"
                          step="0.001"
                          value={l.quantity}
                          onChange={(e) =>
                            setIngredients(
                              ingredients.map((r, j) =>
                                j === i ? { ...r, quantity: Number(e.target.value) } : r,
                              ),
                            )
                          }
                        />,
                      )}
                      <button
                        type="button"
                        onClick={() => setIngredients(ingredients.filter((_, j) => j !== i))}
                      >
                        {t.remove}
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setIngredients([...ingredients, { productId: '', quantity: 1 }])}
                  >
                    {t.add}
                  </button>
                  <button className="button primary">
                    {t.save} · {t.recipe}
                  </button>
                </form>
              )}
            </fieldset>
          )}
        </>
      )}
    </section>
  );
}
