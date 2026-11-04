import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  amount,
  cashTotals,
  assertBalanced,
  salePosting,
  reversePosting,
  can,
  safeCsv,
} from '../packages/domain/src/index.js';
import { saleSchema, returnSchema, reportSchema } from '../packages/contracts/src/index.js';
import { hasEffectiveModule, industryCatalog } from '../packages/domain/src/industries.js';
void test('cash and change stay exact and unsupported precision is rejected', () => {
  assert.equal(amount('999999999999999'), 999999999999999n);
  assert.deepEqual(
    cashTotals(
      [
        { price: '18500', quantity: 3 },
        { price: '3500', quantity: 2 },
      ],
      '100000',
    ),
    { total: '62500', change: '37500' },
  );
  assert.throws(() => amount('0.1'));
  assert.throws(() => cashTotals([{ price: '5', quantity: 1 }], '4'));
});
void test('sales and reversals balance with zero and positive costs', () => {
  for (const cost of ['0', '20000']) {
    const lines = salePosting('30000', cost);
    assert.doesNotThrow(() => assertBalanced(lines));
    assert.doesNotThrow(() => assertBalanced(reversePosting(lines)));
  }
  assert.throws(() =>
    assertBalanced([
      { account: 'cash', debit: '20', credit: '0' },
      { account: 'sales', debit: '0', credit: '19' },
    ]),
  );
  assert.throws(() =>
    assertBalanced([
      { account: 'cash', debit: '0', credit: '0' },
      { account: 'sales', debit: '0', credit: '0' },
    ]),
  );
});
void test('least privilege grants cannot be inferred from UI visibility', () => {
  assert.equal(can('cashier', 'sale.create'), true);
  assert.equal(can('cashier', 'sale.refund'), false);
  assert.equal(can('inventory', 'report.read'), false);
  assert.equal(can('viewer', 'stock.receive'), false);
});
void test('boundary validation accepts fractional units and rejects duplicate lines and reversed report dates', () => {
  const productId = '11111111-1111-4111-8111-111111111111';
  assert.equal(
    saleSchema.safeParse({
      lines: [
        { productId, quantity: 1 },
        { productId, quantity: 1 },
      ],
      tendered: '1',
      cashSessionId: productId,
    }).success,
    false,
  );
  assert.equal(
    returnSchema.safeParse({
      lines: [{ saleLineId: productId, quantity: 0.5, disposition: 'restockable' }],
      reason: 'reason',
      cashSessionId: productId,
    }).success,
    true,
  );
  assert.equal(reportSchema.safeParse({ from: '2026-10-27', to: '2026-10-01' }).success, false);
});
void test('CSV export neutralizes formula injection and quotes correctly', () => {
  assert.equal(safeCsv('=SUM(A1:A2)'), `"'=SUM(A1:A2)"`);
  assert.equal(safeCsv('a"b'), '"a""b"');
});
void test('industry catalog is complete, stable, and gates unavailable workflows', () => {
  assert.equal(industryCatalog.length, 25);
  assert.equal(new Set(industryCatalog.map((item) => item.id)).size, 25);
  assert.equal(
    industryCatalog.some((item) => /surveying/i.test(item.labels.en)),
    false,
  );
  const hotel = industryCatalog.find((item) => item.id === 'hotel')!;
  const pharmacy = industryCatalog.find((item) => item.id === 'pharmacy')!;
  assert.ok(hotel.enabledModules.includes('accommodation'));
  assert.ok(hotel.enabledModules.includes('restaurant'));
  assert.equal(pharmacy.enabledModules.includes('accommodation'), false);
  assert.equal(hasEffectiveModule('hotel', 'sales'), true);
  assert.equal(hasEffectiveModule('hotel', 'accommodation'), true);
  assert.equal(hasEffectiveModule('pharmacy', 'restaurant'), false);
  assert.equal(hasEffectiveModule(null, 'sales'), false);
});

void test('stored drafts reject malformed monetary values and retain a valid pending command shape', async () => {
  const { webDraftSchema } = await import('../packages/contracts/src/index.js');
  const id = '11111111-1111-4111-8111-111111111111';
  const valid = {
    lines: [{ productId: id, quantity: 1 }],
    tendered: '15000',
    customerId: '',
    operationId: id,
    pending: true,
    submitted: { lines: [{ productId: id, quantity: 1 }], tendered: '15000', cashSessionId: id },
  };
  assert.equal(webDraftSchema.safeParse(valid).success, true);
  assert.equal(webDraftSchema.safeParse({ ...valid, tendered: 'not money' }).success, false);
  assert.equal(
    webDraftSchema.safeParse({ ...valid, lines: [{ productId: id, quantity: -1 }] }).success,
    false,
  );
});
