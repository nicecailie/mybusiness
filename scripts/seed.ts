import { betterAuth } from 'better-auth';
import { twoFactor } from 'better-auth/plugins';
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { openCash } from '../apps/api/src/cash.js';
import { createCustomer, createProduct, receiveStock } from '../apps/api/src/catalog.js';
import { db, pool } from '../apps/api/src/database.js';
import { finalizeSale } from '../apps/api/src/sales.js';
import type { Scope } from '../packages/contracts/src/index.js';
if (process.env.ALLOW_DEMO_SEED !== 'true' || process.env.NODE_ENV === 'production')
  throw new Error('Demo seed is explicit and forbidden in production.');
if (!process.env.DEMO_PASSWORD || process.env.DEMO_PASSWORD.length < 12)
  throw new Error('Set a development-only DEMO_PASSWORD of at least 12 characters.');
const admin = new Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
const identity = betterAuth({
  database: admin,
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: { enabled: true, minPasswordLength: 12 },
  plugins: [twoFactor()],
});
const ownerEmail = process.env.DEMO_OWNER_EMAIL ?? 'owner@example.test';
const profiles = [
  { name: 'Aline Irakoze', email: ownerEmail },
  { name: 'Patrick Ndayizeye', email: 'cashier@example.test' },
  { name: 'Diane Niyonkuru', email: 'stock@example.test' },
  { name: 'Claude Habimana', email: 'accountant@example.test' },
  { name: 'Bella Nkurunziza', email: 'second-owner@example.test' },
];
const users: string[] = [];
for (const profile of profiles) {
  const existing = await admin.query<{ id: string }>('SELECT id FROM "user" WHERE email=$1', [
    profile.email,
  ]);
  const id =
    existing.rows[0]?.id ??
    (
      await identity.api.signUpEmail({
        body: { ...profile, password: process.env.DEMO_PASSWORD },
      })
    ).user.id;
  // Fictional demo identities are pre-verified; real registration still requires verification.
  await admin.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [id]);
  users.push(id);
}
const primary = {
  tenant: '10000000-0000-4000-8000-000000000001',
  business: '20000000-0000-4000-8000-000000000001',
  branch: '30000000-0000-4000-8000-000000000001',
};
const secondary = {
  tenant: '10000000-0000-4000-8000-000000000002',
  business: '20000000-0000-4000-8000-000000000002',
  branch: '30000000-0000-4000-8000-000000000003',
};
const otherBranch = '30000000-0000-4000-8000-000000000002';
for (const [ids, name] of [
  [primary, 'Maison Kivu'],
  [secondary, 'Atelier Tanganyika'],
] as const) {
  await admin.query('INSERT INTO tenants(id,name,demo) VALUES($1,$2,true) ON CONFLICT DO NOTHING', [
    ids.tenant,
    name,
  ]);
  await admin.query(
    "INSERT INTO businesses(id,tenant_id,name,currency,timezone,locale) VALUES($1,$2,$3,'BIF','Africa/Bujumbura','fr') ON CONFLICT DO NOTHING",
    [ids.business, ids.tenant, name],
  );
  await admin.query(
    "INSERT INTO branches(id,tenant_id,business_id,name) VALUES($1,$2,$3,'Centre-ville') ON CONFLICT DO NOTHING",
    [ids.branch, ids.tenant, ids.business],
  );
}
await admin.query(
  "INSERT INTO branches(id,tenant_id,business_id,name) VALUES($1,$2,$3,'Kinindo') ON CONFLICT DO NOTHING",
  [otherBranch, primary.tenant, primary.business],
);
const roles = ['owner', 'cashier', 'inventory', 'accountant'];
for (let i = 0; i < 4; i++)
  await admin.query(
    'INSERT INTO memberships(id,user_id,tenant_id,business_id,branch_id,role) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,branch_id) DO NOTHING',
    [randomUUID(), users[i], primary.tenant, primary.business, primary.branch, roles[i]],
  );
await admin.query(
  "INSERT INTO memberships(id,user_id,tenant_id,business_id,branch_id,role) VALUES($1,$2,$3,$4,$5,'owner') ON CONFLICT(user_id,branch_id) DO NOTHING",
  [randomUUID(), users[0], primary.tenant, primary.business, otherBranch],
);
await admin.query(
  "INSERT INTO memberships(id,user_id,tenant_id,business_id,branch_id,role) VALUES($1,$2,$3,$4,$5,'owner') ON CONFLICT(user_id,branch_id) DO NOTHING",
  [randomUUID(), users[4], secondary.tenant, secondary.business, secondary.branch],
);
// Multi-tenant owner membership is explicit, enabling cache-switching checks without granting cashiers extra access.
await admin.query(
  "INSERT INTO memberships(id,user_id,tenant_id,business_id,branch_id,role) VALUES($1,$2,$3,$4,$5,'viewer') ON CONFLICT(user_id,branch_id) DO NOTHING",
  [randomUUID(), users[0], secondary.tenant, secondary.business, secondary.branch],
);
const s: Scope = {
  userId: users[0]!,
  tenantId: primary.tenant,
  businessId: primary.business,
  branchId: primary.branch,
  role: 'owner',
  requestId: randomUUID(),
};
const catalog = [
  ['Riz de la plaine · 5 kg', 'RIZ-005', 'Épicerie', '18500', '14000', 90, 12],
  ['Café du Burundi · 250 g', 'CAF-250', 'Boissons', '12000', '7500', 12, 6],
  ['Huile végétale · 1 L', 'HUI-001', 'Épicerie', '8500', '6000', 45, 8],
  ['Farine de maïs · 2 kg', 'FAR-002', 'Épicerie', '7200', '5000', 50, 10],
  ['Savon naturel · 200 g', 'SAV-200', 'Maison', '3500', '2000', 36, 8],
  ['Thé noir · 100 g', 'THE-100', 'Boissons', '6000', '4000', 5, 6],
  ['Sucre blanc · 1 kg', 'SUC-001', 'Épicerie', '4800', '3200', 22, 5],
  [
    'Bouteille isotherme en acier inoxydable · édition artisanale',
    'BOT-750',
    'Maison',
    '24000',
    '16000',
    3,
    4,
  ],
] as const;
const ids: string[] = [];
for (let i = 0; i < catalog.length; i++) {
  const [name, sku, category, price, cost, qty, lowStock] = catalog[i]!;
  const p = await createProduct(s, `seed-product-${String(i).padStart(6, '0')}`, {
    name,
    sku,
    category,
    price,
    cost,
    lowStock,
    type: 'goods',
    barcode: `10000000000${i}`,
  });
  ids.push(p.id);
  await receiveStock(s, `seed-opening-${String(i).padStart(6, '0')}`, {
    productId: p.id,
    quantity: qty,
    unitCost: cost,
    reason: 'Reviewed fictional opening stock',
  });
}
const clients = [
  ['Élodie Niyonzima', '+257 79 00 10 01', 'elodie@example.test'],
  ['Jean-Claude Bizimana', '+257 79 00 10 02', 'jean@example.test'],
  ['Hôtel des Collines', '+257 79 00 10 03', 'hotel@example.test'],
];
const customerIds = [];
for (let i = 0; i < clients.length; i++) {
  const [name, phone, email] = clients[i]!;
  customerIds.push(
    (
      await createCustomer(s, `seed-customer-${String(i).padStart(6, '0')}`, {
        name: name!,
        phone: phone!,
        email: email!,
      })
    ).id,
  );
}
const register = await openCash(s, 'seed-cash-session-00001', '50000');
for (let day = 0; day < 7; day++)
  for (let n = 0; n < 3; n++) {
    const index = (day + n) % 5,
      qty = ((day + n) % 3) + 1;
    const result = await finalizeSale(s, `seed-sale-day-${day}-n-${n}`, {
      cashSessionId: register.id,
      lines: [{ productId: ids[index]!, quantity: qty }],
      tendered: '100000',
      ...(n === 0 ? {} : { customerId: customerIds[n % customerIds.length] }),
    });
    // Fixture chronology: move all source records together, only through explicit demo administration.
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - (6 - day));
    date.setUTCHours(7 + n * 2, 10 + n * 7, 0, 0);
    await admin.query('UPDATE sales SET created_at=$1 WHERE id=$2', [date, result.id]);
    await admin.query('UPDATE payments SET created_at=$1 WHERE sale_id=$2', [date, result.id]);
    await admin.query('UPDATE journals SET created_at=$1 WHERE source_id=$2', [date, result.id]);
    await admin.query('UPDATE stock_movements SET created_at=$1 WHERE source_id=$2', [
      date,
      result.id,
    ]);
    await admin.query('UPDATE audit_events SET created_at=$1 WHERE entity_id=$2', [
      date,
      result.id,
    ]);
    await admin.query('UPDATE outbox_events SET created_at=$1 WHERE entity_id=$2', [
      date,
      result.id,
    ]);
  }
const secondScope: Scope = {
  ...s,
  userId: users[4]!,
  tenantId: secondary.tenant,
  businessId: secondary.business,
  branchId: secondary.branch,
};
const separate = await createProduct(secondScope, 'seed-secondary-product-01', {
  name: 'Carnet de commandes',
  sku: 'CARNET-01',
  category: 'Papeterie',
  price: '5000',
  cost: '2000',
  lowStock: 2,
  type: 'goods',
});
await receiveStock(secondScope, 'seed-secondary-stock-0001', {
  productId: separate.id,
  quantity: 10,
  unitCost: '2000',
  reason: 'Fictional opening stock',
});
console.log(
  `Demo seed ready: ${catalog.length} products, 21 linked sales, 2 tenants, 3 branches, 4 operational roles. Login uses DEMO_OWNER_EMAIL and DEMO_PASSWORD from the ignored .env.`,
);
await admin.end();
await db.$disconnect();
await pool.end();
