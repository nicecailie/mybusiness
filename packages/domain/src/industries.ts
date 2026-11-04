export const modules = [
  'catalog',
  'inventory',
  'sales',
  'crm',
  'purchasing',
  'invoicing',
  'accounting',
  'reporting',
  'accommodation',
  'restaurant',
  'bar',
  'appointments',
  'service_jobs',
  'projects',
  'properties',
  'memberships',
  'support',
  'variants',
  'quotations',
  'deliveries',
  'batches',
  'expiry_tracking',
  'bar_tabs',
  'tables',
  'kitchen',
  'takeaway',
  'wholesale',
  'housekeeping',
  'lead_management',
  'property_viewings',
  'commissions',
  'project_budgets',
  'job_expenses',
  'leases',
  'rent_management',
  'maintenance',
  'staff_schedules',
  'class_management',
  'attendance',
  'serial_tracking',
  'warranties',
  'repairs',
  'recurring_jobs',
  'suppliers',
  'product_dimensions',
  'recipes',
  'reservations',
  'check_in_out',
  'prescription_references',
  'tenants_and_units',
  'materials',
  'customer_orders',
] as const;
export type IndustryModule = (typeof modules)[number];
export type IndustryCategory =
  'retail' | 'food_hospitality' | 'real_estate' | 'health_fitness' | 'trades';
export type IndustryId =
  | 'clothing_store'
  | 'furniture_store'
  | 'grocery_store'
  | 'hardware_store'
  | 'other_retail'
  | 'bar_pub'
  | 'restaurant'
  | 'fast_food'
  | 'guest_house'
  | 'beverage_distributor'
  | 'hotel'
  | 'spa_resort'
  | 'real_estate_agency'
  | 'construction_company'
  | 'property_management'
  | 'gardening'
  | 'eyewear_store'
  | 'fitness_center'
  | 'pharmacy'
  | 'hair_salon'
  | 'handyman'
  | 'it_hardware_support'
  | 'solar_energy_system'
  | 'electronic_store'
  | 'cleaning_services';

export interface IndustryDefinition {
  id: IndustryId;
  category: IndustryCategory;
  labels: { en: string; fr: string };
  descriptions: { en: string; fr: string };
  enabledModules: readonly IndustryModule[];
  navigation: readonly IndustryModule[];
  dashboard: readonly IndustryModule[];
  terminology: {
    products: { en: string; fr: string };
    sales: { en: string; fr: string };
    customers: { en: string; fr: string };
  };
  onboardingFields: readonly (
    'businessName' | 'phone' | 'country' | 'companySize' | 'primaryInterest'
  )[];
}

const base = [
  'catalog',
  'inventory',
  'sales',
  'crm',
  'purchasing',
  'accounting',
  'reporting',
] as const satisfies readonly IndustryModule[];
const retail = [...base] as const satisfies readonly IndustryModule[];
const food = [...base, 'restaurant', 'bar'] as const satisfies readonly IndustryModule[];
const services = [
  'catalog',
  'inventory',
  'sales',
  'crm',
  'purchasing',
  'accounting',
  'reporting',
  'service_jobs',
] as const satisfies readonly IndustryModule[];
const property = [
  'crm',
  'accounting',
  'reporting',
  'properties',
] as const satisfies readonly IndustryModule[];
const construction = [
  ...base,
  'purchasing',
  'projects',
] as const satisfies readonly IndustryModule[];

const entries: Omit<IndustryDefinition, 'navigation' | 'dashboard' | 'onboardingFields'>[] = [
  [
    'clothing_store',
    'retail',
    'Clothing store',
    'Magasin de vêtements',
    [...retail, 'variants'],
    'Products',
    'Articles',
  ],
  [
    'furniture_store',
    'retail',
    'Furniture store',
    'Magasin de meubles',
    [...retail, 'variants', 'product_dimensions', 'quotations', 'deliveries'],
    'Products',
    'Articles',
  ],
  [
    'grocery_store',
    'retail',
    'Grocery store',
    'Épicerie',
    [...retail, 'batches', 'expiry_tracking', 'suppliers'],
    'Products',
    'Articles',
  ],
  [
    'hardware_store',
    'retail',
    'Hardware store',
    'Quincaillerie',
    [...retail, 'quotations', 'suppliers'],
    'Products',
    'Articles',
  ],
  [
    'other_retail',
    'retail',
    'Other retail',
    'Autre commerce de détail',
    retail,
    'Products',
    'Articles',
  ],
  [
    'bar_pub',
    'food_hospitality',
    'Bar and Pub',
    'Bar et pub',
    [...food, 'bar_tabs'],
    'Drinks',
    'Boissons',
  ],
  [
    'restaurant',
    'food_hospitality',
    'Restaurant',
    'Restaurant',
    [...food, 'tables', 'kitchen', 'recipes'],
    'Menu items',
    'Plats',
  ],
  [
    'fast_food',
    'food_hospitality',
    'Fast Food',
    'Restauration rapide',
    [...food, 'kitchen', 'takeaway', 'recipes'],
    'Menu items',
    'Plats',
  ],
  [
    'guest_house',
    'food_hospitality',
    'Guest House',
    'Maison d’hôtes',
    [...base, 'accommodation', 'reservations', 'check_in_out', 'restaurant', 'bar'],
    'Products',
    'Articles',
  ],
  [
    'beverage_distributor',
    'food_hospitality',
    'Beverage distributor',
    'Distributeur de boissons',
    [...retail, 'wholesale', 'deliveries', 'suppliers'],
    'Products',
    'Articles',
  ],
  [
    'hotel',
    'food_hospitality',
    'Hotel',
    'Hôtel',
    [...base, 'accommodation', 'reservations', 'check_in_out', 'restaurant', 'bar', 'housekeeping'],
    'Products',
    'Articles',
  ],
  [
    'spa_resort',
    'food_hospitality',
    'Spa Resort',
    'Complexe hôtelier et spa',
    [...base, 'accommodation', 'reservations', 'check_in_out', 'restaurant', 'bar', 'appointments'],
    'Products',
    'Articles',
  ],
  [
    'real_estate_agency',
    'real_estate',
    'Real estate agency',
    'Agence immobilière',
    [...property, 'lead_management', 'property_viewings', 'commissions'],
    'Listings',
    'Biens',
  ],
  [
    'construction_company',
    'real_estate',
    'Construction company',
    'Entreprise de construction',
    [...construction, 'quotations', 'project_budgets', 'job_expenses', 'materials', 'suppliers'],
    'Materials',
    'Matériaux',
  ],
  [
    'property_management',
    'real_estate',
    'Property Management',
    'Gestion immobilière',
    [...property, 'leases', 'rent_management', 'maintenance', 'tenants_and_units'],
    'Properties',
    'Biens',
  ],
  [
    'gardening',
    'real_estate',
    'Gardening',
    'Jardinage',
    [...services, 'appointments', 'quotations', 'invoicing'],
    'Services',
    'Services',
  ],
  [
    'eyewear_store',
    'health_fitness',
    'Eyewear store',
    'Opticien',
    [...retail, 'variants', 'customer_orders'],
    'Products',
    'Articles',
  ],
  [
    'fitness_center',
    'health_fitness',
    'Fitness Center',
    'Centre de fitness',
    [...services, 'memberships', 'class_management', 'attendance'],
    'Services',
    'Services',
  ],
  [
    'pharmacy',
    'health_fitness',
    'Pharmacy',
    'Pharmacie',
    [...retail, 'batches', 'expiry_tracking', 'prescription_references', 'suppliers'],
    'Medicines',
    'Médicaments',
  ],
  [
    'hair_salon',
    'health_fitness',
    'Hair salon',
    'Salon de coiffure',
    [...services, 'appointments', 'staff_schedules'],
    'Services',
    'Services',
  ],
  [
    'handyman',
    'trades',
    'Handyman',
    'Petits travaux',
    [...services, 'appointments', 'quotations', 'invoicing'],
    'Services',
    'Services',
  ],
  [
    'it_hardware_support',
    'trades',
    'IT hardware & support',
    'Informatique, matériel et assistance',
    [...base, 'support', 'service_jobs', 'repairs'],
    'Products',
    'Articles',
  ],
  [
    'solar_energy_system',
    'trades',
    'Solar energy system',
    'Systèmes d’énergie solaire',
    [...base, 'projects', 'service_jobs', 'quotations', 'invoicing'],
    'Equipment',
    'Équipements',
  ],
  [
    'electronic_store',
    'trades',
    'Electronic store',
    'Magasin d’électronique',
    [...base, 'support', 'service_jobs', 'serial_tracking', 'warranties', 'repairs'],
    'Products',
    'Articles',
  ],
  [
    'cleaning_services',
    'trades',
    'Cleaning services',
    'Services de nettoyage',
    [...services, 'appointments', 'recurring_jobs', 'staff_schedules', 'invoicing'],
    'Services',
    'Services',
  ],
].map(([id, category, en, fr, enabledModules, productWord, productWordFr]) => ({
  id: id as IndustryId,
  category: category as IndustryCategory,
  labels: { en: en as string, fr: fr as string },
  descriptions: {
    en: `Set up ${en as string} operations and the relevant business workspace.`,
    fr: `Configurez les opérations de ${fr as string} et les outils adaptés.`,
  },
  enabledModules: enabledModules as readonly IndustryModule[],
  terminology: {
    products: { en: productWord as string, fr: productWordFr as string },
    sales: { en: 'Sales', fr: 'Ventes' },
    customers: { en: 'Customers', fr: 'Clients' },
  },
}));

export const industryCatalog: readonly IndustryDefinition[] = entries.map((industry) => ({
  ...industry,
  navigation: industry.enabledModules,
  dashboard: industry.enabledModules.filter((m) =>
    ['sales', 'inventory', 'accounting', 'reporting'].includes(m),
  ),
  onboardingFields: ['businessName', 'phone', 'country', 'companySize', 'primaryInterest'],
}));

export const categoryLabels: Record<IndustryCategory, { en: string; fr: string }> = {
  retail: { en: 'Retail', fr: 'Commerce de détail' },
  food_hospitality: { en: 'Food & Hospitality', fr: 'Restauration et hôtellerie' },
  real_estate: { en: 'Real estate', fr: 'Immobilier' },
  health_fitness: { en: 'Health & Fitness', fr: 'Santé et bien-être' },
  trades: { en: 'Trades', fr: 'Services et métiers' },
};

export const implementedModules = new Set<IndustryModule>([
  'purchasing',
  'invoicing',
  'accommodation',
  'restaurant',
  'catalog',
  'inventory',
  'sales',
  'crm',
  'accounting',
  'reporting',
]);

export const industryById = (id: string): IndustryDefinition | undefined =>
  industryCatalog.find((item) => item.id === id);

export function hasEffectiveModule(industryId: string | null, module: IndustryModule): boolean {
  const industry = industryId ? industryById(industryId) : undefined;
  return !!industry && industry.enabledModules.includes(module) && implementedModules.has(module);
}
