# Industry workspace manual checklist

Checkpoint: Phase A implemented; B/C/D not started. Use a fictional development database and select the business/branch explicitly. Automated browser checks do not replace all human/device checks below.

## Purchase → receive → pay (implemented A)

1. Owner: open Purchases, choose New purchase, use + New supplier in the same form, add product A (10 × 100 BIF) and Save as order. No supplier page or order-submission wizard is required.
2. On its row, Receive → change actual quantity to 4 → Confirm. It must show 4 of 10 and 400 BIF owed. No manual bill creation. Double-click/retry the same action; stock, bill and journals must exist exactly once.
3. Mark paid → enter 100 → Confirm: Part paid, 300 owed. Mark paid → Confirm full remaining: 0 owed for received goods, while 6 remain to receive. Receive the remaining 6 and pay 600. The row must show 10 of 10, Paid, no further receive/pay button.
4. Open Details on the row: two deliveries and all actual payments. Open Suppliers on this same screen: branch-scoped pending quantity/owed balance agrees with the rows. Legacy received-but-unbilled deliveries remain included in owed totals.
5. Inventory user: Receive is available, owed amounts and Mark paid are unavailable; direct payment endpoint must return 403. Purchasing user can create/order/receive but cannot pay. Cashier cannot open purchase/Money endpoints. Accountant can pay but cannot create a POS sale.
6. Cancel an unreceived order. A partially received order cannot be cancelled. Submit an over-receipt or overpayment directly: reject with no partial data changes. Close a period and retry receiving: receipt, stock and auto-bill must all roll back.

## Running cost / Equipment → Money (implemented A)

1. Costs → Record a cost → choose the default Equipment type, enter 10,000 BIF and a description → Save. It is paid spending, but must not reduce running-cost profit. Money shows equipment separately and cash out if paid in cash. A bank payment must not appear in cash out.
2. Record 50 BIF Running cost. Money running costs increase 50 and profit after costs falls 50. Stock receipts must not appear as running costs. A supplier payment reduces owed and cash/bank, not profit or stock again.
3. Undo an equipment cost with a reason. Its history remains and the original asset entry is reversed. Changing a category later must not rewrite the posted account of old expenses.
4. Choose Money dates. Sales/costs/cash use that period; owed/stock are clearly labeled current. Open a spending row: it leads back to its purchase/cost source. Tap product profit and stock value to inspect the supporting list.
5. Toggle EN/FR and refresh: Purchases, statuses, forms, Money and Costs stay translated. Test 390px phone/tablet: row action buttons remain usable, no page-wide horizontal overflow, dates and forms have labels. Test network interruption: input is retained, uncertain actions retry the same key, and double submit is blocked.
6. Create a grocery/restaurant/hotel business using verified onboarding: stored industryId and owner-selected context agree. Direct industry changes are rejected; settings warns. Property businesses do not gain catalog/POS/purchasing links just because an owner has broad role grants.

## Retail sale with a variant (pending B — cannot verify yet)

Target scenario: Products quick grid adds size/colour SKUs; POS selects one variant; sell offline then replay once; only that variant stock changes. A batch-tracked item uses earliest unexpired stock and rejects expired sales. **Blocked:** no variants, batches/FEFO, expiry-sale guard, VAT or reorder prefill exists at this checkpoint. Ordinary SKU POS/offline/returns/counts/transfers regression tests pass separately.

## Restaurant order → kitchen → pay (pending C)

Target scenario: waiter taps a table, adds items and sends; kitchen starts/readies without seeing prices; cashier pays once, ingredient stock/revenue post once; cancelled unpaid orders consume nothing. **Blocked:** new lifecycle, waiter/kitchen roles, price-stripped kitchen API and recipes are not implemented. Existing table/order → POS payment remains usable and is covered by the review suite; restaurant stock still changes at payment.

## Hotel booking → check-in → checkout → cleaning (pending D)

Target scenario: receptionist books a room/guest/deposit, overlapping booking is rejected, checks in, bills room/extras/linked restaurant items once at checkout, takes payment, housekeeping marks room clean. **Blocked:** deposit/checkout finance, room status lifecycle, restaurant room charges, receptionist/housekeeping roles and cleaning are not implemented. Existing room/stay overlap checks pass, but stays still produce no financial revenue.

## Accounting assumptions to approve before production

- Equipment is a business asset, with no depreciation calculation in A.
- Existing restaurant stock is deducted at payment; C retains that assumption.
- D is planned to recognize hotel revenue at checkout and hold guest deposits until billing; it is not yet implemented.
- VAT is not configured or added; Phase B requires an explicit reviewed rate/tax policy.
- Financial recognition still uses the existing journal posting date; historical backdating is outside this checkpoint.
