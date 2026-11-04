import 'dotenv/config';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox'],
});
try {
  const context = await browser.newContext();
  const origin = 'http://localhost:3000';
  const login = await context.request.post(origin + '/api/auth/sign-in/email', {
    headers: { Origin: origin },
    data: { email: process.env.DEMO_OWNER_EMAIL, password: process.env.DEMO_PASSWORD },
  });
  assert.equal(login.status(), 200, 'owner login');
  const choices = await (await context.request.get(origin + '/api/v1/contexts')).json();
  const selected = choices.find(
    (c) =>
      c.role === 'owner' && c.businessName === 'Maison Kivu' && c.branchName === 'Centre-ville',
  );
  assert.ok(selected);
  await context.addInitScript(
    (value) => localStorage.setItem('mb-context', value),
    selected.businessId + ':' + selected.branchId,
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + '/?page=purchases');
  await page.getByRole('heading', { name: 'Purchasing', exact: true }).waitFor();
  console.log('Owner purchasing page loaded');
  await page.getByRole('button', { name: 'New supplier', exact: true }).click();
  await page.getByLabel('Supplier name').fill('Browser supplier ' + Date.now());
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page
    .getByRole('heading', { name: 'New supplier', exact: true })
    .waitFor({ state: 'hidden' });
  await page.locator('#main').getByRole('button', { name: 'Purchases', exact: true }).click();
  await page.getByRole('button', { name: 'New purchase order', exact: true }).click();
  await page.locator('select[name="supplierId"]').selectOption({ index: 1 });
  await page
    .locator('label')
    .filter({ hasText: /^Product/ })
    .locator('select')
    .selectOption({ index: 1 });
  await page.getByLabel('Unit cost (BIF)', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page
    .getByRole('heading', { name: 'New purchase order', exact: true })
    .waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Order', exact: true }).first().click();
  await page.getByRole('button', { name: 'View', exact: true }).first().click();
  await page.getByRole('button', { name: 'Receive item', exact: true }).first().click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('heading', { name: 'Receive purchase item' }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Create bill', exact: true }).first().click();
  await page.getByLabel('Supplier invoice reference').fill('BROWSER-' + Date.now());
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('heading', { name: 'Create supplier bill' }).waitFor({ state: 'hidden' });
  await page.screenshot({
    path: '/tmp/mybusiness-purchases.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.reload();
  await page.getByRole('heading', { name: 'Purchasing', exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () => document.querySelector('.sidebar').getBoundingClientRect().right <= 0,
  );
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'No page-wide horizontal overflow',
  );
  await page.screenshot({
    path: '/tmp/mybusiness-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });

  await page.setViewportSize({ width: 1280, height: 900 });
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
  await page.locator('select[name="account"]').selectOption('1010 Bank');
  await page
    .getByLabel('Payment reference', { exact: true })
    .fill('BROWSER-CUSTOMER-' + Date.now());
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page
    .getByRole('heading', { name: 'Record confirmed payment', exact: true })
    .waitFor({ state: 'hidden' });
  await page.goto(origin + '/?page=expenses');
  await page.getByRole('button', { name: 'New category', exact: true }).click();
  await page.getByLabel('Category name', { exact: true }).fill('Browser expense ' + Date.now());
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page
    .getByRole('heading', { name: 'New expense category', exact: true })
    .waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Record expense', exact: true }).click();
  await page.locator('select[name="categoryId"]').selectOption({ index: 1 });
  await page.getByLabel('Amount (BIF)', { exact: true }).fill('50');
  await page.locator('select[name="account"]').selectOption('1010 Bank');
  await page.getByLabel('Description', { exact: true }).fill('Browser verified operating expense');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page
    .getByRole('heading', { name: 'Record expense', exact: true })
    .waitFor({ state: 'hidden' });
  await page.goto(origin + '/?page=reports');
  await page.getByRole('heading', { name: /Financial overview/ }).waitFor();
  await page.getByRole('button', { name: 'Compare previous period', exact: true }).click();
  await page.getByRole('heading', { name: /Previous period/ }).waitFor();
  await page.getByRole('button', { name: 'Branch performance', exact: true }).click();
  await page.getByRole('heading', { name: 'Branches you can access', exact: true }).waitFor();
  for (const [email, route, text] of [
    ['cashier@example.test', 'accounting', 'Access denied'],
    ['stock@example.test', 'purchases', 'Purchasing'],
  ]) {
    const roleContext = await browser.newContext();
    const response = await roleContext.request.post(origin + '/api/auth/sign-in/email', {
      headers: { Origin: origin },
      data: { email, password: process.env.DEMO_PASSWORD },
    });
    assert.equal(response.status(), 200);
    const rolePage = await roleContext.newPage();
    await rolePage.goto(origin + '/?page=' + route);
    await rolePage.getByRole('heading', { name: text, exact: true }).waitFor();
    await roleContext.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    'Browser smoke passed: owner supplier → purchase → receipt → bill, invoice → partial payment, expense → report, cashier denial, inventory navigation, deep-link refresh, mobile layout.',
  );
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await browser.close();
}
