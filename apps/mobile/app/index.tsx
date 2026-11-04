import { operationsMessages } from '../../../packages/i18n/src/index';
import { cashDraftSchema, offlineSaleSchema } from '../../../packages/contracts/src/index';
import tokens from '../../../packages/design-tokens/tokens.json';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { StatusBar } from 'expo-status-bar';
import brandLogo from '../assets/mybusiness-logo.png';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type {
  CashSession,
  Context,
  Dashboard,
  Product,
  Receipt,
  SaleInput,
  OfflineSaleInput,
} from '../../../packages/contracts/src/index';
import { can, lineAmount } from '../../../packages/domain/src/index';
import {
  messages,
  money,
  paymentMethodLabel,
  paymentStatusLabel,
  type Locale,
  type MessageKey,
} from '../../../packages/i18n/src/index';
import {
  api,
  authClient,
  clearDrafts,
  loadDraft,
  NativeRequestError,
  saveDraft,
  offlineProducts,
  refreshOfflineProducts,
  offlineContext,
  recordOffline,
  syncOffline,
  offlineQueue,
  retryOffline,
  cachedContexts,
} from '../src/api';

type Tab = 'home' | 'sales' | 'sell' | 'reports' | 'more' | 'products';
interface Draft {
  lines: { productId: string; quantity: number }[];
  tendered: string;
  operationId: string;
  pending: boolean;
  submitted?: SaleInput;
}
function BrandLogo() {
  return (
    <Image
      accessibilityLabel="MyBusiness"
      resizeMode="contain"
      source={brandLogo}
      style={styles.brandLogo}
    />
  );
}
function Button({
  label,
  onPress,
  secondary = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondary,
        (pressed || disabled) && { opacity: 0.55 },
      ]}
    >
      <Text style={[styles.buttonText, secondary && { color: tokens.color.primary }]}>{label}</Text>
    </Pressable>
  );
}
function Main() {
  const [locale, setLocale] = useState<Locale>('fr'),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState(''),
    [tab, setTab] = useState<Tab>('home'),
    [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const t = (k: MessageKey) => messages[locale][k],
    query = useQueryClient(),
    session = authClient.useSession(),
    { width } = useWindowDimensions();
  const contexts = useQuery({
    queryKey: ['contexts'],
    queryFn: () => cachedContexts(session.data!.user.id),
    enabled: !!session.data,
  });
  const context = contexts.data?.find((c) => c.branchId === selected) ?? contexts.data?.[0];
  useEffect(() => {
    if (!context || !session.data || !can(context.role, 'sale.create')) return;
    let active = true;
    const sync = () => {
      if (active)
        void syncOffline(context).then(() =>
          query.invalidateQueries({ queryKey: ['offline-queue'] }),
        );
    };
    sync();
    const timer = setInterval(sync, 15000);
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') sync();
    });
    return () => {
      active = false;
      clearInterval(timer);
      listener.remove();
    };
  }, [context, session.data, query]);
  const key = [
    'data',
    session.data?.user.id,
    context?.tenantId,
    context?.businessId,
    context?.branchId,
  ];
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Bujumbura',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const dashboard = useQuery({
    queryKey: [...key, 'dashboard', today],
    queryFn: () => api<Dashboard>(`dashboard?from=${today}&to=${today}`, context),
    enabled: !!context && can(context.role, 'report.read') && (tab === 'home' || tab === 'reports'),
  });
  const sales = useQuery({
    queryKey: [...key, 'sales'],
    queryFn: () => api<{ items: Receipt[] }>('sales', context),
    enabled: !!context && can(context.role, 'sale.read') && tab === 'sales',
  });
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') void query.invalidateQueries();
    });
    return () => listener.remove();
  }, [query]);
  const login = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await authClient.signIn.email({ email, password });
      if (r.error) throw new Error(r.error.message);
      if (r.data && 'twoFactorRedirect' in r.data && r.data.twoFactorRedirect)
        throw new Error(
          'Use the web authenticator workflow to complete MFA; native MFA is tracked for foundation completion.',
        );
      setPassword('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };
  if (session.isPending)
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color="#075e49" />
      </SafeAreaView>
    );
  if (!session.data)
    return (
      <SafeAreaView style={styles.login}>
        <BrandLogo />
        <Text style={styles.loginTitle}>{t('welcome')}</Text>
        <Text style={styles.muted}>{t('loginHint')}</Text>
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        <Text style={styles.label}>{t('email')}</Text>
        <TextInput
          style={styles.input}
          accessibilityLabel={t('email')}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          value={email}
          onChangeText={setEmail}
        />
        <Text style={styles.label}>{t('password')}</Text>
        <TextInput
          style={styles.input}
          accessibilityLabel={t('password')}
          secureTextEntry
          autoComplete="password"
          value={password}
          onChangeText={setPassword}
        />
        <Button
          label={busy ? t('loading') : t('signIn')}
          onPress={() => void login()}
          disabled={busy}
        />
        <Button
          secondary
          label={locale === 'fr' ? 'English' : 'Français'}
          onPress={() => setLocale(locale === 'fr' ? 'en' : 'fr')}
        />
      </SafeAreaView>
    );
  const switchContext = async (c: Context) => {
    await query.cancelQueries({ queryKey: ['data'] });
    query.removeQueries({ queryKey: ['data'] });
    setSelected(c.branchId);
    setSelectedReceipt(null);
    setTab('home');
  };
  const logout = async () => {
    await authClient.signOut();
    query.clear();
    await clearDrafts();
    setSelected('');
  };
  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View>
          <BrandLogo />
          <Text style={styles.context}>
            {context ? `${context.businessName} · ${context.branchName}` : t('loading')}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('locale')}
          onPress={() => setLocale(locale === 'fr' ? 'en' : 'fr')}
          style={styles.lang}
        >
          <Text style={styles.label}>{locale.toUpperCase()}</Text>
        </Pressable>
      </View>
      {contexts.isError ? (
        <View style={styles.content}>
          <Text accessibilityRole="alert" style={styles.error}>
            {contexts.error.message}
          </Text>
          <Button label={t('retry')} onPress={() => void contexts.refetch()} />
        </View>
      ) : !context ? (
        <View style={styles.content}>
          <Text>{t('loading')}</Text>
          <Button label={t('signOut')} onPress={() => void logout()} />
        </View>
      ) : selectedReceipt ? (
        <ScrollView contentContainerStyle={styles.content}>
          <Button secondary label={t('back')} onPress={() => setSelectedReceipt(null)} />
          <View style={styles.panel}>
            <Text style={styles.title}>{selectedReceipt.businessName}</Text>
            {selectedReceipt.number.startsWith('OFF-') && (
              <Text style={styles.error}>
                {locale === 'fr'
                  ? 'Reçu provisoire — enregistré hors ligne, en attente de synchronisation'
                  : 'Provisional receipt — Recorded offline — awaiting sync'}
              </Text>
            )}
            {selectedReceipt.reviewRequired && <Text style={styles.error}>{t('syncReview')}</Text>}
            {selectedReceipt.payment && (
              <Text>
                {paymentMethodLabel(selectedReceipt.payment.method, locale)} ·{' '}
                {selectedReceipt.payment.provider} · {selectedReceipt.payment.reference} ·{' '}
                {paymentStatusLabel(selectedReceipt.payment.status, locale)}
              </Text>
            )}
            <Text>{selectedReceipt.createdAt}</Text>
            <Text style={styles.muted}>
              {selectedReceipt.number} · {selectedReceipt.branchName}
            </Text>
            {selectedReceipt.lines.map((l) => (
              <View key={l.id} style={styles.row}>
                <Text style={styles.flex}>
                  {l.quantity} × {l.name}
                </Text>
                <Text>{money(l.total, locale)}</Text>
              </View>
            ))}
            <View style={styles.row}>
              <Text style={styles.title}>{t('total')}</Text>
              <Text style={styles.title}>{money(selectedReceipt.total, locale)}</Text>
            </View>
            {selectedReceipt.tax && BigInt(selectedReceipt.tax) > 0n && (
              <Text>
                {operationsMessages[locale].tax}: {money(selectedReceipt.tax, locale)}
              </Text>
            )}
            <Text>
              {t('tendered')}: {money(selectedReceipt.tendered, locale)}
            </Text>
            <Text>
              {t('change')}: {money(selectedReceipt.change, locale)}
            </Text>
            <Text style={styles.muted}>{t('provisional')}</Text>
          </View>
        </ScrollView>
      ) : tab === 'sell' ? (
        <NativePOS
          key={context.branchId}
          context={context}
          locale={locale}
          onReceipt={setSelectedReceipt}
        />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, width > 900 && styles.tabletContent]}
          keyboardShouldPersistTaps="handled"
        >
          {tab === 'home' || tab === 'reports' ? (
            <>
              <View style={styles.pageTitle}>
                <Text style={styles.title}>{t(tab === 'home' ? 'greeting' : 'reports')}</Text>
                <Text style={styles.muted}>
                  {today} · {context.timezone}
                </Text>
              </View>
              {!can(context.role, 'report.read') ? (
                <Text style={styles.muted}>{t('registerRequired')}</Text>
              ) : dashboard.isPending ? (
                <ActivityIndicator color="#075e49" />
              ) : dashboard.isError ? (
                <>
                  <Text style={styles.error}>{dashboard.error.message}</Text>
                  <Button label={t('retry')} onPress={() => void dashboard.refetch()} />
                </>
              ) : (
                <>
                  {dashboard.data.valuationPending && (
                    <Text style={styles.error}>
                      {locale === 'fr'
                        ? 'Bénéfice provisoire : coûts des unités manquantes en attente.'
                        : 'Profit is provisional: shortage costs await valuation.'}
                    </Text>
                  )}
                  {!!dashboard.data.unverifiedPayments && (
                    <Text style={styles.muted}>
                      {dashboard.data.unverifiedPayments}{' '}
                      {locale === 'fr'
                        ? 'paiements avec justificatif non vérifié'
                        : 'payments with unverified evidence'}
                    </Text>
                  )}
                  <View style={styles.metrics}>
                    {(
                      [
                        ['netSales', dashboard.data.netSales],
                        ['grossProfit', dashboard.data.grossProfit],
                        ['cashCollected', dashboard.data.cashCollected],
                        ['refunds', dashboard.data.refunds],
                      ] as const
                    ).map(([label, v]) => (
                      <View style={styles.metric} key={label}>
                        <Text style={styles.muted}>{t(label)}</Text>
                        <Text style={styles.value}>{money(v, locale)}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={styles.sectionTitle}>{t('quickActions')}</Text>
                  <View style={styles.actions}>
                    <Button
                      label={t('newSale')}
                      onPress={() => setTab('sell')}
                      disabled={!can(context.role, 'sale.create')}
                    />
                    <Button secondary label={t('products')} onPress={() => setTab('products')} />
                    <Button secondary label={t('sales')} onPress={() => setTab('sales')} />
                  </View>
                  <View style={styles.panel}>
                    <Text style={styles.sectionTitle}>{t('recentTransactions')}</Text>
                    {dashboard.data.recent.length ? (
                      dashboard.data.recent.map((r) => (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${t('receipt')} ${r.number}`}
                          onPress={() => setSelectedReceipt(r)}
                          style={styles.row}
                          key={r.id}
                        >
                          <View style={styles.flex}>
                            <Text style={styles.label}>{r.number}</Text>
                            <Text style={styles.muted}>{r.customerName ?? t('walkIn')}</Text>
                          </View>
                          <Text style={styles.label}>{money(r.total, locale)}</Text>
                        </Pressable>
                      ))
                    ) : (
                      <Text style={styles.muted}>{t('noData')}</Text>
                    )}
                  </View>
                  <View style={styles.panel}>
                    <Text style={styles.sectionTitle}>{t('lowStock')}</Text>
                    {dashboard.data.lowStock.map((p) => (
                      <View style={styles.row} key={p.id}>
                        <Text style={styles.flex}>{p.name}</Text>
                        <Text>
                          {p.onHand} {t('units')}
                        </Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </>
          ) : tab === 'sales' ? (
            <>
              <Text style={styles.title}>{t('sales')}</Text>
              {sales.isPending ? (
                <ActivityIndicator />
              ) : sales.isError ? (
                <>
                  <Text style={styles.error}>{sales.error.message}</Text>
                  <Button label={t('retry')} onPress={() => void sales.refetch()} />
                </>
              ) : (
                sales.data.items.map((r) => (
                  <Pressable
                    key={r.id}
                    accessibilityRole="button"
                    accessibilityLabel={r.number}
                    style={[styles.panel, styles.row]}
                    onPress={() => setSelectedReceipt(r)}
                  >
                    <Text>{r.number}</Text>
                    <Text>{money(r.total, locale)}</Text>
                  </Pressable>
                ))
              )}
            </>
          ) : tab === 'products' ? (
            <NativeCatalog context={context} locale={locale} />
          ) : (
            <>
              <Text style={styles.title}>{t('businessDetails')}</Text>
              <Text style={styles.muted}>
                {t('demo')} · {context.currency}
              </Text>
              {contexts.data?.map((c) => (
                <Button
                  key={c.branchId}
                  secondary
                  label={`${c.businessName} · ${c.branchName}`}
                  onPress={() => void switchContext(c)}
                />
              ))}
              <Text style={styles.sectionTitle}>{t('more')}</Text>
              <Text style={styles.muted}>{t('moduleHint')}</Text>
              <Button secondary label={t('signOut')} onPress={() => void logout()} />
            </>
          )}
        </ScrollView>
      )}
      <View style={styles.nav}>
        {(['home', 'sales', 'sell', 'reports', 'more'] as const).map((p) => (
          <Pressable
            key={p}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === p }}
            accessibilityLabel={t(p)}
            onPress={() => {
              setSelectedReceipt(null);
              setTab(p);
            }}
            style={[styles.navItem, p === 'sell' && styles.navSell]}
          >
            <Text
              style={[
                styles.navText,
                tab === p && { color: tokens.color.primary, fontWeight: '700' },
                p === 'sell' && { color: 'white' },
              ]}
            >
              {p === 'sell' ? '+' : t(p)}
            </Text>
            {p === 'sell' && <Text style={styles.navSellLabel}>{t(p)}</Text>}
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}
function NativeCatalog({
  context,
  locale,
  onSelect,
}: {
  context: Context;
  locale: Locale;
  onSelect?: (p: Product) => void;
}) {
  const t = (k: MessageKey) => messages[locale][k],
    [search, setSearch] = useState('');
  const data = useQuery({
    queryKey: ['data', context.tenantId, context.businessId, context.branchId, 'products', search],
    queryFn: () =>
      api<{ items: Product[] }>(`products?limit=100&search=${encodeURIComponent(search)}`, context),
  });
  return (
    <View>
      <TextInput
        style={styles.input}
        accessibilityLabel={t('search')}
        placeholder={t('search')}
        value={search}
        onChangeText={setSearch}
      />
      {data.isPending ? (
        <ActivityIndicator />
      ) : data.isError ? (
        <>
          <Text style={styles.error}>{data.error.message}</Text>
          <Button label={t('retry')} onPress={() => void data.refetch()} />
        </>
      ) : (
        data.data.items.map((p) => (
          <Pressable
            disabled={!onSelect}
            accessibilityRole="button"
            accessibilityLabel={`${p.name}, ${money(p.price, locale)}`}
            style={[styles.panel, styles.row]}
            key={p.id}
            onPress={() => onSelect?.(p)}
          >
            <View style={styles.flex}>
              <Text style={styles.label}>{p.name}</Text>
              <Text style={styles.muted}>
                {p.sku} · {p.onHand} {t('available')}
              </Text>
            </View>
            <Text style={styles.label}>{money(p.price, locale)}</Text>
          </Pressable>
        ))
      )}
    </View>
  );
}
function NativePOS({
  context,
  locale,
  onReceipt,
}: {
  context: Context;
  locale: Locale;
  onReceipt: (r: Receipt) => void;
}) {
  const t = (k: MessageKey) => messages[locale][k],
    q = useQueryClient(),
    { width } = useWindowDimensions(),
    [ready, setReady] = useState(false),
    [draft, setDraft] = useState<Draft>({
      lines: [],
      tendered: '',
      operationId: '',
      pending: false,
    }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [opening, setOpening] = useState('0'),
    [offlineMode, setOfflineMode] = useState(false),
    [cached, setCached] = useState<{ items: Product[]; syncedAt: string }>({
      items: [],
      syncedAt: '',
    }),
    [meta, setMeta] = useState<{
      deviceId: string;
      register: CashSession | null;
      offlinePolicy: string;
    } | null>(null),
    [reason, setReason] = useState(''),
    [method, setMethod] = useState<'cash' | 'card' | 'mobile_money'>('cash'),
    [provider, setProvider] = useState<'Lumicash' | 'Ecocash' | 'iHela'>('Lumicash'),
    [reference, setReference] = useState('');
  const scope = [context.userId, context.tenantId, context.businessId, context.branchId].join(':'),
    key = ['data', context.tenantId, context.businessId, context.branchId];
  const queue = useQuery({
    queryKey: ['offline-queue', scope],
    queryFn: () => offlineQueue(context),
    refetchInterval: 5000,
  });
  useEffect(() => {
    void offlineProducts(context)
      .then(setCached)
      .catch(() => setError('Offline stock storage unavailable'));
    void offlineContext(context)
      .then((v) => {
        if (v) setMeta(v as typeof meta);
      })
      .catch(() => setError('Offline setup unavailable'));
  }, [context]);
  const newId = () => randomUUID();
  useEffect(() => {
    let active = true;
    void loadDraft(scope)
      .then(async (d) => {
        if (active) {
          const parsed = cashDraftSchema.safeParse(d);
          if (d !== null && !parsed.success) {
            await saveDraft(`${scope}:quarantine`, d);
            setError('The saved draft needs review; its original data has been retained.');
          }
          setDraft(
            parsed.success
              ? parsed.data
              : {
                  lines: [],
                  tendered: '',
                  operationId: newId(),
                  pending: false,
                },
          );
          setReady(true);
        }
      })
      .catch(() => setError('Draft storage unavailable'));
    return () => {
      active = false;
    };
  }, [scope]);
  useEffect(() => {
    if (ready)
      void saveDraft(scope, draft).catch(() =>
        setError('Draft could not be saved. Keep this screen open.'),
      );
  }, [scope, draft, ready]);
  const products = useQuery({
    enabled: !!meta?.deviceId,
    queryKey: [...key, 'pos-all'],
    queryFn: async () => {
      await syncOffline(context);
      const result = await api<{ items: Product[]; syncedAt: string }>('offline/catalog', context, {
        deviceId: meta!.deviceId,
      });
      await refreshOfflineProducts(context, result.items, result.syncedAt);
      setCached(await offlineProducts(context));
      return result;
    },
  });
  const register = useQuery({
    queryKey: [...key, 'cash'],
    queryFn: async () => {
      const register = await api<CashSession | null>('cash-session', context);
      const saved = (await offlineContext(context)) as typeof meta;
      const deviceId = saved?.deviceId ?? randomUUID();
      const device = await api<{ offlinePolicy: string }>(
        'offline/devices',
        context,
        { id: deviceId },
        deviceId,
      );
      const value = { deviceId, register, offlinePolicy: device.offlinePolicy };
      await offlineContext(context, value);
      setMeta(value);
      return register;
    },
  });
  const map = new Map(
    (cached.items.length ? cached.items : (products.data?.items ?? [])).map((p) => [p.id, p]),
  );
  const total = draft.lines.reduce(
    (sum, l) => sum + lineAmount(map.get(l.productId)?.price ?? '0', l.quantity),
    0n,
  );
  const add = (p: Product) => {
    if (draft.pending || busy) return;
    setDraft((d) => ({
      ...d,
      operationId: newId(),
      lines: d.lines.some((l) => l.productId === p.id)
        ? d.lines.map((l) => (l.productId === p.id ? { ...l, quantity: l.quantity + 1 } : l))
        : [...d.lines, { productId: p.id, quantity: 1 }],
    }));
  };
  const finish = async () => {
    if ((!register.data && !meta?.register && !draft.submitted) || busy) return;
    setBusy(true);
    setError('');
    const submitted = draft.submitted ?? {
      lines: draft.lines,
      tendered: draft.tendered,
      cashSessionId: (register.data ?? meta!.register)!.id,
      payment: {
        method,
        provider: method === 'mobile_money' ? provider : undefined,
        reference: reference || undefined,
      },
    };
    if (offlineMode && !draft.pending) {
      try {
        if (!meta?.deviceId || !cached.syncedAt)
          throw new Error('Connect once to register this device and download stock.');
        const lines = draft.lines.map((l) => {
          const p = map.get(l.productId);
          if (!p) throw new Error('A product needs to be downloaded first.');
          if (p.batchTracked) throw new Error(operationsMessages[locale].batchOnline);
          if (p.type === 'goods' && l.quantity > Math.max(0, p.onHand)) {
            if (reason.trim().length < 3)
              throw new Error('Explain selling beyond the estimated stock.');
            if (
              meta.offlinePolicy === 'manager_override' &&
              !['owner', 'manager'].includes(context.role)
            )
              throw new Error('A manager must record this sale under the business policy.');
          }
          return {
            ...l,
            name: p.name,
            sku: p.sku,
            unitPrice: p.price,
            discount: '0',
            total: lineAmount(p.price, l.quantity).toString(),
            lastKnownStock: p.onHand,
            catalogProof: p.offlineProof ?? '',
          };
        });
        const input: OfflineSaleInput = {
          saleId: draft.operationId,
          deviceId: meta.deviceId,
          userId: context.userId,
          tenantId: context.tenantId,
          businessId: context.businessId,
          branchId: context.branchId,
          localTime: new Date().toISOString(),
          lastSyncedAt: cached.syncedAt,
          cashSessionId: submitted.cashSessionId,
          tendered: draft.tendered,
          total: total.toString(),
          payment: {
            method,
            provider: method === 'mobile_money' ? provider : undefined,
            reference: reference || undefined,
          },
          reason,
          lines,
        };
        if (!/^\d+$/.test(input.tendered) || BigInt(input.tendered) < total)
          throw new Error('Recorded payment must cover the total.');
        await recordOffline(context, input);
        // The sale is now durable; failure clearing a draft cannot lose it or decrement stock twice.
        const cleared = { lines: [], tendered: '', operationId: newId(), pending: false };
        setDraft(cleared);
        await saveDraft(scope, cleared);
        setCached(await offlineProducts(context));
        void queue.refetch();
        onReceipt({
          id: input.saleId,
          number: 'OFF-' + input.saleId,
          createdAt: input.localTime,
          total: input.total,
          tendered: input.tendered,
          change: (BigInt(input.tendered) - total).toString(),
          customerName: null,
          businessName: context.businessName,
          branchName: context.branchName,
          currency: context.currency,
          returnedTotal: '0',
          offline: true,
          payment: {
            method,
            provider: input.payment.provider ?? null,
            reference: input.payment.reference ?? null,
            status: method === 'cash' ? 'recorded_offline' : 'recorded_unverified',
          },
          lines: input.lines.map((l) => ({ ...l, id: newId(), returned: 0 })),
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unable to record offline sale');
      } finally {
        setBusy(false);
      }
      return;
    }
    const pending = { ...draft, pending: true, submitted };
    try {
      try {
        await saveDraft(scope, pending);
      } catch {
        throw new NativeRequestError('The draft could not be saved on this device.', false);
      }
      setDraft(pending);
      const r = await api<{ id: string }>('sales', context, submitted, draft.operationId);
      const receipt = await api<Receipt>(`sales/${r.id}`, context);
      const cleared = {
        lines: [],
        tendered: '',
        operationId: newId(),
        pending: false,
      };
      await saveDraft(scope, cleared);
      setDraft(cleared);
      void q.invalidateQueries();
      onReceipt(receipt);
    } catch (e) {
      if (e instanceof NativeRequestError && !e.uncertain) {
        setDraft((d) => ({ ...d, pending: false, submitted: undefined }));
        setError(e.message);
      } else
        setError(
          `${e instanceof Error ? e.message : 'Connection interrupted'}. ${t('unknownOutcome')}`,
        );
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{t('newSale')}</Text>
      <Text>
        {locale === 'fr' ? 'Dernière synchronisation' : 'Last synchronized'}:{' '}
        {cached.syncedAt || '—'} ·{' '}
        {queue.data?.filter((r) => r.upload_status === 'awaiting_upload').length ?? 0}{' '}
        {locale === 'fr' ? 'ventes en attente' : 'sales awaiting upload'}
      </Text>
      <Button
        secondary
        label={
          offlineMode
            ? 'Offline recording enabled — switch to online'
            : 'Record a provisional offline sale'
        }
        onPress={() => setOfflineMode(!offlineMode)}
        disabled={busy || draft.pending}
      />
      {queue.data?.map((row) => (
        <View key={row.id}>
          <Text>
            {row.id.slice(0, 8)} ·{' '}
            {row.upload_status === 'awaiting_upload'
              ? t('offlineRecorded')
              : row.upload_status === 'synchronized_review'
                ? t('syncReview')
                : row.upload_status === 'upload_blocked'
                  ? t('uploadBlocked')
                  : t('synced')}{' '}
            {row.error}
          </Text>
          <Button
            secondary
            label={t('receipt')}
            onPress={() => {
              if (
                row.upload_status === 'synchronized' ||
                row.upload_status === 'synchronized_review'
              ) {
                void api<Receipt>(`sales/${row.id}`, context)
                  .then(onReceipt)
                  .catch((e) => setError(e instanceof Error ? e.message : 'Receipt unavailable'));
                return;
              }
              try {
                const sale = offlineSaleSchema.parse(JSON.parse(row.payload));
                onReceipt({
                  id: sale.saleId,
                  number: 'OFF-' + sale.saleId,
                  createdAt: sale.localTime,
                  total: sale.total,
                  tendered: sale.tendered,
                  change: (BigInt(sale.tendered) - BigInt(sale.total)).toString(),
                  customerName: null,
                  businessName: context.businessName,
                  branchName: context.branchName,
                  currency: context.currency,
                  returnedTotal: '0',
                  offline: true,
                  payment: {
                    method: sale.payment.method,
                    provider: sale.payment.provider ?? null,
                    reference: sale.payment.reference ?? null,
                    status:
                      sale.payment.method === 'cash' ? 'recorded_offline' : 'recorded_unverified',
                  },
                  lines: sale.lines.map((l) => ({ ...l, id: l.productId, returned: 0 })),
                });
              } catch {
                setError('The saved receipt needs review; its original data is retained.');
              }
            }}
          />
          {row.upload_status === 'upload_blocked' && (
            <Button
              label={t('retry')}
              onPress={() => void retryOffline(context, row.id).then(() => queue.refetch())}
            />
          )}
        </View>
      ))}
      <View style={width >= 850 ? styles.posSplit : undefined}>
        <View style={styles.flex}>
          {offlineMode ? (
            cached.items
              .filter((p) => !p.archived)
              .map((p) => (
                <View key={p.id} style={styles.panel}>
                  <Text>
                    {p.name} · {locale === 'fr' ? 'Stock estimé' : 'Estimated stock'}: {p.onHand}
                  </Text>
                  <Button label={`${p.name} +`} onPress={() => add(p)} />
                </View>
              ))
          ) : (
            <NativeCatalog context={context} locale={locale} onSelect={add} />
          )}
        </View>
        <View style={[styles.panel, width >= 850 && styles.tabletCart]}>
          <Text style={styles.sectionTitle}>{t('cart')}</Text>
          {draft.lines.map((l) => (
            <View style={styles.row} key={l.productId}>
              <View style={styles.flex}>
                <Text>{map.get(l.productId)?.name ?? '…'}</Text>
                <Text style={styles.muted}>
                  {l.quantity} × {map.get(l.productId)?.price ?? '…'} Fbu
                </Text>
              </View>
              <TextInput
                style={styles.input}
                accessibilityLabel={`${t('quantity')} ${map.get(l.productId)?.name ?? ''}`}
                keyboardType="decimal-pad"
                editable={!busy && !draft.pending}
                defaultValue={String(l.quantity)}
                onEndEditing={(e) => {
                  const n = Number(e.nativeEvent.text);
                  if (n > 0 && n <= 1000000 && Math.abs(n * 1000 - Math.round(n * 1000)) < 0.000001)
                    setDraft((d) => ({
                      ...d,
                      operationId: newId(),
                      lines: d.lines.map((item) =>
                        item.productId === l.productId ? { ...item, quantity: n } : item,
                      ),
                    }));
                }}
              />
              <Button
                secondary
                disabled={draft.pending || busy}
                label="−"
                onPress={() =>
                  setDraft((d) => ({
                    ...d,
                    operationId: newId(),
                    lines: d.lines.flatMap((item) =>
                      item.productId === l.productId
                        ? item.quantity > 1
                          ? [{ ...item, quantity: item.quantity - 1 }]
                          : []
                        : [item],
                    ),
                  }))
                }
              />
            </View>
          ))}
          <View style={styles.row}>
            <Text>{t('total')}</Text>
            <Text style={styles.value}>{money(total.toString(), locale)}</Text>
          </View>
          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}
          {register.isPending && !meta?.register ? (
            <ActivityIndicator />
          ) : register.isError && !meta?.register ? (
            <>
              <Text style={styles.error}>{register.error.message}</Text>
              <Button label={t('retry')} onPress={() => void register.refetch()} />
            </>
          ) : !register.data && !meta?.register && !draft.pending ? (
            <>
              <Text style={styles.label}>{t('openingFloat')}</Text>
              <TextInput
                accessibilityLabel={t('openingFloat')}
                keyboardType="number-pad"
                value={opening}
                onChangeText={setOpening}
                style={styles.input}
              />
              <Button
                label={t('openRegister')}
                onPress={() => {
                  void api('cash-session', context, { openingFloat: opening }, newId())
                    .then(() => q.invalidateQueries())
                    .catch((e) => setError(e instanceof Error ? e.message : 'Error'));
                }}
              />
            </>
          ) : (
            <>
              <View style={styles.row}>
                {(['cash', 'card', 'mobile_money'] as const).map((m) => (
                  <Button
                    key={m}
                    secondary={method !== m}
                    label={paymentMethodLabel(m, locale)}
                    disabled={busy || draft.pending}
                    onPress={() => setMethod(m)}
                  />
                ))}
              </View>
              {method === 'mobile_money' && (
                <>
                  <View style={styles.row}>
                    {(['Lumicash', 'Ecocash', 'iHela'] as const).map((p) => (
                      <Button
                        key={p}
                        secondary={provider !== p}
                        label={p}
                        onPress={() => setProvider(p)}
                      />
                    ))}
                  </View>
                  <TextInput
                    accessibilityLabel="Transaction reference"
                    placeholder="Transaction / message reference"
                    value={reference}
                    onChangeText={setReference}
                    style={styles.input}
                  />
                  <Text>Payment evidence only — provider verification is pending.</Text>
                </>
              )}
              {offlineMode && (
                <TextInput
                  accessibilityLabel="Reason for selling beyond estimate"
                  placeholder="Reason for selling beyond estimate"
                  value={reason}
                  onChangeText={setReason}
                  style={styles.input}
                />
              )}
              <Text style={styles.label}>{t('tendered')}</Text>
              <TextInput
                editable={!draft.pending && !busy}
                accessibilityLabel={t('tendered')}
                style={styles.input}
                keyboardType="number-pad"
                value={draft.tendered}
                onChangeText={(v) => setDraft((d) => ({ ...d, tendered: v, operationId: newId() }))}
              />
              <Button
                label={busy ? t('working') : draft.pending ? t('retry') : t('completeSale')}
                disabled={busy || !draft.lines.length || !ready}
                onPress={() => void finish()}
              />
            </>
          )}
          <Text style={styles.muted}>{t('draft')}</Text>
        </View>
      </View>
    </ScrollView>
  );
}
export default function App() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, staleTime: 15000 } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <Main />
    </QueryClientProvider>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.color.canvas },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderColor: tokens.color.border,
    backgroundColor: 'white',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandLogo: { width: 185, height: 42 },
  context: { fontSize: 12, color: tokens.color.muted, marginTop: 7 },
  lang: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef4ef',
    borderRadius: 10,
  },
  content: { padding: 20, gap: 17, paddingBottom: 100 },
  tabletContent: {
    maxWidth: 1200,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: 35,
  },
  title: {
    fontSize: 23,
    fontWeight: '600',
    color: tokens.color.text,
    letterSpacing: -0.5,
  },
  pageTitle: { gap: 10, marginBottom: 6 },
  muted: { fontSize: 12, lineHeight: 20, color: tokens.color.muted },
  label: { fontSize: 13, fontWeight: '500', color: '#244d3d' },
  input: {
    borderWidth: 1,
    borderColor: '#d9e3d8',
    borderRadius: 9,
    padding: 13,
    minHeight: 48,
    backgroundColor: 'white',
    fontSize: 15,
    color: tokens.color.text,
    marginVertical: 8,
  },
  button: {
    minHeight: 46,
    backgroundColor: tokens.color.primary,
    borderRadius: 9,
    padding: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
  },
  buttonText: { fontSize: 13, fontWeight: '600', color: 'white' },
  secondary: {
    backgroundColor: '#edf3e9',
    borderWidth: 1,
    borderColor: '#d8e4d5',
  },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metric: {
    padding: 17,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: 11,
    width: '48%',
    minHeight: 106,
    gap: 12,
  },
  value: {
    fontSize: 22,
    color: '#174f36',
    fontVariant: ['tabular-nums'],
    fontWeight: '500',
  },
  panel: {
    padding: 18,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: 11,
    marginVertical: 4,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#244d3d',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderColor: '#edf0e9',
  },
  flex: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  nav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderColor: tokens.color.border,
    backgroundColor: 'white',
    paddingTop: 8,
    paddingBottom: 25,
  },
  navItem: {
    minHeight: 46,
    minWidth: 55,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navText: { fontSize: 11, color: '#879585' },
  navSell: {
    backgroundColor: tokens.color.primary,
    borderRadius: 13,
    width: 53,
    height: 47,
  },
  navSellLabel: { fontSize: 9, color: 'white' },
  login: {
    flex: 1,
    padding: 28,
    justifyContent: 'center',
    backgroundColor: tokens.color.canvas,
  },
  loginTitle: {
    fontSize: 30,
    fontWeight: '600',
    letterSpacing: -1,
    color: '#244d3d',
    marginTop: 55,
    marginBottom: 12,
  },
  error: {
    color: '#ac4235',
    fontSize: 13,
    lineHeight: 21,
    paddingVertical: 12,
  },
  posSplit: { flexDirection: 'row', gap: 22, alignItems: 'flex-start' },
  tabletCart: { width: 340 },
});
