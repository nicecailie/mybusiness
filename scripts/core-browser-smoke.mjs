import 'dotenv/config';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
  (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext(),
    origin = 'http://localhost:3000';
  const login = await context.request.post(origin + '/api/auth/sign-in/email', {
    headers: { Origin: origin },
    data: { email: process.env.DEMO_OWNER_EMAIL, password: process.env.DEMO_PASSWORD },
  });
  assert.equal(login.status(), 200);
  const choices = await (await context.request.get(origin + '/api/v1/contexts')).json(),
    c = choices.find(
      (c) =>
        c.role === 'owner' && c.businessName === 'Maison Kivu' && c.branchName === 'Centre-ville',
    );
  assert.ok(c);
  await context.addInitScript(
    (value) => {
      localStorage.setItem('mb-context', value);
    },
    c.businessId + ':' + c.branchId,
  );
  const page = await context.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + '/?page=purchases');
  await page.getByRole('heading', { name: 'Purchases', exact: true }).waitFor();
  await page.getByRole('button', { name: 'New purchase', exact: true }).click();
  await page.getByRole('button', { name: '+ New supplier', exact: true }).click();
  const name = 'Inline browser supplier ' + Date.now();
  await page.getByLabel('Supplier name', { exact: true }).fill(name);
  const select = page.locator('form select').first();
  await select.selectOption({ index: 1 });
  await page.getByLabel('Quantity', { exact: true }).fill('10');
  await page.getByLabel('Unit cost (BIF)', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Save as order', exact: true }).click();
  await page
    .getByRole('heading', { name: 'New purchase', exact: true })
    .waitFor({ state: 'hidden' });
  const row = page.getByRole('row').filter({ hasText: name });
  await row.getByRole('button', { name: 'Receive', exact: true }).click();
  await page.locator('form input[type="number"]').first().fill('4');
  await page.getByRole('button', { name: 'Confirm received items', exact: true }).click();
  await row.getByText('4 of 10', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Create bill', exact: true }).count(), 0);
  await row.getByRole('button', { name: 'Mark paid', exact: true }).click();
  await page.getByLabel('Amount (BIF)', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Confirm payment', exact: true }).click();
  await row.getByText('Part paid', { exact: false }).waitFor();
  await row.getByRole('button', { name: 'Mark paid', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm payment', exact: true }).click();
  await row.getByRole('button', { name: 'Receive', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm received items', exact: true }).click();
  await row.getByText('10 of 10', { exact: false }).waitFor();
  await row.getByRole('button', { name: 'Mark paid', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm payment', exact: true }).click();
  await row.getByRole('button', { name: 'Details', exact: true }).click();
  await row.getByRole('heading', { name: 'Payment history', exact: true }).waitFor();
  await row.getByRole('button', { name: 'Mark paid', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await row.getByRole('button', { name: 'Mark paid', exact: true }).count(), 0);
  await page.screenshot({
    path: '/tmp/industry-purchases.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.reload();
  await page.getByRole('heading', { name: 'Purchases', exact: true }).waitFor();
  // Set locale after init scripts have run so French is exercised on a restored page.
  await page.locator('.language-button').click();
  await page.getByRole('heading', { name: 'Achats', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: 'Achats', exact: true }).waitFor();
  await row.getByText('10 sur 10', { exact: false }).waitFor();
  await page.getByRole('columnheader', { name: 'Payé?', exact: true }).waitFor();
  await page.screenshot({
    path: '/tmp/industry-purchases-fr.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.locator('.language-button').click();
  await page.goto(origin + '/?page=expenses');
  await page.getByRole('button', { name: 'Record a cost', exact: true }).click();
  const equipment = await page
    .locator('select[name="categoryId"] option')
    .evaluateAll(
      (options) => options.find((o) => o.textContent === 'Equipment · Equipment')?.value,
    );
  assert.ok(equipment);
  await page.locator('select[name="categoryId"]').selectOption(equipment);
  await page.getByLabel('Amount (BIF)', { exact: true }).fill('10000');
  await page
    .getByLabel('What did you pay for?', { exact: true })
    .fill('Browser equipment ' + Date.now());
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page
    .getByRole('heading', { name: 'Record a cost', exact: true })
    .waitFor({ state: 'hidden' });
  await page.goto(origin + '/?page=money');
  await page.getByRole('heading', { name: 'Money', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Spending by type', exact: true }).waitFor();
  await page.getByRole('button', { name: /Equipment.*BIF/ }).click();
  await page.getByRole('columnheader', { name: 'Kind', exact: true }).waitFor();
  await page.screenshot({
    path: '/tmp/industry-money.png',
    fullPage: true,
    animations: 'disabled',
  });
  // Retain the expert reporting regression checks as well as the new plain Money view.
  await page.goto(origin + '/?page=reports');
  await page.getByRole('heading', { name: /Financial overview/ }).waitFor();
  await page.getByRole('button', { name: 'Compare previous period', exact: true }).click();
  await page.getByRole('heading', { name: /Previous period/ }).waitFor();
  await page.getByRole('button', { name: 'Branch performance', exact: true }).click();
  await page.getByRole('heading', { name: 'Branches you can access', exact: true }).waitFor();
  // Existing invoice UI remains functional; POS and specialist flows have separate regression suites.
  await page.goto(origin + '/?page=invoices');
  await page.getByRole('button', { name: 'New invoice', exact: true }).click();
  await page.locator('select[name="customerId"]').selectOption({ index: 1 });
  await page
    .locator('label')
    .filter({ hasText: /^Product/ })
    .locator('select')
    .selectOption({ index: 1 });
  await page.getByLabel('Unit price (BIF)', { exact: true }).fill('200');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page
    .getByRole('heading', { name: 'New customer invoice', exact: true })
    .waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Issue', exact: true }).first().click();
  await page.getByRole('button', { name: 'Record payment', exact: true }).first().click();
  await page.getByLabel('Amount (BIF)', { exact: true }).fill('100');
  await page.getByLabel('Payment reference', { exact: true }).fill('Browser invoice ' + Date.now());
  await page.locator('select[name="account"]').selectOption('1010 Bank');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page
    .getByRole('heading', { name: 'Record confirmed payment', exact: true })
    .waitFor({ state: 'hidden' });
  await page.goto(origin + '/?page=purchases');
  await page.getByRole('heading', { name: 'Purchases', exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () => document.querySelector('.sidebar').getBoundingClientRect().right <= 0,
  );
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'No page-wide overflow',
  );
  await page.screenshot({
    path: '/tmp/industry-phone.png',
    fullPage: true,
    animations: 'disabled',
  });
  // Authentication has a real three-sign-in/ten-second window; actions above naturally separate these logins.
  for (const [email, route, heading] of [
    ['cashier@example.test', 'money', 'You do not have access to this screen.'],
    ['stock@example.test', 'purchases', 'Purchases'],
  ]) {
    const ctx = await browser.newContext();
    const login = await ctx.request.post(origin + '/api/auth/sign-in/email', {
      headers: { Origin: origin },
      data: { email, password: process.env.DEMO_PASSWORD },
    });
    assert.equal(login.status(), 200);
    const p = await ctx.newPage();
    await p.goto(origin + '/?page=' + route);
    if (route === 'money') await p.getByText(heading, { exact: true }).waitFor();
    else {
      await p.getByRole('heading', { name: heading, exact: true }).waitFor();
      assert.equal(await p.getByRole('button', { name: 'Mark paid', exact: true }).count(), 0);
    }
    await ctx.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    'Browser passed: one-screen inline purchase → partial/full receive/auto-bill → partial/full pay; English/French; equipment spending/Money; existing invoice/payment; refresh; phone; role denial.',
  );
} finally {
  await browser.close();
}
