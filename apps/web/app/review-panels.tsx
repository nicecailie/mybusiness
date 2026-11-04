'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Context } from '../../../packages/contracts/src/index';
import { can, stayNights } from '../../../packages/domain/src/index';
import { money, type Locale } from '../../../packages/i18n/src/index';
import { ErrorText, Field, request, State, useWrite } from './ui';
import { newOperationId } from './idempotency';

export async function filePayload(file: File) {
  if (file.size > 200 * 1024 || !['application/pdf', 'image/png', 'image/jpeg'].includes(file.type))
    throw new Error('PDF, PNG or JPEG · maximum 200 KB');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return {
    name: file.name,
    mime: file.type as 'application/pdf' | 'image/png' | 'image/jpeg',
    data: btoa(binary),
  };
}
async function download(path: string, context: Context, name: string) {
  const response = await fetch(`/api/v1/${path}`, {
    credentials: 'include',
    headers: {
      'x-tenant-id': context.tenantId,
      'x-business-id': context.businessId,
      'x-branch-id': context.branchId,
    },
  });
  if (!response.ok) throw new Error('Download failed.');
  const url = URL.createObjectURL(await response.blob()),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function BusinessAdmin({ context, locale }: { context: Context; locale: Locale }) {
  const fr = locale === 'fr',
    q = useQueryClient(),
    [error, setError] = useState(''),
    [replacesId, setReplacesId] = useState('');
  const details = useQuery({
    queryKey: ['data', context.businessId, 'business-admin'],
    queryFn: () =>
      request<{
        business: { nif: string; tva: string; offlinePolicy: string };
        documents: { id: string; name: string; createdAt: string; actorId: string }[];
      }>('v1/business', context),
  });
  const write = useWrite(
    context,
    () => {
      void q.invalidateQueries({ queryKey: ['data', context.businessId, 'business-admin'] });
    },
    'business-admin',
  );
  if (details.isPending || details.isError)
    return (
      <State
        loading={details.isPending}
        error={details.error}
        retry={() => void details.refetch()}
      />
    );
  return (
    <section className="panel review-panel">
      <h2>{fr ? 'Administration de l’entreprise' : 'Business administration'}</h2>
      <p className="muted">
        {fr
          ? 'Informations facultatives et documents privés à cette entreprise.'
          : 'Optional details and documents private to this business.'}
      </p>
      <ErrorText error={error || write.error} />
      <form
        className="form"
        onChange={write.changed}
        onSubmit={(e) => {
          e.preventDefault();
          if (write.uncertain) {
            void write.retry();
            return;
          }
          const f = new FormData(e.currentTarget);
          void write.submit('v1/business', {
            nif: String(f.get('nif')),
            tva: String(f.get('tva')),
            offlinePolicy: String(f.get('offlinePolicy')),
          });
        }}
      >
        <fieldset
          disabled={write.busy || write.uncertain}
          key={JSON.stringify(details.data.business)}
        >
          <div className="form-row">
            <Field
              label="NIF"
              name="nif"
              required={false}
              defaultValue={details.data.business.nif}
            />
            <Field
              label="TVA"
              name="tva"
              required={false}
              defaultValue={details.data.business.tva}
            />
          </div>
          <Field
            label={fr ? 'Vente au-delà du stock estimé' : 'Selling beyond estimated stock'}
            name="offlinePolicy"
          >
            <select name="offlinePolicy" defaultValue={details.data.business.offlinePolicy}>
              <option value="warning_reason">
                {fr ? 'Avertissement et motif obligatoires' : 'Warning and reason required'}
              </option>
              <option value="manager_override">
                {fr ? 'Vente enregistrée par un responsable' : 'Sale must be recorded by a manager'}
              </option>
            </select>
          </Field>
        </fieldset>
        <button className="button primary" disabled={write.busy}>
          {write.uncertain ? (fr ? 'Réessayer' : 'Retry') : fr ? 'Enregistrer' : 'Save'}
        </button>
      </form>
      <p>
        {replacesId
          ? fr
            ? 'Nouvelle version du document sélectionné ; l’original sera conservé.'
            : 'New version of the selected document; the original will be kept.'
          : ''}
      </p>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const file = (e.currentTarget.elements.namedItem('document') as HTMLInputElement)
            .files?.[0];
          if (!file) return;
          setError('');
          void filePayload(file)
            .then((body) =>
              request(
                replacesId ? `v1/business/documents/${replacesId}/update` : 'v1/business/documents',
                context,
                'POST',
                body,
                newOperationId(),
              ),
            )
            .then(() => {
              setReplacesId('');
              return details.refetch();
            })
            .catch((e) => setError(e instanceof Error ? e.message : 'Upload failed'));
        }}
      >
        <label className="field">
          <span>
            {fr
              ? 'Ajouter une attestation / un document (200 Ko maximum)'
              : 'Add a registration letter / document (maximum 200 KB)'}
          </span>
          <input
            name="document"
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            required
          />
        </label>
        <button className="button secondary">
          {fr ? 'Ajouter le document' : 'Upload document'}
        </button>
      </form>
      {details.data.documents.map((d) => (
        <div className="settings-row" key={d.id}>
          <span>
            <b>{d.name}</b>
            <small>
              {' '}
              · {new Date(d.createdAt).toLocaleString(locale)} · {d.actorId}
            </small>
          </span>
          <button className="text-button" onClick={() => setReplacesId(d.id)}>
            {fr ? 'Mettre à jour' : 'Upload new version'}
          </button>
          <button
            className="text-button"
            onClick={() =>
              void download(`business/documents/${d.id}`, context, d.name).catch((e) =>
                setError(e.message),
              )
            }
          >
            {fr ? 'Télécharger' : 'Download'}
          </button>
        </div>
      ))}
    </section>
  );
}
export function TeamPanel({ context, locale }: { context: Context; locale: Locale }) {
  const fr = locale === 'fr',
    q = useQueryClient();
  const team = useQuery({
    queryKey: ['data', context.branchId, 'staff'],
    queryFn: () =>
      request<{ id: string; name: string; email: string; role: string; active: boolean }[]>(
        'v1/staff',
        context,
      ),
  });
  const write = useWrite(
    context,
    () => void q.invalidateQueries({ queryKey: ['data', context.branchId, 'staff'] }),
    'staff',
    false,
  );
  return (
    <section className="panel review-panel">
      <h2>{fr ? 'Utilisateurs de cette entreprise' : 'Staff in this business'}</h2>
      <p className="muted">
        {fr
          ? 'Les employés se connectent avec leur compte et vérifient leur adresse e-mail, sans créer une entreprise. Un compte existant conserve son mot de passe.'
          : 'Staff sign in with their account and verify their email, without creating a business. Existing accounts keep their password.'}
      </p>
      <ErrorText error={write.error} />
      <form
        className="form"
        onChange={write.changed}
        onSubmit={(e) => {
          e.preventDefault();
          if (write.uncertain) {
            void write.retry();
            return;
          }
          const f = new FormData(e.currentTarget);
          void write.submit('v1/staff', Object.fromEntries(f));
        }}
      >
        <fieldset disabled={write.busy || write.uncertain}>
          <Field label={fr ? 'Nom' : 'Name'} name="name" />
          <Field label="Email" name="email" type="email" />
          <Field
            label={fr ? 'Mot de passe initial (nouveau compte)' : 'Initial password (new account)'}
            name="password"
            type="password"
          />
          <Field label={fr ? 'Rôle' : 'Role'} name="role">
            <select name="role">
              {[
                'cashier',
                'inventory',
                'purchasing',
                'waiter',
                'kitchen',
                'receptionist',
                'housekeeping',
                'accountant',
                'viewer',
                ...(context.role === 'owner' ? ['manager'] : []),
              ].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Field>
        </fieldset>
        <button className="button primary" disabled={write.busy}>
          {write.uncertain ? (fr ? 'Réessayer' : 'Retry') : fr ? 'Ajouter' : 'Add staff'}
        </button>
      </form>
      {team.isPending || team.isError ? (
        <State loading={team.isPending} error={team.error} retry={() => void team.refetch()} />
      ) : (
        team.data.map((s) => (
          <div className="settings-row" key={s.id}>
            <span>
              {s.name} · {s.email}
            </span>
            <b>
              {s.role} · {s.active ? (fr ? 'Actif' : 'Active') : fr ? 'Inactif' : 'Inactive'}
            </b>
            {s.role !== 'owner' &&
              s.id !== context.userId &&
              (context.role === 'owner' || s.role !== 'manager') && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (write.uncertain) {
                      void write.retry();
                      return;
                    }
                    const f = new FormData(e.currentTarget);
                    void write.submit('v1/staff/update', {
                      userId: s.id,
                      role: String(f.get('role')),
                      active: f.get('active') === 'on',
                    });
                  }}
                  onChange={write.changed}
                >
                  <fieldset disabled={write.busy || write.uncertain}>
                    <label>
                      Role
                      <select name="role" defaultValue={s.role}>
                        {[
                          'cashier',
                          'inventory',
                          'purchasing',
                          'waiter',
                          'kitchen',
                          'receptionist',
                          'housekeeping',
                          'accountant',
                          'viewer',
                          ...(context.role === 'owner' ? ['manager'] : []),
                        ].map((role) => (
                          <option key={role}>{role}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <input type="checkbox" name="active" defaultChecked={s.active} /> Active in
                      this branch
                    </label>
                  </fieldset>
                  <button className="button secondary" disabled={write.busy}>
                    {write.uncertain ? 'Retry' : 'Update access'}
                  </button>
                </form>
              )}
          </div>
        ))
      )}
    </section>
  );
}
interface Discrepancy {
  id: string;
  saleId: string;
  productName: string;
  onHand: number;
  opening: number;
  openingAvailability: number;
  localEstimate: number;
  shortage: number;
  status: string;
  valuationPending: boolean;
  sales: { id: string; number: string; quantity: number; offline: boolean; createdAt: string }[];
  events: {
    id: string;
    actorId: string;
    action: string;
    reason: string;
    referenceId: string;
    createdAt: string;
  }[];
  returns: { id: string; reason: string; createdAt: string }[];
}
export function ReconciliationPanel({
  context,
  locale,
  onReceipt,
}: {
  context: Context;
  locale: Locale;
  onReceipt: (id: string) => void;
}) {
  const fr = locale === 'fr',
    q = useQueryClient();
  const rows = useQuery({
    queryKey: ['data', context.branchId, 'reconciliation'],
    queryFn: () => request<{ items: Discrepancy[] }>('v1/reconciliation', context),
  });
  const write = useWrite(context, () => void q.invalidateQueries(), 'reconciliation');
  if (rows.isPending || rows.isError)
    return <State loading={rows.isPending} error={rows.error} retry={() => void rows.refetch()} />;
  return (
    <section className="panel review-panel">
      <h2>{fr ? 'Rapprochement du stock hors ligne' : 'Offline stock reconciliation'}</h2>
      <p className="muted">
        {fr
          ? 'Les ventes restent conservées. Toute correction exige des faits vérifiés et un motif ; aucun stock n’est créé automatiquement. Le coût des unités manquantes reste provisoire, en attente de la politique comptable.'
          : 'Sales remain recorded. Corrections require evidence and a reason; stock is never created automatically. Missing-unit costs remain provisional, pending the accounting policy.'}
      </p>
      <ErrorText error={write.error} />
      {!rows.data.items.length && (
        <p>{fr ? 'Aucun écart enregistré.' : 'No recorded discrepancies.'}</p>
      )}
      {rows.data.items.map((r) => (
        <details className="reconciliation-item" key={r.id}>
          <summary>
            {r.productName} · {fr ? 'Manque' : 'Shortage'}: {r.shortage} · {r.status}
          </summary>
          <p>
            {fr ? 'Disponibilité initiale enregistrée' : 'Recorded opening availability'}:{' '}
            {r.openingAvailability} ·{' '}
            {fr ? 'Stock avant téléversement' : 'Availability before upload'}: {r.opening} ·{' '}
            {fr ? 'Estimation locale' : 'Local estimate'}: {r.localEstimate} ·{' '}
            {fr ? 'Stock enregistré actuel' : 'Current recorded stock'}: {r.onHand}
          </p>
          <p>
            {r.valuationPending
              ? fr
                ? 'Coût des unités manquantes en attente de valorisation'
                : 'Shortage cost awaiting valuation'
              : ''}
          </p>
          {r.sales.map((s) => (
            <div className="settings-row" key={s.id}>
              <button className="text-button" onClick={() => onReceipt(s.id)}>
                {s.number}
              </button>
              <span>
                {s.quantity} ·{' '}
                {s.offline ? (fr ? 'Hors ligne' : 'Offline') : fr ? 'En ligne' : 'Online'} ·{' '}
                {new Date(s.createdAt).toLocaleString(locale)}
              </span>
            </div>
          ))}
          <form
            className="form"
            onChange={write.changed}
            onSubmit={(e) => {
              e.preventDefault();
              if (write.uncertain) {
                void write.retry();
                return;
              }
              const f = new FormData(e.currentTarget);
              void write.submit(`v1/reconciliation/${r.id}`, {
                action: String(f.get('action')),
                reason: String(f.get('reason')),
                quantity: f.get('quantity') ? Number(f.get('quantity')) : undefined,
                referenceId: f.get('referenceId') || undefined,
              });
            }}
          >
            <fieldset disabled={write.busy || write.uncertain}>
              <Field name="action" label={fr ? 'Correction vérifiée' : 'Reviewed correction'}>
                <select name="action">
                  <option value="outstanding_fulfillment">
                    {fr ? 'Livraison au client en attente' : 'Outstanding fulfillment'}
                  </option>
                  <option value="missing_delivery">
                    {fr
                      ? 'Livraison fournisseur manquante (quantité justifiée)'
                      : 'Missing delivery (evidenced quantity)'}
                  </option>
                  <option value="stock_adjustment">
                    {fr
                      ? 'Correction du stock (quantité justifiée)'
                      : 'Stock adjustment (evidenced quantity)'}
                  </option>
                  <option value="refund">{fr ? 'Remboursement lié' : 'Linked refund'}</option>
                  <option value="sale_correction">
                    {fr ? 'Contrepassation liée' : 'Linked sale reversal'}
                  </option>
                  <option value="cancellation">
                    {fr ? 'Annulation liée' : 'Linked cancellation'}
                  </option>
                </select>
              </Field>
              <Field
                name="quantity"
                label={
                  fr
                    ? 'Quantité justifiée (livraison / ajustement seulement)'
                    : 'Evidenced quantity (delivery / adjustment only)'
                }
                type="number"
                min="0.001"
                required={false}
              />
              <Field
                name="referenceId"
                label={
                  fr
                    ? 'Remboursement / contrepassation déjà enregistré sur le reçu'
                    : 'Refund / reversal already recorded on the receipt'
                }
              >
                <select name="referenceId">
                  <option value="">—</option>
                  {r.returns?.map((ret) => (
                    <option value={ret.id} key={ret.id}>
                      {ret.reason} · {new Date(ret.createdAt).toLocaleString(locale)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                name="reason"
                label={fr ? 'Motif et référence du justificatif' : 'Reason and evidence reference'}
              />
            </fieldset>
            <button className="button secondary" disabled={write.busy}>
              {write.uncertain
                ? fr
                  ? 'Réessayer'
                  : 'Retry'
                : fr
                  ? 'Enregistrer la correction'
                  : 'Record correction'}
            </button>
          </form>
          {r.events.map((e) => (
            <p className="small" key={e.id}>
              {new Date(e.createdAt).toLocaleString(locale)} · {e.actorId} · {e.action} · {e.reason}
            </p>
          ))}
        </details>
      ))}
    </section>
  );
}
interface Accommodation {
  rooms: { id: string; name: string; rate: string; occupied: boolean }[];
  stays: {
    id: string;
    roomId: string;
    guest: string;
    checkIn: string;
    checkOut: string;
    nights: number;
    total: string;
  }[];
  customers: { id: string; name: string }[];
}
export function AccommodationPanel({
  context,
  locale,
  onGuest,
}: {
  context: Context;
  locale: Locale;
  onGuest: () => void;
}) {
  const fr = locale === 'fr',
    q = useQueryClient(),
    [roomId, setRoomId] = useState(''),
    [checkIn, setCheckIn] = useState(''),
    [checkOut, setCheckOut] = useState('');
  const data = useQuery({
    queryKey: ['data', context.branchId, 'accommodation'],
    queryFn: () => request<Accommodation>('v1/accommodation', context),
  });
  const write = useWrite(context, () => void q.invalidateQueries(), 'accommodation');
  if (data.isPending || data.isError)
    return <State loading={data.isPending} error={data.error} retry={() => void data.refetch()} />;
  const occupied = data.data.rooms.filter((r) => r.occupied).length,
    room = data.data.rooms.find((r) => r.id === roomId);
  let nights = 0;
  try {
    nights = stayNights(checkIn, checkOut);
  } catch {}
  return (
    <section className="panel review-panel">
      <h2>{fr ? 'Hébergement' : 'Accommodation'}</h2>
      <div className="review-stats">
        <b>
          {occupied} {fr ? 'chambres occupées' : 'occupied rooms'}
        </b>
        <b>
          {data.data.rooms.length - occupied} {fr ? 'chambres disponibles' : 'available rooms'}
        </b>
      </div>
      <ErrorText error={write.error} />
      <div className="review-columns">
        <div>
          <h3>{fr ? 'Chambres' : 'Rooms'}</h3>
          {data.data.rooms.map((r) => (
            <p key={r.id}>
              {r.name} · {money(r.rate, locale)} / {fr ? 'nuit' : 'night'} ·{' '}
              {r.occupied ? (fr ? 'Occupée' : 'Occupied') : fr ? 'Disponible' : 'Available'}
            </p>
          ))}
          {can(context.role, 'business.manage') && (
            <form
              className="form"
              onChange={write.changed}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void (write.uncertain
                  ? write.retry()
                  : write.submit('v1/accommodation/rooms', {
                      name: String(f.get('name')),
                      rate: String(f.get('rate')),
                    }));
              }}
            >
              <fieldset disabled={write.busy || write.uncertain}>
                <Field name="name" label={fr ? 'Nom de la chambre' : 'Room name'} />
                <Field
                  name="rate"
                  label={fr ? 'Tarif journalier (BIF)' : 'Daily rate (BIF)'}
                  type="number"
                  min="1"
                />
              </fieldset>
              <button className="button secondary" disabled={write.busy}>
                {fr ? 'Ajouter une chambre' : 'Add room'}
              </button>
            </form>
          )}
        </div>
        {can(context.role, 'sale.create') && (
          <form
            className="form"
            onChange={write.changed}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void (write.uncertain
                ? write.retry()
                : write.submit('v1/accommodation/stays', {
                    roomId,
                    customerId: String(f.get('customerId')),
                    checkIn,
                    checkOut,
                  }));
            }}
          >
            <fieldset disabled={write.busy || write.uncertain}>
              <h3>{fr ? 'Nouveau séjour' : 'New stay'}</h3>
              <Field name="customerId" label={fr ? 'Client / voyageur' : 'Customer / guest'}>
                <select name="customerId" required>
                  <option value="">—</option>
                  {data.data.customers.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <button type="button" className="text-button" onClick={onGuest}>
                {fr ? 'Ajouter le profil du client' : 'Add guest profile'}
              </button>
              <Field name="roomId" label={fr ? 'Chambre' : 'Room'}>
                <select value={roomId} onChange={(e) => setRoomId(e.target.value)} required>
                  <option value="">—</option>
                  {data.data.rooms.map((r) => (
                    <option value={r.id} key={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="field">
                <span>{fr ? 'Arrivée' : 'Check-in'}</span>
                <input
                  type="date"
                  required
                  value={checkIn}
                  onChange={(e) => setCheckIn(e.target.value)}
                />
              </label>
              <label className="field">
                <span>{fr ? 'Départ' : 'Check-out'}</span>
                <input
                  type="date"
                  required
                  value={checkOut}
                  onChange={(e) => setCheckOut(e.target.value)}
                />
              </label>
              <p>
                {fr
                  ? 'Le départ n’est pas facturé : nuits = date de départ − date d’arrivée.'
                  : 'Checkout day is not charged: nights = checkout date − check-in date.'}
              </p>
              <b>
                {nights} × {room ? money(room.rate, locale) : '—'} ={' '}
                {room && nights
                  ? money((BigInt(room.rate) * BigInt(nights)).toString(), locale)
                  : '—'}
              </b>
            </fieldset>
            <button className="button primary" disabled={write.busy || !nights}>
              {write.uncertain
                ? fr
                  ? 'Réessayer'
                  : 'Retry'
                : fr
                  ? 'Enregistrer le séjour'
                  : 'Record stay'}
            </button>
          </form>
        )}
      </div>
      {data.data.stays.map((s) => (
        <div className="settings-row" key={s.id}>
          <span>
            {s.guest} · {data.data.rooms.find((r) => r.id === s.roomId)?.name} · {s.checkIn} →{' '}
            {s.checkOut} · {s.nights} {fr ? 'nuits' : 'nights'}
          </span>
          <b>{money(s.total, locale)}</b>
        </div>
      ))}
    </section>
  );
}

interface RestaurantData {
  today: string;
  foodOrders: number;
  drinkOrders: number;
  paid: number;
  unpaid: number;
  availableTables: number;
  activeTables: number;
  earnings: string;
  tables: { id: string; name: string; active: boolean }[];
  orders: {
    id: string;
    tableId: string | null;
    status: string;
    total: string;
    saleId: string | null;
    lines: { name: string; quantity: number; kind: string }[];
  }[];
}
export function RestaurantPanel({
  context,
  locale,
  onReceipt,
}: {
  context: Context;
  locale: Locale;
  onReceipt: (id: string) => void;
}) {
  const fr = locale === 'fr',
    q = useQueryClient(),
    [lines, setLines] = useState<{ productId: string; quantity: number; kind: 'food' | 'drink' }[]>(
      [],
    ),
    [paymentOrder, setPaymentOrder] = useState(''),
    [method, setMethod] = useState('cash');
  const data = useQuery({
    queryKey: ['data', context.branchId, 'restaurant'],
    queryFn: () => request<RestaurantData>('v1/restaurant', context),
  });
  const menu = useQuery({
    queryKey: ['data', context.branchId, 'restaurant-menu'],
    queryFn: () =>
      request<{ items: { id: string; name: string; price: string }[] }>(
        'v1/products?limit=100',
        context,
      ),
    enabled: can(context.role, 'sale.create'),
  });
  const register = useQuery({
    queryKey: ['data', context.branchId, 'restaurant-register'],
    queryFn: () => request<{ id: string } | null>('v1/cash-session', context),
    enabled: can(context.role, 'cash.manage'),
  });
  const write = useWrite(
    context,
    () => {
      void q.invalidateQueries();
      setLines([]);
      setPaymentOrder('');
    },
    'restaurant',
  );
  if (data.isPending || data.isError)
    return <State loading={data.isPending} error={data.error} retry={() => void data.refetch()} />;
  return (
    <section className="panel review-panel">
      <h2>
        {fr ? 'Restaurant — aujourd’hui' : 'Restaurant — today'} · {data.data.today}
      </h2>
      <p className="muted">
        {fr
          ? 'Les catégories et impayés portent sur les commandes créées aujourd’hui. Les commandes payées et recettes suivent la date du paiement, déduction des remboursements du jour. Les commandes mixtes figurent dans les deux catégories ; les ventes directes en caisse figurent ci-dessous.'
          : 'Categories and unpaid counts cover orders created today. Paid orders and earnings follow payment time, less today’s refunds. Mixed orders count in both categories; direct POS sales appear below.'}
      </p>
      <div className="review-stats">
        {[
          [fr ? 'Commandes de plats' : 'Food orders', data.data.foodOrders],
          [fr ? 'Commandes de boissons' : 'Drink orders', data.data.drinkOrders],
          [fr ? 'Payées' : 'Paid', data.data.paid],
          [fr ? 'Impayées' : 'Unpaid', data.data.unpaid],
          [fr ? 'Tables disponibles' : 'Available tables', data.data.availableTables],
          [fr ? 'Tables avec commande' : 'Tables with active orders', data.data.activeTables],
          [fr ? 'Recettes' : 'Earnings', money(data.data.earnings, locale)],
        ].map(([l, v]) => (
          <span key={l}>
            <b>{v}</b> {l}
          </span>
        ))}
      </div>
      <ErrorText error={write.error} />
      <div className="review-columns">
        <div>
          <h3>{fr ? 'Tables' : 'Tables'}</h3>
          {data.data.tables.map((t) => (
            <p key={t.id}>
              {t.name} ·{' '}
              {t.active
                ? fr
                  ? 'Commande active'
                  : 'Active order'
                : fr
                  ? 'Disponible'
                  : 'Available'}
            </p>
          ))}
          {can(context.role, 'business.manage') && (
            <form
              className="form"
              onChange={write.changed}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void (write.uncertain
                  ? write.retry()
                  : write.submit('v1/restaurant/tables', { name: String(f.get('name')) }));
              }}
            >
              <Field name="name" label={fr ? 'Nom de la table' : 'Table name'} />
              <button className="button secondary" disabled={write.busy}>
                {fr ? 'Ajouter une table' : 'Add table'}
              </button>
            </form>
          )}
        </div>
        {can(context.role, 'sale.create') && (
          <form
            className="form"
            onChange={write.changed}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void (write.uncertain
                ? write.retry()
                : write.submit('v1/restaurant/orders', {
                    tableId: f.get('tableId') || undefined,
                    lines,
                  }));
            }}
          >
            <h3>{fr ? 'Nouvelle commande' : 'New order'}</h3>
            <fieldset disabled={write.busy || write.uncertain}>
              <Field name="tableId" label={fr ? 'Table (facultatif)' : 'Table (optional)'}>
                <select name="tableId">
                  <option value="">{fr ? 'À emporter' : 'Takeaway'}</option>
                  {data.data.tables.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="field">
                <span>{fr ? 'Ajouter un article' : 'Add menu item'}</span>
                <select
                  value=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (id && !lines.some((l) => l.productId === id))
                      setLines([...lines, { productId: id, quantity: 1, kind: 'food' }]);
                  }}
                >
                  <option value="">—</option>
                  {menu.data?.items.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {money(p.price, locale)}
                    </option>
                  ))}
                </select>
              </label>
              {menu.isError && <ErrorText error={menu.error.message} />}
              {lines.map((l, i) => (
                <div className="form-row" key={l.productId}>
                  <span>{menu.data?.items.find((p) => p.id === l.productId)?.name}</span>
                  <input
                    aria-label={fr ? 'Quantité' : 'Quantity'}
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={l.quantity}
                    onChange={(e) =>
                      setLines(
                        lines.map((v, j) =>
                          i === j ? { ...v, quantity: Number(e.target.value) } : v,
                        ),
                      )
                    }
                  />
                  <select
                    aria-label={fr ? 'Type' : 'Kind'}
                    value={l.kind}
                    onChange={(e) =>
                      setLines(
                        lines.map((v, j) =>
                          i === j ? { ...v, kind: e.target.value as typeof l.kind } : v,
                        ),
                      )
                    }
                  >
                    <option value="food">{fr ? 'Plat' : 'Food'}</option>
                    <option value="drink">{fr ? 'Boisson' : 'Drink'}</option>
                  </select>
                  <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                    ×
                  </button>
                </div>
              ))}
            </fieldset>
            <button className="button primary" disabled={write.busy || !lines.length}>
              {write.uncertain
                ? fr
                  ? 'Réessayer'
                  : 'Retry'
                : fr
                  ? 'Enregistrer la commande'
                  : 'Record order'}
            </button>
          </form>
        )}
      </div>
      {data.data.orders.map((o) => (
        <div className="settings-row" key={o.id}>
          <span>
            {data.data.tables.find((t) => t.id === o.tableId)?.name ??
              (fr ? 'À emporter' : 'Takeaway')}{' '}
            · {o.lines.map((l) => `${l.quantity} × ${l.name}`).join(', ')} · {o.status} ·{' '}
            {money(o.total, locale)}
          </span>
          {o.saleId ? (
            <button className="text-button" onClick={() => onReceipt(o.saleId!)}>
              {fr ? 'Reçu' : 'Receipt'}
            </button>
          ) : (
            can(context.role, 'sale.create') && (
              <button className="text-button" onClick={() => setPaymentOrder(o.id)}>
                {fr ? 'Enregistrer le paiement' : 'Record payment'}
              </button>
            )
          )}
        </div>
      ))}
      {paymentOrder && (
        <form
          className="form"
          onChange={write.changed}
          onSubmit={(e) => {
            e.preventDefault();
            if (write.uncertain) {
              void write.retry();
              return;
            }
            if (!register.data) return;
            const f = new FormData(e.currentTarget);
            void write.submit(`v1/restaurant/orders/${paymentOrder}/pay`, {
              cashSessionId: register.data.id,
              tendered: String(f.get('tendered')),
              payment: {
                method,
                provider: method === 'mobile_money' ? String(f.get('provider')) : undefined,
                reference: String(f.get('reference') ?? '') || undefined,
              },
            });
          }}
        >
          <h3>{fr ? 'Paiement de la commande' : 'Order payment'}</h3>
          {!register.data && (
            <p>
              {fr
                ? 'Ouvrez votre caisse dans Vendre pour encaisser cette commande.'
                : 'Open your register in Sell before collecting payment.'}
            </p>
          )}
          <fieldset disabled={write.busy || write.uncertain}>
            <Field name="method" label={fr ? 'Mode de paiement' : 'Payment method'}>
              <select value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="cash">{fr ? 'Espèces' : 'Cash'}</option>
                <option value="card">{fr ? 'Carte' : 'Card'}</option>
                <option value="mobile_money">Mobile money</option>
              </select>
            </Field>
            {method === 'mobile_money' && (
              <>
                <Field name="provider" label={fr ? 'Fournisseur' : 'Provider'}>
                  <select name="provider">
                    {['Lumicash', 'Ecocash', 'iHela'].map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </Field>
                <Field
                  name="reference"
                  label={fr ? 'Référence de transaction' : 'Transaction reference'}
                />
              </>
            )}
            <Field
              name="tendered"
              label={fr ? 'Montant enregistré (BIF)' : 'Recorded amount (BIF)'}
              type="number"
              min="0"
              defaultValue={data.data.orders.find((o) => o.id === paymentOrder)?.total}
            />
          </fieldset>
          <button className="button primary" disabled={write.busy || !register.data}>
            {write.uncertain
              ? fr
                ? 'Réessayer'
                : 'Retry'
              : fr
                ? 'Enregistrer le paiement'
                : 'Record payment'}
          </button>
        </form>
      )}
    </section>
  );
}
