import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Scope } from '../packages/contracts/src/index.js';
import { createProduct, receiveStock } from '../apps/api/src/catalog.js';
import { saveRecipe } from '../apps/api/src/retail.js';
import { addTable } from '../apps/api/src/restaurant.js';
import { addRoom } from '../apps/api/src/business.js';
export async function seedHospitality(admin: Pool, users: string[]) {
  for (const [suffix, name, industry, owner] of [
    ['004', 'Restaurant Lac', 'restaurant', users[5]!],
    ['005', 'Hôtel Lac', 'hotel', users[6]!],
  ] as const) {
    const tenant = '10000000-0000-4000-8000-000000000' + suffix,
      business = '20000000-0000-4000-8000-000000000' + suffix,
      branch = '30000000-0000-4000-8000-000000000' + suffix;
    await admin.query(
      'INSERT INTO tenants(id,name,demo) VALUES($1,$2,true) ON CONFLICT DO NOTHING',
      [tenant, name],
    );
    await admin.query(
      'INSERT INTO businesses(id,tenant_id,name,industry_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [business, tenant, name, industry],
    );
    await admin.query(
      "INSERT INTO branches(id,tenant_id,business_id,name) VALUES($1,$2,$3,'Centre') ON CONFLICT DO NOTHING",
      [branch, tenant, business],
    );
    const members = [
      [owner, 'owner'],
      [users[7]!, 'waiter'],
      [users[8]!, 'kitchen'],
      [users[11]!, 'cashier'],
    ];
    if (industry === 'hotel')
      members.push([users[9]!, 'receptionist'], [users[10]!, 'housekeeping']);
    for (const [user, role] of members)
      await admin.query(
        'INSERT INTO memberships(id,user_id,tenant_id,business_id,branch_id,role) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,branch_id) DO NOTHING',
        [randomUUID(), user, tenant, business, branch, role],
      );
    const s: Scope = {
      userId: owner,
      tenantId: tenant,
      businessId: business,
      branchId: branch,
      role: 'owner',
      requestId: randomUUID(),
    };
    const ingredient = await createProduct(s, 'hospitality-rice-0001', {
      name: 'Riz cuisine',
      sku: 'RICE',
      category: 'Ingrédients',
      type: 'goods',
      price: '3000',
      cost: '1500',
      lowStock: 5,
    });
    await receiveStock(s, 'hospitality-rice-stock-01', {
      productId: ingredient.id,
      quantity: 50,
      unitCost: '1500',
      reason: 'Fictional kitchen opening stock',
      direction: 'increase',
    });
    const menu = await createProduct(s, 'hospitality-lunch-0001', {
      name: 'Assiette du jour',
      sku: 'LUNCH',
      category: 'Menu',
      type: 'service',
      price: '10000',
      cost: '0',
      lowStock: 0,
    });
    await saveRecipe(s, 'hospitality-lunch-recipe-01', menu.id, {
      ingredients: [{ productId: ingredient.id, quantity: 0.25 }],
    });
    await addTable(s, 'hospitality-table-one-0001', 'Table 1');
    await addTable(s, 'hospitality-table-two-0001', 'Table 2');
    if (industry === 'hotel') {
      await addRoom(s, 'hospitality-room-one-0001', { name: '101', rate: '50000' });
      await addRoom(s, 'hospitality-room-two-0001', { name: '102', rate: '70000' });
    }
  }
}
