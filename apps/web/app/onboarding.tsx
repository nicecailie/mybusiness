'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronDown,
  HeartPulse,
  Package,
  Search,
  Store,
  Utensils,
  Wrench,
} from 'lucide-react';
import {
  hasEffectiveModule,
  industryCatalog,
  categoryLabels,
  type IndustryCategory,
  type IndustryId,
  type IndustryModule,
} from '../../../packages/domain/src/industries';
import type { OnboardingInput } from '../../../packages/contracts/src/index';
import { newOperationId } from './idempotency';
import { Brand, request, RequestError } from './ui';

import { filePayload } from './review-panels';
type Locale = 'en' | 'fr';
type Identity = { id: string; name: string; email: string } | null;
type Draft = {
  industryId: IndustryId | '';
  fullName: string;
  companyName: string;
  email: string;
  country: string;
  dialCode: string;
  phone: string;
  locale: Locale;
  companySize: OnboardingInput['companySize'];
  primaryInterest: OnboardingInput['primaryInterest'];
  demoData: boolean;
  nif: string;
  tva: string;
  documents: NonNullable<OnboardingInput['documents']>;
  projects: NonNullable<OnboardingInput['projects']>;
};
type SetupStep = 1 | 2 | 3;

const countries = [
  ['BI', 'Burundi', '+257'],
  ['CD', 'DR Congo', '+243'],
  ['KE', 'Kenya', '+254'],
  ['RW', 'Rwanda', '+250'],
  ['TZ', 'Tanzania', '+255'],
  ['UG', 'Uganda', '+256'],
  ['FR', 'France', '+33'],
  ['BE', 'Belgium', '+32'],
  ['CA', 'Canada', '+1'],
  ['US', 'United States', '+1'],
] as const;
const categories: IndustryCategory[] = [
  'retail',
  'food_hospitality',
  'real_estate',
  'health_fitness',
  'trades',
];
const categoryIcons = {
  retail: Store,
  food_hospitality: Utensils,
  real_estate: Building2,
  health_fitness: HeartPulse,
  trades: Wrench,
} satisfies Record<IndustryCategory, typeof Store>;
const implementedModuleLabels: Record<IndustryModule, { en: string; fr: string }> = {
  catalog: { en: 'Products and services', fr: 'Articles et services' },
  inventory: { en: 'Inventory', fr: 'Stock' },
  sales: { en: 'Sales and POS', fr: 'Ventes et caisse' },
  crm: { en: 'Customers', fr: 'Clients' },
  accounting: { en: 'Accounting', fr: 'Comptabilité' },
  reporting: { en: 'Reports', fr: 'Rapports' },
  purchasing: { en: 'Purchasing', fr: 'Achats' },
  invoicing: { en: 'Invoicing', fr: 'Facturation' },
  accommodation: { en: 'Accommodation', fr: 'Hébergement' },
  restaurant: { en: 'Restaurant operations', fr: 'Opérations de restaurant' },
  bar: { en: 'Bar operations', fr: 'Opérations de bar' },
  appointments: { en: 'Appointments', fr: 'Rendez-vous' },
  service_jobs: { en: 'Service jobs', fr: 'Interventions' },
  projects: { en: 'Projects', fr: 'Projets' },
  properties: { en: 'Properties', fr: 'Biens immobiliers' },
  memberships: { en: 'Memberships', fr: 'Abonnements' },
  support: { en: 'Support', fr: 'Assistance' },
  variants: { en: 'Product variants', fr: 'Variantes de produits' },
  quotations: { en: 'Quotations', fr: 'Devis' },
  deliveries: { en: 'Deliveries', fr: 'Livraisons' },
  batches: { en: 'Batches', fr: 'Lots' },
  expiry_tracking: { en: 'Expiry tracking', fr: 'Suivi des expirations' },
  bar_tabs: { en: 'Bar tabs', fr: 'Notes de bar' },
  tables: { en: 'Tables', fr: 'Tables' },
  kitchen: { en: 'Kitchen workflow', fr: 'Gestion de cuisine' },
  takeaway: { en: 'Takeaway orders', fr: 'Commandes à emporter' },
  wholesale: { en: 'Wholesale', fr: 'Vente en gros' },
  housekeeping: { en: 'Housekeeping', fr: 'Entretien des chambres' },
  lead_management: { en: 'Lead management', fr: 'Gestion des prospects' },
  property_viewings: { en: 'Property viewings', fr: 'Visites immobilières' },
  commissions: { en: 'Commissions', fr: 'Commissions' },
  project_budgets: { en: 'Project budgets', fr: 'Budgets de projet' },
  job_expenses: { en: 'Job expenses', fr: 'Dépenses de chantier' },
  leases: { en: 'Leases', fr: 'Baux' },
  rent_management: { en: 'Rent management', fr: 'Gestion des loyers' },
  maintenance: { en: 'Maintenance', fr: 'Maintenance' },
  staff_schedules: { en: 'Staff schedules', fr: 'Plannings du personnel' },
  class_management: { en: 'Class management', fr: 'Gestion des cours' },
  attendance: { en: 'Attendance', fr: 'Présences' },
  serial_tracking: { en: 'Serial number tracking', fr: 'Suivi des numéros de série' },
  warranties: { en: 'Warranties', fr: 'Garanties' },
  repairs: { en: 'Repairs', fr: 'Réparations' },
  recurring_jobs: { en: 'Recurring jobs', fr: 'Interventions récurrentes' },
  suppliers: { en: 'Suppliers', fr: 'Fournisseurs' },
  product_dimensions: { en: 'Product dimensions', fr: 'Dimensions des produits' },
  recipes: { en: 'Recipes', fr: 'Recettes' },
  reservations: { en: 'Reservations', fr: 'Réservations' },
  check_in_out: { en: 'Check-in and check-out', fr: 'Arrivée et départ' },
  prescription_references: { en: 'Prescription references', fr: 'Références d’ordonnance' },
  tenants_and_units: { en: 'Tenants and units', fr: 'Locataires et unités' },
  materials: { en: 'Materials', fr: 'Matériaux' },
  customer_orders: { en: 'Customer orders', fr: 'Commandes clients' },
};
const steps = [
  { id: 1 as const, title: { en: 'Choose your business', fr: 'Choisir votre activité' } },
  { id: 2 as const, title: { en: 'Business details', fr: 'Détails de l’entreprise' } },
  { id: 3 as const, title: { en: 'Review & activate', fr: 'Vérifier et activer' } },
];
const sampleSize: Draft['companySize'] = '1-5';
const initial = (identity: Identity, locale: Locale): Draft => ({
  industryId: '',
  fullName: identity?.name ?? '',
  companyName: '',
  email: identity?.email ?? '',
  country: 'BI',
  dialCode: '+257',
  phone: '',
  locale,
  companySize: sampleSize,
  primaryInterest: 'company',
  demoData: false,
  nif: '',
  tva: '',
  documents: [],
  projects: [],
});

export function GetStarted({
  identity,
  locale,
  onLocale,
  onSignIn,
  onCreated,
}: {
  identity: Identity;
  locale: Locale;
  onLocale: (locale: Locale) => void;
  onSignIn: () => void;
  onCreated: () => void;
}) {
  const [draft, setDraft] = useState(() => initial(identity, locale));
  const [step, setStep] = useState<SetupStep>(1);
  const [furthestStep, setFurthestStep] = useState<SetupStep>(1);
  const [draftRestored, setDraftRestored] = useState(false);
  const [search, setSearch] = useState('');
  const [industryOpen, setIndustryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [accountPassword, setAccountPassword] = useState('');
  const [error, setError] = useState('');
  const [operationKey, setOperationKey] = useState('');
  const industryPickerRef = useRef<HTMLDivElement>(null);
  const industryTriggerRef = useRef<HTMLButtonElement>(null);
  const industryOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const fr = locale === 'fr';

  useEffect(() => {
    const saved = sessionStorage.getItem('mb-onboarding-draft');
    if (!saved) {
      setDraftRestored(true);
      return;
    }
    try {
      const parsed = JSON.parse(saved) as Draft;
      if (
        !identity ||
        !parsed.email ||
        parsed.email.toLowerCase() === identity.email.toLowerCase()
      ) {
        setDraft({ ...initial(identity, parsed.locale ?? 'en'), ...parsed });
        const savedStep = Number(sessionStorage.getItem('mb-onboarding-step'));
        const resumeStep = [1, 2, 3].includes(savedStep)
          ? (savedStep as SetupStep)
          : parsed.industryId
            ? 2
            : 1;
        setStep(parsed.industryId || resumeStep === 1 ? resumeStep : 1);
        setFurthestStep(resumeStep);
      } else sessionStorage.removeItem('mb-onboarding-draft');
    } catch {
      sessionStorage.removeItem('mb-onboarding-draft');
    } finally {
      setDraftRestored(true);
    }
  }, [identity]);
  useEffect(() => {
    if (draft.industryId || draft.companyName || draft.fullName || draft.email)
      sessionStorage.setItem('mb-onboarding-draft', JSON.stringify(draft));
  }, [draft]);
  useEffect(() => {
    if (draftRestored) sessionStorage.setItem('mb-onboarding-step', String(step));
  }, [step, draftRestored]);
  useEffect(() => {
    if (!industryOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!industryPickerRef.current?.contains(event.target as Node)) setIndustryOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [industryOpen]);
  useEffect(() => {
    const saved = sessionStorage.getItem('mb-onboarding-operation');
    if (saved) setOperationKey(saved);
  }, []);
  useEffect(() => {
    if (operationKey) sessionStorage.setItem('mb-onboarding-operation', operationKey);
    else sessionStorage.removeItem('mb-onboarding-operation');
  }, [operationKey]);

  const visibleIndustries = useMemo(() => {
    const term = search.trim().toLocaleLowerCase(locale);
    return industryCatalog.filter((industry) =>
      `${industry.labels.en} ${industry.labels.fr} ${industry.descriptions.en}`
        .toLocaleLowerCase(locale)
        .includes(term),
    );
  }, [search, locale]);
  const selected = industryCatalog.find((industry) => industry.id === draft.industryId);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setOperationKey('');
    if (step === 2) setFurthestStep(2);
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const changeCountry = (code: string) => {
    const country = countries.find(([iso]) => iso === code);
    if (step === 2) setFurthestStep(2);
    setDraft((current) => ({ ...current, country: code, dialCode: country?.[2] ?? '+257' }));
    setOperationKey('');
  };
  const normalizePhone = useCallback(() => {
    const raw = draft.phone.trim().replace(/[\s().-]/g, '');
    if (raw.startsWith('+')) return raw;
    const digits = raw.replace(/\D/g, '').replace(/^0+/, '');
    const prefix = draft.dialCode.replace('+', '');
    return `+${digits.startsWith(prefix) ? digits : prefix + digits}`;
  }, [draft.phone, draft.dialCode]);
  const provisionBusiness = useCallback(async () => {
    if (!selected) return;
    const normalizedPhone = normalizePhone();
    if (!/^\+[1-9]\d{7,14}$/.test(normalizedPhone)) {
      setError(
        fr
          ? 'Entrez un numéro complet avec son indicatif.'
          : 'Enter a complete phone number with country code.',
      );
      return;
    }
    const input: OnboardingInput = {
      industryId: selected.id,
      fullName: draft.fullName.trim(),
      companyName: draft.companyName.trim(),
      email: draft.email.trim().toLowerCase(),
      phone: normalizedPhone,
      country: draft.country,
      locale: draft.locale,
      companySize: draft.companySize,
      primaryInterest: draft.primaryInterest,
      demoData: draft.demoData,
      acceptLegal: true,
      nif: draft.nif,
      tva: draft.tva,
      documents: draft.documents,
      projects: draft.projects,
    };
    setBusy(true);
    try {
      const key = operationKey || newOperationId();
      setOperationKey(key);
      sessionStorage.setItem('mb-onboarding-operation', key);
      await request('v1/onboarding', undefined, 'POST', input, key);
      sessionStorage.removeItem('mb-onboarding-draft');
      sessionStorage.removeItem('mb-onboarding-operation');
      sessionStorage.removeItem('mb-onboarding-step');
      onCreated();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to create the workspace.';
      setError(message);
      if (cause instanceof RequestError && !cause.uncertain) setOperationKey('');
    } finally {
      setBusy(false);
    }
  }, [selected, normalizePhone, draft, operationKey, onCreated, fr]);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (!selected) {
      setError(fr ? 'Choisissez votre secteur d’activité.' : 'Choose your industry first.');
      return;
    }
    if (identity) {
      await provisionBusiness();
      return;
    }
    if (accountPassword.length < 12) {
      setError(
        fr
          ? 'Utilisez un mot de passe de 12 caractères minimum.'
          : 'Use a password of at least 12 characters.',
      );
      return;
    }
    setBusy(true);
    try {
      sessionStorage.setItem('mb-onboarding-draft', JSON.stringify(draft));
      const input: OnboardingInput = {
        industryId: selected.id,
        fullName: draft.fullName.trim(),
        companyName: draft.companyName.trim(),
        email: draft.email.trim().toLowerCase(),
        phone: normalizePhone(),
        country: draft.country,
        locale: draft.locale,
        companySize: draft.companySize,
        primaryInterest: draft.primaryInterest,
        demoData: draft.demoData,
        acceptLegal: true,
        nif: draft.nif,
        tva: draft.tva,
        documents: draft.documents,
        projects: draft.projects,
      };
      const callbackURL = new URL(window.location.origin);
      callbackURL.searchParams.set('verification', 'complete');
      callbackURL.searchParams.set('locale', draft.locale);
      await request(
        'auth/sign-up/email',
        undefined,
        'POST',
        {
          name: draft.fullName.trim(),
          email: draft.email.trim().toLowerCase(),
          password: accountPassword,
          callbackURL: callbackURL.toString(),
          pendingOnboarding: input,
        },
        undefined,
        {
          'x-mybusiness-locale': draft.locale,
          'x-mybusiness-workspace': draft.companyName.trim().slice(0, 120),
        },
      );
      setVerificationSent(true);
      setAccountPassword('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create your account.');
    } finally {
      setBusy(false);
    }
  };

  const continueDetails = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (!event.currentTarget.reportValidity()) return;
    if (!/^\+[1-9]\d{7,14}$/.test(normalizePhone())) {
      setError(
        fr
          ? 'Entrez un numéro complet avec son indicatif.'
          : 'Enter a complete phone number with country code.',
      );
      return;
    }
    setStep(3);
    setFurthestStep(3);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const selectIndustry = (id: IndustryId) => {
    setOperationKey('');
    setDraft((current) => ({ ...current, industryId: id }));
    setFurthestStep(1);
    setIndustryOpen(false);
    setSearch('');
    setError('');
  };

  const goToIndustry = () => {
    sessionStorage.setItem('mb-onboarding-step', '1');
    setStep(1);
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const continueIndustry = () => {
    if (!selected) {
      setError(fr ? 'Choisissez votre secteur pour continuer.' : 'Choose an industry to continue.');
      return;
    }
    setError('');
    sessionStorage.setItem('mb-onboarding-step', '2');
    setStep(2);
    setFurthestStep((current) => (current < 2 ? 2 : current));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const implemented = selected
    ? selected.enabledModules.filter((module) => hasEffectiveModule(selected.id, module))
    : [];
  const stepHeading = [
    fr ? 'Quel type d’entreprise dirigez-vous ?' : 'What kind of business do you run?',
    fr ? 'Parlez-nous de votre entreprise.' : 'Tell us about your business.',
    fr
      ? 'Votre espace professionnel est presque prêt.'
      : 'Your business workspace is almost ready.',
  ][step - 1];
  const stepDescription = [
    fr
      ? 'Votre secteur détermine les outils disponibles dans votre espace.'
      : 'Your industry determines which tools are available in your workspace.',
    fr
      ? 'Ces informations serviront à configurer le profil de votre entreprise.'
      : 'We’ll use these details to set up your business profile.',
    fr
      ? 'Vérifiez les informations et choisissez comment commencer.'
      : 'Review your details and choose how you want to begin.',
  ][step - 1];
  const companySizeLabel = {
    '1-5': fr ? '1–5 employés' : '1–5 employees',
    '6-20': fr ? '6–20 employés' : '6–20 employees',
    '21-50': fr ? '21–50 employés' : '21–50 employees',
    '51-200': fr ? '51–200 employés' : '51–200 employees',
    '201+': fr ? '201+ employés' : '201+ employees',
  }[draft.companySize];
  const countryName = countries.find(([code]) => code === draft.country)?.[1] ?? draft.country;
  const SelectedIndustryIcon = selected ? categoryIcons[selected.category] : BriefcaseBusiness;
  let industryOptionIndex = 0;

  return (
    <main className="getting-started" lang={locale}>
      <a className="skip-link" href="#setup-content">
        {fr ? 'Passer au contenu' : 'Skip to setup'}
      </a>
      <section
        className="setup-shell"
        aria-label={fr ? 'Configuration MyBusiness' : 'MyBusiness setup'}
      >
        <aside
          className="setup-sidebar"
          aria-label={fr ? 'Étapes de configuration' : 'Setup steps'}
        >
          <Brand />
          <h1>{fr ? 'Configurez votre entreprise.' : 'Set up your business.'}</h1>
          <nav className="setup-steps" aria-label={fr ? 'Progression' : 'Progress'}>
            {steps.map(({ id, title }) => {
              const done = id !== step && (id < step || id < furthestStep);
              const available = id <= furthestStep;
              return (
                <button
                  key={id}
                  type="button"
                  className={`setup-step ${step === id ? 'is-active' : ''} ${done ? 'is-done' : ''}`}
                  aria-current={step === id ? 'step' : undefined}
                  disabled={!available || busy}
                  onClick={() => {
                    setStep(id);
                    setError('');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  <span className="setup-step-number">
                    {done ? <Check size={16} aria-hidden="true" /> : id}
                  </span>
                  <span>{title[locale]}</span>
                </button>
              );
            })}
          </nav>
          <p className="setup-sidebar-note">
            {fr
              ? 'Votre entreprise et ses données restent séparées et protégées.'
              : 'Your business and its records stay private and protected.'}
          </p>
        </aside>

        <section className="setup-main" aria-labelledby="setup-title">
          <header className="setup-toolbar">
            <div className="setup-mobile-progress">
              <span>{fr ? `Étape ${step} sur 3` : `Step ${step} of 3`}</span>
              <div
                className="setup-progress-track"
                role="progressbar"
                aria-valuemin={1}
                aria-valuemax={3}
                aria-valuenow={step}
                aria-label={fr ? 'Progression de configuration' : 'Setup progress'}
              >
                <span style={{ width: `${(step / 3) * 100}%` }} />
              </div>
              <small>{steps[step - 1]!.title[locale]}</small>
            </div>
            <div className="setup-toolbar-actions">
              <button
                type="button"
                className="setup-language"
                aria-label={fr ? 'Switch to English' : 'Passer en français'}
                onClick={() => onLocale(fr ? 'en' : 'fr')}
              >
                {fr ? 'EN' : 'FR'}
              </button>
              {identity ? (
                <span className="setup-identity">{identity.name}</span>
              ) : (
                <div className="setup-account-links">
                  <button type="button" className="setup-sign-in" onClick={onSignIn}>
                    {fr ? 'Se connecter' : 'Sign in'}
                  </button>
                </div>
              )}
            </div>
          </header>

          <div className="setup-main-body" id="setup-content">
            <p className="setup-step-label">{fr ? `ÉTAPE ${step}` : `STEP ${step}`}</p>
            <h2 id="setup-title">{stepHeading}</h2>
            <p className="setup-step-description">{stepDescription}</p>

            {step === 1 && (
              <>
                <div className="setup-industry-picker" ref={industryPickerRef}>
                  <button
                    ref={industryTriggerRef}
                    type="button"
                    className={`setup-industry-trigger ${industryOpen ? 'is-open' : ''}`}
                    aria-haspopup="listbox"
                    aria-expanded={industryOpen}
                    aria-controls="setup-industry-listbox"
                    onClick={() => setIndustryOpen((open) => !open)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        setIndustryOpen(true);
                        window.setTimeout(() => industryOptionRefs.current[0]?.focus(), 0);
                      }
                    }}
                  >
                    <span className="setup-industry-trigger-icon">
                      <SelectedIndustryIcon size={19} aria-hidden="true" />
                    </span>
                    <span className={selected ? '' : 'is-placeholder'}>
                      {selected
                        ? selected.labels[locale]
                        : fr
                          ? 'Choisissez votre activité'
                          : 'Select your business'}
                    </span>
                    <ChevronDown size={18} aria-hidden="true" />
                  </button>
                  {industryOpen && (
                    <div className="setup-industry-popover">
                      <label className="setup-dropdown-search">
                        <Search size={16} aria-hidden="true" />
                        <span className="sr-only">
                          {fr ? 'Rechercher un secteur' : 'Search industries'}
                        </span>
                        <input
                          autoFocus
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          placeholder={fr ? 'Rechercher un secteur' : 'Search industries'}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              setIndustryOpen(false);
                              industryTriggerRef.current?.focus();
                            } else if (event.key === 'ArrowDown') {
                              event.preventDefault();
                              industryOptionRefs.current[0]?.focus();
                            }
                          }}
                        />
                      </label>
                      <div
                        className="setup-industry-options"
                        id="setup-industry-listbox"
                        role="listbox"
                        aria-label={fr ? 'Secteurs d’activité' : 'Business types'}
                      >
                        {categories.map((category) => {
                          const items = visibleIndustries.filter(
                            (item) => item.category === category,
                          );
                          if (!items.length) return null;
                          const CategoryIcon = categoryIcons[category];
                          return (
                            <div
                              key={category}
                              className="setup-industry-group"
                              role="group"
                              aria-label={categoryLabels[category][locale]}
                            >
                              <p>{categoryLabels[category][locale]}</p>
                              {items.map((item) => {
                                const selectedIndustry = draft.industryId === item.id;
                                const optionIndex = industryOptionIndex++;
                                return (
                                  <button
                                    key={item.id}
                                    ref={(element) => {
                                      industryOptionRefs.current[optionIndex] = element;
                                    }}
                                    type="button"
                                    role="option"
                                    aria-selected={selectedIndustry}
                                    className={`setup-industry-option ${selectedIndustry ? 'is-selected' : ''}`}
                                    onClick={() => selectIndustry(item.id)}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Escape') {
                                        event.preventDefault();
                                        setIndustryOpen(false);
                                        industryTriggerRef.current?.focus();
                                      } else if (event.key === 'ArrowDown') {
                                        event.preventDefault();
                                        industryOptionRefs.current[optionIndex + 1]?.focus();
                                      } else if (event.key === 'ArrowUp') {
                                        event.preventDefault();
                                        (
                                          industryOptionRefs.current[optionIndex - 1] ??
                                          document.querySelector<HTMLInputElement>(
                                            '.setup-dropdown-search input',
                                          )
                                        )?.focus();
                                      }
                                    }}
                                  >
                                    <CategoryIcon size={18} aria-hidden="true" />
                                    <span>{item.labels[locale]}</span>
                                    {selectedIndustry && <Check size={17} aria-hidden="true" />}
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })}
                        {!visibleIndustries.length && (
                          <p className="setup-muted setup-no-industries">
                            {fr ? 'Aucun secteur trouvé.' : 'No business types found.'}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  <p className="setup-industry-help">
                    {fr
                      ? 'Votre choix détermine les outils disponibles dans votre espace.'
                      : 'Your selection determines the tools available in your workspace.'}
                  </p>
                </div>
                {error && (
                  <p className="setup-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="setup-actions setup-actions-end">
                  <button
                    type="button"
                    className="setup-primary"
                    disabled={!selected}
                    onClick={continueIndustry}
                  >
                    {fr ? 'Continuer' : 'Continue'} <ArrowRight size={17} aria-hidden="true" />
                  </button>
                </div>
              </>
            )}

            {step === 2 && selected && (
              <>
                <div className="setup-selected-summary">
                  <span className="setup-selected-icon">
                    {(() => {
                      const IndustryIcon = categoryIcons[selected.category];
                      return <IndustryIcon size={19} aria-hidden="true" />;
                    })()}
                  </span>
                  <span>
                    <small>{fr ? 'Secteur sélectionné' : 'Selected industry'}</small>
                    <strong>{selected.labels[locale]}</strong>
                  </span>
                  <button type="button" className="setup-text-button" onClick={goToIndustry}>
                    {fr ? 'Changer' : 'Change'}
                  </button>
                </div>
                <form className="setup-details-form" onSubmit={continueDetails}>
                  <fieldset className="setup-fields setup-details-fields" disabled={busy}>
                    <label className="setup-field setup-span-2">
                      <span>{fr ? 'Nom et prénom' : 'First and Last Name'}</span>
                      <input
                        autoComplete="name"
                        required
                        minLength={2}
                        maxLength={160}
                        value={draft.fullName}
                        onChange={(event) => set('fullName', event.target.value)}
                      />
                    </label>
                    <label className="setup-field setup-span-2">
                      <span>{fr ? 'Nom de l’entreprise' : 'Company Name'}</span>
                      <input
                        autoComplete="organization"
                        required
                        minLength={2}
                        maxLength={120}
                        value={draft.companyName}
                        onChange={(event) => set('companyName', event.target.value)}
                      />
                    </label>
                    <label className="setup-field">
                      <span>{fr ? 'E-mail' : 'Email'}</span>
                      <input
                        type="email"
                        autoComplete="email"
                        required
                        maxLength={254}
                        value={draft.email}
                        readOnly={!!identity}
                        onChange={(event) => set('email', event.target.value)}
                      />
                    </label>
                    {!identity && (
                      <label className="setup-field">
                        <span>{fr ? 'Mot de passe' : 'Password'}</span>
                        <input
                          type="password"
                          autoComplete="new-password"
                          required
                          minLength={12}
                          value={accountPassword}
                          onChange={(event) => setAccountPassword(event.target.value)}
                          placeholder={fr ? '12 caractères minimum' : 'At least 12 characters'}
                        />
                      </label>
                    )}
                    <label className="setup-field">
                      <span>{fr ? 'Téléphone' : 'Phone Number'}</span>
                      <div className="setup-phone">
                        <select
                          aria-label={fr ? 'Indicatif téléphonique' : 'Phone country code'}
                          value={draft.country}
                          onChange={(event) => changeCountry(event.target.value)}
                        >
                          {countries.map(([code, , dial]) => (
                            <option key={code} value={code}>
                              {dial}
                            </option>
                          ))}
                        </select>
                        <input
                          type="tel"
                          autoComplete="tel-national"
                          inputMode="tel"
                          required
                          value={draft.phone}
                          onChange={(event) => set('phone', event.target.value)}
                          placeholder={fr ? 'Numéro' : 'Number'}
                        />
                      </div>
                    </label>
                    <label className="setup-field">
                      <span>{fr ? 'Pays' : 'Country'}</span>
                      <select
                        autoComplete="country"
                        value={draft.country}
                        onChange={(event) => changeCountry(event.target.value)}
                      >
                        {countries.map(([code, name]) => (
                          <option key={code} value={code}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="setup-field">
                      <span>{fr ? 'Langue' : 'Language'}</span>
                      <select
                        value={draft.locale}
                        onChange={(event) => {
                          const value = event.target.value as Locale;
                          set('locale', value);
                          onLocale(value);
                        }}
                      >
                        <option value="en">English</option>
                        <option value="fr">Français</option>
                      </select>
                    </label>
                    <label className="setup-field">
                      <span>{fr ? 'Taille de l’entreprise' : 'Company size'}</span>
                      <select
                        value={draft.companySize}
                        onChange={(event) =>
                          set('companySize', event.target.value as Draft['companySize'])
                        }
                      >
                        <option value="1-5">1 - 5 {fr ? 'employés' : 'employees'}</option>
                        <option value="6-20">6 - 20 {fr ? 'employés' : 'employees'}</option>
                        <option value="21-50">21 - 50 {fr ? 'employés' : 'employees'}</option>
                        <option value="51-200">51 - 200 {fr ? 'employés' : 'employees'}</option>
                        <option value="201+">201+ {fr ? 'employés' : 'employees'}</option>
                      </select>
                    </label>
                    <label className="setup-field">
                      <span>{fr ? 'Intérêt principal' : 'Primary Interest'}</span>
                      <select
                        value={draft.primaryInterest}
                        onChange={(event) =>
                          set('primaryInterest', event.target.value as Draft['primaryInterest'])
                        }
                      >
                        <option value="company">
                          {fr ? 'Utiliser dans mon entreprise' : 'Use it in my company'}
                        </option>
                        <option value="explore">
                          {fr ? 'Découvrir la plateforme' : 'Explore the platform'}
                        </option>
                      </select>
                    </label>
                    <label className="setup-field setup-span-2">
                      <span>
                        {fr
                          ? 'Nombre de projets (entreprises distinctes)'
                          : 'Number of projects (separate businesses)'}
                      </span>
                      <select
                        value={draft.projects.length + 1}
                        onChange={(e) => {
                          const count = Number(e.target.value) - 1;
                          set(
                            'projects',
                            Array.from(
                              { length: count },
                              (_, i) =>
                                draft.projects[i] ?? {
                                  name: '',
                                  industryId: selected?.id ?? 'other_retail',
                                },
                            ),
                          );
                        }}
                      >
                        {[1, 2, 3].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                    {draft.projects.map((project, i) => (
                      <div className="setup-field setup-span-2" key={i}>
                        <label>
                          {fr ? 'Nom du projet' : 'Project name'} {i + 2}
                          <input
                            required
                            minLength={2}
                            maxLength={120}
                            value={project.name}
                            onChange={(e) =>
                              set(
                                'projects',
                                draft.projects.map((p, j) =>
                                  i === j ? { ...p, name: e.target.value } : p,
                                ),
                              )
                            }
                          />
                        </label>
                        <label>
                          {fr ? 'Activité' : 'Activity'}
                          <select
                            value={project.industryId}
                            onChange={(e) =>
                              set(
                                'projects',
                                draft.projects.map((p, j) =>
                                  i === j ? { ...p, industryId: e.target.value } : p,
                                ),
                              )
                            }
                          >
                            {industryCatalog.map((industry) => (
                              <option key={industry.id} value={industry.id}>
                                {industry.labels[locale]}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ))}
                    <details className="setup-field setup-span-2">
                      <summary>
                        {fr
                          ? 'Informations et documents facultatifs — maintenant ou plus tard'
                          : 'Optional details and documents — now or later'}
                      </summary>
                      <p>
                        {fr
                          ? 'Vous pouvez ignorer cette partie et la compléter dans les paramètres de l’entreprise. Ces informations concernent le premier projet.'
                          : 'You can skip this section and complete it in business settings. These details apply to the first project.'}
                      </p>
                      <label>
                        NIF
                        <input
                          maxLength={80}
                          value={draft.nif}
                          onChange={(e) => set('nif', e.target.value)}
                        />
                      </label>
                      <label>
                        TVA
                        <input
                          maxLength={80}
                          value={draft.tva}
                          onChange={(e) => set('tva', e.target.value)}
                        />
                      </label>
                      <label>
                        {fr
                          ? 'Documents (PDF, PNG, JPEG · 200 Ko chacun · maximum 3)'
                          : 'Documents (PDF, PNG, JPEG · 200 KB each · maximum 3)'}
                        <input
                          type="file"
                          multiple
                          accept="application/pdf,image/png,image/jpeg"
                          onChange={(e) => {
                            const files = Array.from(e.target.files ?? []);
                            if (files.length > 3) {
                              setError(fr ? 'Maximum 3 documents.' : 'Maximum 3 documents.');
                              return;
                            }
                            void Promise.all(files.map(filePayload))
                              .then((d) => set('documents', d))
                              .catch((e) =>
                                setError(e instanceof Error ? e.message : 'Upload failed'),
                              );
                          }}
                        />
                      </label>
                      {draft.documents.map((d, i) => (
                        <p key={i}>
                          {d.name}{' '}
                          <button
                            className="text-button"
                            type="button"
                            onClick={() =>
                              set(
                                'documents',
                                draft.documents.filter((_, j) => j !== i),
                              )
                            }
                          >
                            {fr ? 'Retirer' : 'Remove'}
                          </button>
                        </p>
                      ))}
                    </details>
                  </fieldset>
                  {error && (
                    <p className="setup-error" role="alert">
                      {error}
                    </p>
                  )}
                  <div className="setup-actions setup-actions-split">
                    <button type="button" className="setup-secondary" onClick={goToIndustry}>
                      <ArrowLeft size={17} aria-hidden="true" /> {fr ? 'Retour' : 'Back'}
                    </button>
                    <button type="submit" className="setup-primary">
                      {fr ? 'Continuer' : 'Continue'} <ArrowRight size={17} aria-hidden="true" />
                    </button>
                  </div>
                </form>
              </>
            )}

            {step === 3 && selected && (
              <>
                <div className="setup-selected-summary">
                  <span className="setup-selected-icon">
                    <CheckCircle2 size={19} aria-hidden="true" />
                  </span>
                  <span>
                    <small>{fr ? 'Votre entreprise' : 'Your business'}</small>
                    <strong>
                      {selected.labels[locale]} · {draft.companyName}
                    </strong>
                  </span>
                  <button type="button" className="setup-text-button" onClick={goToIndustry}>
                    {fr ? 'Modifier' : 'Change'}
                  </button>
                </div>
                <section className="setup-review-card">
                  <h3>
                    {fr ? 'Projets et informations facultatives' : 'Projects and optional details'}
                  </h3>
                  <p>
                    {draft.companyName} · {selected.labels[locale]}
                  </p>
                  {draft.projects.map((p, i) => (
                    <p key={i}>
                      {p.name} ·{' '}
                      {
                        industryCatalog.find((industry) => industry.id === p.industryId)?.labels[
                          locale
                        ]
                      }
                    </p>
                  ))}
                  <p>
                    NIF: {draft.nif || '—'} · TVA: {draft.tva || '—'}
                  </p>
                  {draft.documents.map((d, i) => (
                    <p key={i}>{d.name}</p>
                  ))}
                </section>
                <div className="setup-review-grid">
                  <section className="setup-review-card" aria-labelledby="review-details-title">
                    <div className="setup-review-card-heading">
                      <h3 id="review-details-title">
                        {fr ? 'Détails de l’entreprise' : 'Business details'}
                      </h3>
                      <button
                        type="button"
                        className="setup-text-button"
                        onClick={() => setStep(2)}
                      >
                        {fr ? 'Modifier' : 'Edit'}
                      </button>
                    </div>
                    <dl className="setup-review-list">
                      <div>
                        <dt>{fr ? 'Contact' : 'Contact'}</dt>
                        <dd>{draft.fullName}</dd>
                      </div>
                      <div>
                        <dt>{fr ? 'E-mail' : 'Email'}</dt>
                        <dd>{draft.email}</dd>
                      </div>
                      <div>
                        <dt>{fr ? 'Téléphone' : 'Phone'}</dt>
                        <dd>{normalizePhone()}</dd>
                      </div>
                      <div>
                        <dt>{fr ? 'Pays et langue' : 'Country and language'}</dt>
                        <dd>
                          {countryName} · {draft.locale === 'fr' ? 'Français' : 'English'}
                        </dd>
                      </div>
                      <div>
                        <dt>{fr ? 'Taille' : 'Company size'}</dt>
                        <dd>{companySizeLabel}</dd>
                      </div>
                      <div>
                        <dt>{fr ? 'Intérêt' : 'Primary interest'}</dt>
                        <dd>
                          {draft.primaryInterest === 'company'
                            ? fr
                              ? 'Utiliser dans mon entreprise'
                              : 'Use it in my company'
                            : fr
                              ? 'Découvrir la plateforme'
                              : 'Explore the platform'}
                        </dd>
                      </div>
                    </dl>
                  </section>
                  <section className="setup-review-card" aria-labelledby="review-modules-title">
                    <div className="setup-review-card-heading">
                      <h3 id="review-modules-title">
                        {fr ? 'Outils disponibles' : 'Available tools'}
                      </h3>
                      <span className="setup-implemented-tag">
                        {fr ? 'Prêts à utiliser' : 'Ready to use'}
                      </span>
                    </div>
                    <p className="setup-review-help">
                      {fr
                        ? 'Fonctions actuellement disponibles pour ce secteur.'
                        : 'Currently implemented tools enabled for this industry.'}
                    </p>
                    <ul className="setup-module-list">
                      {implemented.map((module) => (
                        <li key={module}>
                          <CheckCircle2 size={17} aria-hidden="true" />
                          <span>
                            {module === 'catalog'
                              ? selected.terminology.products[locale]
                              : implementedModuleLabels[module][locale]}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
                <form className="setup-review-form" onSubmit={submit}>
                  <fieldset className="setup-data-choice" disabled={busy}>
                    <legend>
                      {fr ? 'Choisissez comment commencer' : 'Choose how to get started'}
                    </legend>
                    <label className={`setup-data-card ${!draft.demoData ? 'is-selected' : ''}`}>
                      <input
                        type="radio"
                        name="demoData"
                        checked={!draft.demoData}
                        onChange={() => set('demoData', false)}
                      />
                      <span className="setup-data-card-icon">
                        <Package size={19} aria-hidden="true" />
                      </span>
                      <span className="setup-data-card-copy">
                        <strong>
                          {fr ? 'Commencer avec un espace vide' : 'Start with a clean workspace'}
                        </strong>
                        <small>
                          {fr
                            ? 'Ajoutez vos propres informations lorsque vous serez prêt.'
                            : 'Begin with your own business records.'}
                        </small>
                      </span>
                      <CheckCircle2
                        className="setup-data-card-check"
                        size={19}
                        aria-hidden="true"
                      />
                    </label>
                    <label className={`setup-data-card ${draft.demoData ? 'is-selected' : ''}`}>
                      <input
                        type="radio"
                        name="demoData"
                        checked={draft.demoData}
                        onChange={() => set('demoData', true)}
                      />
                      <span className="setup-data-card-icon">
                        <Store size={19} aria-hidden="true" />
                      </span>
                      <span className="setup-data-card-copy">
                        <strong>
                          {fr
                            ? 'Explorer avec des données de démonstration'
                            : 'Explore with sample data'}
                        </strong>
                        <small>
                          {fr
                            ? 'Ajoutez des exemples pour les fonctions prises en charge.'
                            : 'Load sample records for supported features.'}
                        </small>
                      </span>
                      <CheckCircle2
                        className="setup-data-card-check"
                        size={19}
                        aria-hidden="true"
                      />
                    </label>
                  </fieldset>
                  {verificationSent && !identity && (
                    <div className="setup-verification-note" role="status">
                      <span>
                        {fr
                          ? `Nous avons envoyé un lien de vérification à ${draft.email}. Après confirmation, votre compte et votre espace seront activés automatiquement.`
                          : `We sent a verification link to ${draft.email}. After you confirm, your account and workspace will activate automatically.`}
                      </span>
                    </div>
                  )}
                  {error && (
                    <p className="setup-error" role="alert">
                      {error}
                      {!identity && !verificationSent && (
                        <button type="button" className="setup-inline-link" onClick={onSignIn}>
                          {fr ? 'Se connecter' : 'Sign in'}
                        </button>
                      )}
                    </p>
                  )}
                  <p className="setup-legal">
                    {fr
                      ? 'En cliquant sur Créer mon compte et mon entreprise, vous acceptez nos conditions générales.'
                      : 'By clicking Create account & business, you accept our terms and conditions.'}
                  </p>
                  <div className="setup-actions setup-actions-split">
                    <button
                      type="button"
                      className="setup-secondary"
                      disabled={busy}
                      onClick={() => {
                        setStep(2);
                        setError('');
                      }}
                    >
                      <ArrowLeft size={17} aria-hidden="true" /> {fr ? 'Retour' : 'Back'}
                    </button>
                    <button
                      type="submit"
                      className="setup-primary"
                      disabled={busy || verificationSent}
                    >
                      {busy
                        ? fr
                          ? 'Création…'
                          : 'Creating…'
                        : verificationSent
                          ? fr
                            ? 'Vérifiez votre e-mail'
                            : 'Check your email'
                          : !identity
                            ? fr
                              ? 'Créer mon compte et mon entreprise'
                              : 'Create account & business'
                            : fr
                              ? 'Créer mon espace'
                              : 'Create my workspace'}{' '}
                      <ArrowRight size={17} aria-hidden="true" />
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
