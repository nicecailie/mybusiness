import 'dotenv/config';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
if (process.env.ALLOW_DEMO_SEED !== 'true')
  throw new Error('Run browser mutation checks only against an isolated demo database.');
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  headless: true,
  args: ['--no-sandbox'],
});
const origin = 'http://localhost:3000';
async function login(email, business) {
  const b = await browser.newContext();
  const r = await b.request.post(origin + '/api/auth/sign-in/email', {
    headers: { Origin: origin },
    data: { email, password: process.env.DEMO_PASSWORD },
  });
  assert.equal(r.status(), 200, email);
  const choices = await (await b.request.get(origin + '/api/v1/contexts')).json();
  const c = choices.find((c) => c.businessName === business);
  assert.ok(c);
  await b.addInitScript(
    (value) => {
      localStorage.setItem('mb-context', value);
      if (!localStorage.getItem('mb-locale')) localStorage.setItem('mb-locale', 'en');
    },
    c.businessId + ':' + c.branchId,
  );
  return { b, c };
}
try {
  const { b, c } = await login('hotel-owner@example.test', 'Hôtel Lac'),
    page = await b.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const headers = {
    Origin: origin,
    'x-tenant-id': c.tenantId,
    'x-business-id': c.businessId,
    'x-branch-id': c.branchId,
  };
  const post = async (path, data) => {
    const r = await b.request.post(origin + '/api/v1/' + path, {
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      data,
    });
    assert.equal(r.status(), 201, await r.text());
    return r.json();
  };
  const roomName = 'Browser ' + randomUUID().slice(0, 6),
    guestName = 'Guest ' + randomUUID().slice(0, 6);
  await post('accommodation/rooms', { name: roomName, rate: '5000' });
  const today = new Date().toISOString().slice(0, 10),
    next = new Date();
  next.setUTCDate(next.getUTCDate() + 1);
  const tomorrow = next.toISOString().slice(0, 10);
  await page.goto(origin + '/?page=rooms');
  await page.getByRole('heading', { name: 'Rooms & guests', exact: true }).waitFor();
  let card = page
    .locator('section.operation-card')
    .filter({ has: page.getByRole('heading', { name: roomName, exact: true }) });
  await card.getByRole('button', { name: 'Book', exact: true }).click();
  let entry = page
    .locator('section.operation-entry')
    .filter({ has: page.getByRole('heading', { name: 'Book · ' + roomName, exact: true }) });
  await entry.getByLabel('Guest', { exact: true }).fill(guestName);
  await entry.getByLabel('Check-in', { exact: true }).fill(today);
  await entry.getByLabel('Checkout', { exact: true }).fill(tomorrow);
  await entry.getByLabel('Amount received', { exact: true }).fill('1000');
  await entry.getByRole('button', { name: 'Book', exact: true }).click();
  let stay = page.locator('section.operation-card').filter({
    has: page.getByRole('heading', { name: guestName + ' · ' + roomName, exact: true }),
  });
  await stay.getByRole('button', { name: 'Check-in', exact: true }).click();
  await stay.getByRole('button', { name: 'Checkout', exact: true }).click();
  entry = page
    .locator('section.operation-entry')
    .filter({ has: page.getByRole('heading', { name: 'Checkout · ' + guestName, exact: true }) });
  await entry.getByLabel('Extra description').fill('Laundry');
  await entry.getByLabel('Extra amount').fill('1000');
  await entry.getByLabel('Amount received', { exact: true }).fill('2000');
  await entry.getByRole('button', { name: 'Checkout', exact: true }).click();
  await stay.getByText('Balance due: 3,000 BIF', { exact: true }).waitFor();
  await stay.getByRole('button', { name: 'Guest bill', exact: true }).click();
  await page.getByText('Laundry · 1,000 BIF', { exact: true }).waitFor();
  await page.screenshot({ path: '/tmp/mybusiness-hotel-checkout.png', fullPage: true });
  await page.goto(origin + '/?page=housekeeping');
  card = page
    .locator('section.operation-card')
    .filter({ has: page.getByRole('heading', { name: roomName, exact: true }) });
  await card.getByRole('button', { name: 'Start', exact: true }).click();
  await card.getByRole('button', { name: 'Done', exact: true }).click();
  await card.getByText('Available', { exact: true }).waitFor();
  const register = await (await b.request.get(origin + '/api/v1/cash-session', { headers })).json();
  if (!register) await post('cash-session', { openingFloat: '0' });
  await page.goto(origin + '/?page=orders');
  await page.getByRole('heading', { name: 'Tables & orders', exact: true }).waitFor();
  await page.getByRole('button', { name: /Assiette du jour/ }).click();
  await page.getByRole('button', { name: 'Send to kitchen', exact: true }).click();
  card = page
    .locator('section.operation-card')
    .filter({ has: page.getByText('New', { exact: true }) })
    .filter({ hasText: 'Assiette du jour' })
    .last();
  await card.waitFor();
  const heading = await card.getByRole('heading').textContent();
  const short = heading.split(' · ').at(-1);
  await page.goto(origin + '/?page=kitchen');
  card = page.locator('section.operation-card').filter({ hasText: short });
  await card.getByRole('button', { name: 'Start', exact: true }).click();
  await card.getByRole('button', { name: 'Ready', exact: true }).click();
  await page.goto(origin + '/?page=orders');
  card = page.locator('section.operation-card').filter({ hasText: short });
  await card.getByRole('button', { name: 'Collect payment', exact: true }).click();
  await card.getByText('Paid', { exact: true }).waitFor();
  const baseName = 'Browser retail ' + randomUUID().slice(0, 6);
  const base = await post('products', {
    name: baseName,
    sku: randomUUID(),
    category: 'Browser retail',
    type: 'goods',
    price: '1000',
    cost: '100',
    lowStock: 5,
  });
  const po = await post('purchasing', {
    supplier: { name: 'Browser vendor ' + randomUUID().slice(0, 6) },
    mode: 'order',
    orderDate: today,
    notes: 'Browser reorder',
    lines: [{ productId: base.id, quantity: 1, unitCost: '100' }],
  });
  const purchase = (
    await (await b.request.get(origin + '/api/v1/purchasing?id=' + po.id, { headers })).json()
  ).items[0];
  await post('purchasing/' + po.id + '/receive', {
    lines: [{ lineId: purchase.lines[0].id, quantity: 1 }],
  });
  await page.goto(origin + '/?page=products');
  entry = page
    .locator('section.operation-entry')
    .filter({ has: page.getByRole('heading', { name: 'Variants / Recipe', exact: true }) });
  await entry.getByRole('combobox', { name: 'Item', exact: true }).selectOption(base.id);
  await entry.getByLabel('Variant (size, colour, volume)', { exact: true }).fill('Blue M');
  await entry.getByLabel('SKU', { exact: true }).fill(randomUUID());
  await entry.getByLabel('Price', { exact: true }).fill('2000');
  await entry.getByLabel('Cost', { exact: true }).fill('300');
  await entry.getByLabel('Quantity', { exact: true }).fill('2');
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/variants') && r.request().method() === 'POST',
  );
  await entry.getByRole('button', { name: 'Save · Variants', exact: true }).click();
  assert.equal((await saved).status(), 201);
  await page.waitForFunction(() => !document.querySelector('fieldset:disabled'));
  const variants = (
    await (await b.request.get(origin + '/api/v1/products?limit=100', { headers })).json()
  ).items;
  const child = variants.find((p) => p.parentId === base.id);
  assert.ok(child);
  assert.equal(child.onHand, 2);
  assert.equal(child.cost, '300');
  await entry.getByRole('button', { name: 'Reorder · ' + baseName, exact: true }).click();
  await page.getByRole('heading', { name: 'New purchase', exact: true }).waitFor();
  assert.equal(await page.locator('select[name=supplierId]').inputValue(), purchase.supplierId);
  await page.waitForFunction(
    (id) => document.querySelector('select[aria-label="Product 1"]')?.value === id,
    base.id,
  );
  assert.equal(await page.getByLabel('Product 1', { exact: true }).inputValue(), base.id);
  assert.equal(await page.getByLabel('Quantity', { exact: true }).inputValue(), '9');
  const expired = await post('products', {
    name: 'Browser expiry ' + randomUUID().slice(0, 6),
    sku: randomUUID(),
    category: 'Browser retail',
    type: 'goods',
    price: '1000',
    cost: '100',
    lowStock: 1,
    batchTracked: true,
  });
  await post('stock/opening', {
    productId: expired.id,
    quantity: 2,
    unitCost: '100',
    reason: 'Browser expired batch',
    direction: 'increase',
    expiresOn: '2020-01-01',
  });
  await page.goto(origin + '/?page=overview');
  await page.getByRole('heading', { name: 'Expiry alerts', exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + '/?page=rooms');
  await page.getByRole('heading', { name: 'Rooms & guests', exact: true }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: '/tmp/mybusiness-rooms-phone.png', fullPage: true });
  await page.evaluate(() => localStorage.setItem('mb-locale', 'fr'));
  await page.reload();
  await page.getByRole('heading', { name: 'Chambres et clients', exact: true }).waitFor();
  assert.equal(errors.length, 0, errors.join('\n'));
  await b.close();
  for (const [email, business, pageName, heading] of [
    ['kitchen@example.test', 'Restaurant Lac', 'kitchen', 'Kitchen'],
    ['housekeeping@example.test', 'Hôtel Lac', 'housekeeping', 'Housekeeping'],
  ]) {
    const { b } = await login(email, business);
    const p = await b.newPage();
    const responses = [];
    p.on('response', (r) => {
      if (r.url().includes('/api/v1/')) responses.push(r);
    });
    await p.goto(origin + '/?page=' + pageName);
    await p.getByRole('heading', { name: heading, exact: true }).waitFor();
    assert.equal(await p.getByRole('button', { name: 'Money', exact: true }).count(), 0);
    assert.equal(await p.getByRole('button', { name: 'Purchases', exact: true }).count(), 0);
    assert.equal(await p.locator('main').getByText(/BIF/).count(), 0);
    await p.setViewportSize({ width: 390, height: 844 });
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.ok(responses.every((r) => r.status() === 200));
    await b.close();
  }
  console.log(
    'Retail/hospitality browser smoke passed: variant opening stock, reorder, expiry alerts, booking/deposit/itemized checkout, cleaning, kitchen/payment, phone layout, French and restricted worker views.',
  );
} finally {
  await browser.close();
}
