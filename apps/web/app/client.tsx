'use client';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronRight,
  FileText,
  Globe,
  LayoutDashboard,
  Menu,
  MoreHorizontal,
  Package,
  PanelLeftClose,
  Plus,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Store,
  Users,
  Wallet,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Context } from '../../../packages/contracts/src/index';
import { can } from '../../../packages/domain/src/index';
import {
  hasEffectiveModule,
  industryById,
  workspaceLinks,
} from '../../../packages/domain/src/industries';
import {
  messages,
  workspaceMessages,
  type Locale,
  type MessageKey,
} from '../../../packages/i18n/src/index';

import { Login } from './forms';
import { Brand, IconButton, Language, request, State, type Page } from './ui';
import { WorkspacePage } from './workspace';
import { GetStarted } from './onboarding';
const navGroups = [
  {
    label: 'workspace',
    items: [
      ['overview', LayoutDashboard],
      ['orders', ShoppingBag],
      ['kitchen', Store],
      ['rooms', Store],
      ['housekeeping', Store],
      ['sales', ShoppingBag],
      ['products', Package],
      ['stock', Package],
      ['customers', Users],
    ],
  },
  {
    label: 'finance',
    items: [
      ['purchases', ShoppingCart],
      ['invoices', FileText],
      ['expenses', Wallet],
      ['money', Wallet],
    ],
  },
  {
    label: 'business',
    items: [
      ['reports', ChartNoAxesCombined],
      ['team', Users],
      ['settings', Settings],
    ],
  },
] as const;
type VerificationStatus =
  'completing' | 'success' | 'expired' | 'invalid' | 'used' | 'failed' | null;

function VerificationFeedback({
  status,
  locale,
  emailWarning,
  onRetry,
  onSignIn,
}: {
  status: VerificationStatus;
  locale: Locale;
  emailWarning: boolean;
  onRetry: () => void;
  onSignIn: () => void;
}) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState('');
  if (!status) return null;
  const fr = locale === 'fr';
  const copy: Record<Exclude<VerificationStatus, null>, string> = {
    completing: fr
      ? 'Activation de votre compte et de votre espace…'
      : 'Activating your account and workspace…',
    success: fr
      ? 'Votre compte a été créé et activé avec succès.'
      : 'Your account has been created and activated successfully.',
    expired: fr
      ? 'Ce lien de vérification a expiré. Demandez-en un nouveau ci-dessous.'
      : 'This verification link has expired. Request a new one below.',
    invalid: fr
      ? 'Ce lien de vérification est invalide ou a déjà été utilisé. Vous pouvez demander un nouveau lien.'
      : 'This verification link is invalid or has already been used. You can request a new link.',
    used: fr
      ? 'Ce lien a déjà été utilisé. Connectez-vous pour accéder à votre espace.'
      : 'This link has already been used. Sign in to open your workspace.',
    failed: fr
      ? 'Votre adresse est confirmée, mais l’activation n’a pas abouti. Réessayez.'
      : 'Your email is verified, but activation did not finish. Please retry.',
  };
  const sendNewLink = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSending(true);
    setError('');
    setResent(false);
    try {
      const callbackURL = new URL(window.location.origin);
      callbackURL.searchParams.set('verification', 'complete');
      callbackURL.searchParams.set('locale', locale);
      await request(
        'auth/send-verification-email',
        undefined,
        'POST',
        { email: email.trim().toLowerCase(), callbackURL: callbackURL.toString() },
        undefined,
        { 'x-mybusiness-locale': locale },
      );
      setResent(true);
    } catch {
      setError(
        fr
          ? 'Impossible d’envoyer un nouveau lien. Réessayez.'
          : 'Could not send a new link. Please try again.',
      );
    } finally {
      setSending(false);
    }
  };
  return (
    <section
      className={`activation-feedback ${status === 'success' ? 'is-success' : ''}`}
      role="status"
      aria-live="polite"
    >
      <p>{copy[status]}</p>
      {status === 'success' && emailWarning && (
        <p>
          {fr
            ? 'Votre compte est actif, mais l’e-mail de confirmation n’a pas pu être envoyé.'
            : 'Your account is active, but the confirmation email could not be sent.'}
        </p>
      )}
      {status === 'failed' && (
        <button type="button" className="setup-secondary" onClick={onRetry}>
          {fr ? 'Réessayer' : 'Try again'}
        </button>
      )}
      {status === 'used' && (
        <button type="button" className="setup-secondary" onClick={onSignIn}>
          {fr ? 'Se connecter' : 'Sign in'}
        </button>
      )}
      {(status === 'expired' || status === 'invalid') && (
        <form className="activation-resend" onSubmit={(event) => void sendNewLink(event)}>
          <label>
            {fr ? 'Adresse e-mail' : 'Email address'}
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <button type="submit" className="setup-secondary" disabled={sending}>
            {sending
              ? fr
                ? 'Envoi…'
                : 'Sending…'
              : fr
                ? 'Envoyer un nouveau lien'
                : 'Send a new link'}
          </button>
          {resent && (
            <span>
              {fr
                ? 'Si cette adresse est en attente de vérification, un nouveau lien a été envoyé.'
                : 'If this address is awaiting verification, a new link has been sent.'}
            </span>
          )}
          {error && <span role="alert">{error}</span>}
        </form>
      )}
    </section>
  );
}

function App() {
  const [locale, setLocale] = useState<Locale>('en'),
    [ready, setReady] = useState(false),
    [selected, setSelected] = useState(''),
    [page, setPage] = useState<Page>('overview'),
    [collapsed, setCollapsed] = useState(false),
    [mobileMenu, setMobileMenu] = useState(false),
    [online, setOnline] = useState(true);
  const [accountMode, setAccountMode] = useState<'signIn' | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>(null);
  const [activationEmailWarning, setActivationEmailWarning] = useState(false);
  const activationUserId = useRef('');
  const query = useQueryClient();
  const session = useQuery({
    queryKey: ['session'],
    queryFn: () =>
      request<{
        user: { id: string; name: string; email: string; twoFactorEnabled?: boolean };
      } | null>('auth/get-session'),
    retry: false,
  });
  const contexts = useQuery({
    queryKey: ['contexts'],
    queryFn: () => request<Context[]>('v1/contexts'),
    enabled: !!session.data,
    retry: false,
  });
  useEffect(() => {
    setLocale(localStorage.getItem('mb-locale') === 'fr' ? 'fr' : 'en');
    setSelected(localStorage.getItem('mb-context') ?? '');
    const restorePage = () => {
      const requested = new URLSearchParams(window.location.search).get('page');
      if (
        requested &&
        [
          'overview',
          'orders',
          'kitchen',
          'rooms',
          'housekeeping',
          'money',
          'stock',
          'sales',
          'products',
          'customers',
          'purchases',
          'invoices',
          'expenses',
          'accounting',
          'reports',
          'team',
          'settings',
          'sell',
        ].includes(requested)
      )
        setPage(requested as Page);
    };
    restorePage();
    window.addEventListener('popstate', restorePage);
    setReady(true);
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('popstate', restorePage);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedLocale = params.get('locale');
    if (requestedLocale === 'fr' || requestedLocale === 'en') setLocale(requestedLocale);
    const error = params.get('error');
    if (error === 'TOKEN_EXPIRED') setVerificationStatus('expired');
    else if (error === 'INVALID_TOKEN' || error === 'USER_NOT_FOUND' || error === 'INVALID_USER')
      setVerificationStatus('invalid');
    else if (params.get('verification') === 'complete') setVerificationStatus('completing');
  }, []);
  useEffect(() => {
    if (!ready) return;
    document.documentElement.lang = locale;
    localStorage.setItem('mb-locale', locale);
  }, [locale, ready]);
  useEffect(() => {
    if (!['completing', 'used'].includes(verificationStatus ?? '') || session.isPending) return;
    if (!session.data?.user) {
      if (verificationStatus === 'completing') setVerificationStatus('used');
      return;
    }
    const userId = session.data.user.id;
    if (activationUserId.current === userId) return;
    activationUserId.current = userId;
    void request<{
      activated: boolean;
      business?: { businessId: string; branchId: string };
      confirmationEmailSent: boolean;
    }>('v1/onboarding/activate', undefined, 'POST', {})
      .then(async (result) => {
        const refreshed = await contexts.refetch();
        const selectedContext = result.business
          ? refreshed.data?.find((item) => item.businessId === result.business?.businessId)
          : refreshed.data?.[0];
        if (selectedContext) {
          const value = `${selectedContext.businessId}:${selectedContext.branchId}`;
          setSelected(value);
          localStorage.setItem('mb-context', value);
        }
        setPage('overview');
        setActivationEmailWarning(!result.confirmationEmailSent);
        setVerificationStatus(result.activated ? 'success' : 'used');
        window.history.replaceState(null, '', window.location.pathname);
      })
      .catch(() => {
        activationUserId.current = '';
        setVerificationStatus('failed');
      });
  }, [verificationStatus, session.isPending, session.data, contexts]);
  const context =
    contexts.data?.find((c) => `${c.businessId}:${c.branchId}` === selected) ?? contexts.data?.[0];
  const t = (k: MessageKey) => messages[locale][k];
  const changeContext = (value: string) => {
    void query.cancelQueries({ predicate: (q) => q.queryKey[0] === 'data' });
    query.removeQueries({ predicate: (q) => q.queryKey[0] === 'data' });
    setSelected(value);
    localStorage.setItem('mb-context', value);
    setPage('overview');
    window.history.replaceState(null, '', '?page=overview');
  };
  const logout = async () => {
    await request('auth/sign-out', undefined, 'POST', {});
    query.clear();
    for (const storage of [localStorage, sessionStorage]) {
      for (const k of Object.keys(storage))
        if (k.startsWith('mb-draft') || k.startsWith('mb-pending') || k === 'mb-context')
          storage.removeItem(k);
    }
    setSelected('');
    void session.refetch();
  };
  const verificationFeedback = (
    <VerificationFeedback
      status={verificationStatus}
      locale={locale}
      emailWarning={activationEmailWarning}
      onRetry={() => {
        activationUserId.current = '';
        setVerificationStatus('completing');
      }}
      onSignIn={() => setAccountMode('signIn')}
    />
  );
  if (!ready || session.isPending)
    return (
      <Language.Provider value={locale}>
        {verificationFeedback}
        <State loading retry={() => void session.refetch()} />
      </Language.Provider>
    );
  if (session.isError)
    return (
      <Language.Provider value={locale}>
        {verificationFeedback}
        <State error={session.error} retry={() => void session.refetch()} />
      </Language.Provider>
    );
  if (!session.data)
    return (
      <Language.Provider value={locale}>
        {verificationFeedback}
        {accountMode ? (
          <>
            <Login
              onSuccess={() => {
                void session.refetch();
              }}
            />
            <button className="setup-return" onClick={() => setAccountMode(null)}>
              {locale === 'fr' ? 'Retour à la configuration' : 'Back to business setup'}
            </button>
          </>
        ) : (
          <GetStarted
            identity={null}
            locale={locale}
            onLocale={setLocale}
            onSignIn={() => setAccountMode('signIn')}
            onCreated={() => {
              void contexts.refetch();
            }}
          />
        )}
      </Language.Provider>
    );
  if (contexts.isPending)
    return (
      <Language.Provider value={locale}>
        {verificationFeedback}
        <State loading retry={() => void contexts.refetch()} />
      </Language.Provider>
    );
  if (contexts.isError)
    return (
      <Language.Provider value={locale}>
        {verificationFeedback}
        <State error={contexts.error} retry={() => void contexts.refetch()} />
      </Language.Provider>
    );
  if (!context)
    return (
      <Language.Provider value={locale}>
        {verificationFeedback}
        <GetStarted
          identity={session.data.user}
          locale={locale}
          onLocale={setLocale}
          onSignIn={() => setAccountMode('signIn')}
          onCreated={() => {
            void contexts.refetch();
          }}
        />
      </Language.Provider>
    );
  const navigate = (p: Page) => {
    setPage(p);
    window.history.pushState(null, '', `?page=${p}`);
    setMobileMenu(false);
  };
  const links = workspaceLinks(context.role, context.industryId, (p) => can(context.role, p));
  const showNav = (p: string) => links.some((link) => link.page === p && !link.expert);
  const configuredIndustry = context.industryId ? industryById(context.industryId) : undefined;
  return (
    <Language.Provider value={locale}>
      <div className={`app ${collapsed ? 'collapsed' : ''}`}>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <aside className={`sidebar ${mobileMenu ? 'is-open' : ''}`}>
          <div className="sidebar-brand">
            <Brand />
            <IconButton
              icon={PanelLeftClose}
              label="Collapse navigation"
              onClick={() => setCollapsed(!collapsed)}
            />
          </div>
          <div className="business-switch">
            <div className="business-avatar">
              <Store size={20} />
            </div>
            <div>
              <b>{context.businessName}</b>
              <span>{context.branchName}</span>
            </div>
            <ChevronDown size={15} />
            <select
              aria-label={t('businessDetails')}
              value={`${context.businessId}:${context.branchId}`}
              onChange={(e) => changeContext(e.target.value)}
            >
              {contexts.data?.map((c) => (
                <option key={c.branchId} value={`${c.businessId}:${c.branchId}`}>
                  {c.businessName} · {c.branchName}
                </option>
              ))}
            </select>
          </div>
          {can(context.role, 'sale.create') &&
            (!context.industryId || hasEffectiveModule(context.industryId, 'sales')) && (
              <button className="sidebar-sell" onClick={() => navigate('sell')}>
                <Plus size={19} />
                <span>{t('newSale')}</span>
                <span className="shortcut">↗</span>
              </button>
            )}
          <nav>
            {navGroups
              .filter((g) => g.items.some(([p]) => showNav(p)))
              .map((g) => (
                <div className="nav-group" key={g.label}>
                  <span className="nav-label">{t(g.label)}</span>
                  {g.items
                    .filter(([p]) => showNav(p))
                    .map(([p, Icon]) => (
                      <button
                        className={`nav-item ${page === p ? 'active' : ''}`}
                        key={p}
                        onClick={() => navigate(p)}
                        title={
                          p === 'products' && configuredIndustry
                            ? configuredIndustry.terminology.products[locale]
                            : p === 'money'
                              ? workspaceMessages[locale].money
                              : p === 'stock'
                                ? workspaceMessages[locale].stock
                                : t(p)
                        }
                      >
                        <Icon size={18} />
                        <span>
                          {p === 'products' && configuredIndustry
                            ? configuredIndustry.terminology.products[locale]
                            : p === 'money'
                              ? workspaceMessages[locale].money
                              : p === 'stock'
                                ? workspaceMessages[locale].stock
                                : t(p)}
                        </span>
                        {p === 'sales' && (
                          <span className="nav-arrow">
                            <ChevronRight size={13} />
                          </span>
                        )}
                      </button>
                    ))}
                </div>
              ))}
            {links.some((l) => l.expert) && (
              <details className="nav-group">
                <summary>{workspaceMessages[locale].more}</summary>
                {links
                  .filter((l) => l.expert)
                  .map((link) => (
                    <button
                      key={link.page}
                      className="nav-item"
                      onClick={() => navigate(link.page)}
                    >
                      {link.page === 'accounting'
                        ? workspaceMessages[locale].expert
                        : messages[locale][link.page as 'invoices' | 'reports']}
                    </button>
                  ))}
              </details>
            )}
          </nav>
          <div className="sidebar-bottom">
            <div className="workspace-note">
              <span className="tiny-dot" />
              {context.demo ? t('demo') : t('synced')}
            </div>
            <button className="profile" onClick={() => navigate('settings')}>
              <span className="avatar">{session.data.user.name.slice(0, 2).toUpperCase()}</span>
              <span>
                <b>{session.data.user.name}</b>
                <small>{context.role}</small>
              </span>
              <MoreHorizontal size={19} />
            </button>
          </div>
        </aside>
        {mobileMenu && (
          <button
            className="menu-scrim"
            aria-label={t('cancel')}
            onClick={() => setMobileMenu(false)}
          />
        )}
        <div className="workspace">
          <header className="topbar">
            <div className="breadcrumb">
              <span className="mobile-menu-button">
                <IconButton
                  icon={Menu}
                  label="Navigation"
                  onClick={() => setMobileMenu(!mobileMenu)}
                />
              </span>
              <Store size={16} />
              <span>{context.businessName}</span>
              <ChevronRight size={13} />
              <b>
                {page === 'products' && configuredIndustry
                  ? configuredIndustry.terminology.products[locale]
                  : t(page)}
              </b>
            </div>
            <div className="topbar-actions">
              <span className={`connection ${!online ? 'offline' : ''}`}>
                <span className="tiny-dot" />
                {online ? t('synced') : 'Offline'}
              </span>
              <button
                className="language-button"
                onClick={() => setLocale(locale === 'fr' ? 'en' : 'fr')}
              >
                <Globe size={16} />
                {locale.toUpperCase()}
              </button>
              <IconButton icon={Bell} label={t('lowStock')} onClick={() => navigate('overview')} />
              <span className="topbar-avatar">{session.data.user.name.charAt(0)}</span>
            </div>
          </header>
          <main id="main" className="main" key={`${context.branchId}:${page}`} tabIndex={-1}>
            {verificationFeedback}
            {!online && <div className="notice warning">{t('onlineRequired')}</div>}
            {page !== 'settings' &&
              ['owner', 'manager', 'accountant'].includes(context.role) &&
              !session.data.user.twoFactorEnabled && (
                <div className="notice security-prompt">
                  <span>{t('mfaRequiredHint')}</span>
                  <button className="button secondary" onClick={() => navigate('settings')}>
                    {t('mfaStart')}
                  </button>
                </div>
              )}
            <WorkspacePage
              page={page}
              context={context}
              navigate={navigate}
              locale={locale}
              onLogout={() => void logout()}
            />
          </main>
          <footer className="workspace-footer">
            <span>
              MyBusiness <span className="muted">/ {context.branchName}</span>
            </span>
            <span>
              {context.currency} · {context.timezone}
              {context.demo ? ` · ${t('demo')}` : ''}
            </span>
          </footer>
        </div>
        <nav className="bottom-nav">
          {(
            [
              ['overview', LayoutDashboard, 'home'],
              ['sales', ShoppingBag, 'sales'],
              ['sell', Plus, 'sell'],
              ['reports', ChartNoAxesCombined, 'reports'],
              ['settings', MoreHorizontal, 'more'],
            ] as const
          )
            .filter(([p]) => showNav(p))
            .map(([p, Icon, label]) => (
              <button
                key={p}
                className={`${p === 'sell' ? 'sell-tab' : ''} ${page === p ? 'active' : ''}`}
                onClick={() => navigate(p)}
              >
                <span>
                  <Icon size={21} />
                </span>
                {t(label)}
              </button>
            ))}
        </nav>
      </div>
    </Language.Provider>
  );
}
export default function Client() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, staleTime: 15000, refetchOnWindowFocus: true },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  );
}
