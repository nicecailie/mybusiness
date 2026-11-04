# Manual verification checklist

Use isolated development data. Select the business **and branch** before each scenario. Only the owner should read the ignored `.env` for development credentials; never paste credentials into tickets. Existing demo identities cover owner, cashier, inventory and accountant. Add manager, purchasing and viewer through Team using unique test accounts; verify email before signing in. New operational labels are currently English in both locales.

## Owner

1. Sign in and select Maison Kivu / Centre-ville explicitly (the same identity also has a read-only context elsewhere).
2. Open Purchases → Suppliers. Create a supplier with contact, phone, email, address, tax reference and notes. Open details, edit, deactivate, and confirm an inactive supplier cannot be used for a new PO. Reactivate it.
3. Create two stock products with no opening stock. Create a draft PO: product A quantity 10 at 100 BIF, product B quantity 4 at 250 BIF. Total must be 2,000 BIF. Edit the draft, save, and order it. Confirm editing is then unavailable.
4. View the order. Receive 4 units of A. Inventory must be A=4/value=400; order must be partially received. Confirm the remaining quantity is 6. Reload and verify the receipt remains.
5. Receive all remaining items. Inventory must be A=10/value=1,000 and B=4/value=1,000; order must be received. Attempt a duplicate request with a new operation key through the API: expect rejection. Repeating the original key must return the original receipt without another movement.
6. Create one supplier bill per valued goods receipt, with a unique supplier reference and due date. The same receipt must not be billed twice. Pay 150 BIF against a 400 BIF bill; outstanding must be 250. Pay the remainder; outstanding must be zero. Attempt an overpayment; expect rejection. Inspect payment history.
7. Buy another 10 units of A at 200 BIF and receive them. A must be quantity 20/value 3,000 (weighted average 150 BIF). Sell 2 units; COGS must be 300 and remaining value 2,700. Supplier payment must not affect inventory or COGS.
8. Create an expense category, then a 50 BIF bank expense for today. Filter by date/category. Open Financial overview; operating expenses increase by 50 and net operating profit falls by 50. Reverse with a reason: a reversal journal must appear and the expense must remain in history. To correct an expense, reverse it and create the replacement; posted amounts are never overwritten.
9. Create a customer invoice for 2 units at 200 BIF. A draft must not affect stock/revenue. Issue it: inventory drops by 2, revenue increases by 400, COGS uses current weighted average, AR increases by 400. Reissuing must fail.
10. Record a 100 BIF customer payment. Receivable must be 300. Verify invoice payment history and Customers → Account & invoices. Print the invoice and confirm business, customer, branch, dates, item names, totals, paid amount and outstanding balance. Test a long customer/product name.
11. Link a **confirmed paid**, customer-associated POS sale to an invoice. Confirm no second stock movement, revenue posting or payment occurs. Unverified payment evidence/returned sales cannot be newly linked. The original receipt remains authoritative for later POS returns.
12. Products → Inventory operations: create a transfer of 3 units to Kinindo; send it. Source loses 3 and corresponding value; destination remains unchanged until receiving. Switch to Kinindo and receive: destination gains the exact value. Re-receiving must fail. Verify Inventory in transit debits/credits cancel across branches.
13. Create a physical stock count with expected 15/count 14. Finalize; an explicit negative adjustment and stock-variance journal must appear. Finalize again: reject. Create another count, sell one unit before finalizing, then finalize: reject as stale; stock must not be overwritten. Test a positive variance with a reviewed cost.
14. Team: create a purchasing user; change their role, deactivate, and confirm their existing authenticated session can no longer use the business API. Reactivate. An owner and your own access cannot be edited here. To add another branch, select that branch and add the existing email; the account/password remains unchanged. Deactivate the old branch membership only if access should move.
15. Compare Financial overview net revenue/COGS/expenses/stock losses/net operating profit with journals. Open Compare previous period and verify the immediately preceding equal-length date range. Open Branch performance and confirm only authorized financial branches appear. Compare current AR/AP with invoice/bill balances. Confirm the existing sales dashboard is understood as POS activity, whereas Financial overview includes issued credit invoices too.

## Manager

1. Repeat supplier → PO → receiving and operational reports in the assigned branch.
2. Manage cashier/inventory/purchasing/accountant/viewer memberships. Try creating or editing another manager: access must be denied. Try changing an owner or your own access: deny.
3. Confirm direct API requests are denied for unassigned businesses/branches even if IDs are known.

## Cashier

1. Open Overview. Confirm focused register status, your sales count/value today, POS, customers and receipts.
2. Open your register and complete a cash sale. Verify change, receipt, inventory decrease and balanced journal through an owner session.
3. Confirm no product cost, purchasing, expense, invoice, staff administration or accounting controls are exposed.
4. Open `?page=accounting`, `?page=reports` and `?page=team` directly: show access denied. Open `?page=expenses` and `?page=purchases`: show access unavailable.
5. Send authenticated direct requests to supplier/purchase/payable/expense/invoice/financial/stock-count/transfer endpoints: expect 403. Attempt a refund or stock adjustment: expect 403 under the default template.

## Inventory officer

1. Overview must show low-stock items and pending receipts/counts without financial profit metrics.
2. Open Purchases. The Purchases tab must be accessible even though supplier administration is unavailable. Receive an ordered item and verify inventory exactly once.
3. Create/finalize a count and send/receive a transfer within assigned branches.
4. Request supplier payments, financial reports, expenses, staff administration or POS settlement directly: deny.

## Purchasing officer

1. Create/edit/deactivate suppliers; create/edit/order/cancel draft or unreceived POs; receive partial/full orders.
2. Verify no supplier-payment, expense, staff, POS, stock-count or general financial-report access.
3. Try to cancel an order after any receipt: reject. Try receiving a cancelled order: reject.

## Accountant

1. View invoices/receivables, supplier bills/payments, expenses, financial reports and journals in the assigned branch.
2. Record partial payments and confirm AP/AR changes independently of inventory/revenue.
3. Compare journal-based P&L with existing sales/returns plus new issued invoices and expenses. Gross profit must not be labeled net profit.
4. POS creation and refunds are not granted by default. Direct sale/refund endpoints must deny access.
5. Change to another authorized branch and repeat balance checks. An unassigned branch must remain inaccessible.

## Viewer / auditor

1. View assigned reports, suppliers/purchases, invoices and expenses.
2. Confirm create/edit/order/receive/issue/pay/reverse/transfer/count/staff controls are absent.
3. Attempt each corresponding write endpoint directly: deny even when a valid owner role string is supplied by the client.
4. Confirm read-only visibility is still restricted by industry modules and business/branch assignment.

## Isolation and accounting invariants

- Use an owner from the second tenant. Guess the first tenant's supplier, product, order, bill, invoice, transfer and count IDs. Reads must return no record/deny; writes must not affect the first tenant.
- With valid access to both branches, verify PO/receipt/bill/invoice/expense/count records remain branch-specific. Suppliers/categories are business-wide. Transfers are visible only at the source/destination. A third branch cannot act on the transfer.
- For each product/branch, reconcile stock movements (opening + receipts + restockable returns + transfer in + positive adjustments − sales/invoice issues − damage/negative adjustments − transfer out) to quantity/value. Offline shortages remain explicitly provisional and block new valued receipts until reconciliation.
- Race receiving, invoice issue, payment, transfer receive and count finalize in two sessions. Same-key retries have one result; different-key overprocessing must reject. No partial stock/financial changes after a failed command.
- Check every journal balances. Check posted journal/receipt/payment records cannot be edited/deleted through runtime privileges. Close the period and verify a receipt/payment/expense/invoice issue rolls back entirely.
- Fractional receipt rounding: PO 1 unit at 1 BIF; receive 0.6 then 0.4. Total stock value must rise exactly 1 BIF; the zero-value final receipt remains auditable and needs no supplier liability.
- Inventory/AR/AP views are current balances, not historical as-of reports. Cash movement is the period's posted cash movement, not a bank balance or POS drawer count. Expense/invoice recognition uses today's business date.

## Existing functionality and UI

- Repeat POS, opening stock, product edit/archive/restore, customers, cash open/close/variance, partial restockable returns and damaged returns. Verify original receipts and COGS stay unchanged by product edits.
- Restaurant: tables, food/drink orders, unpaid totals, atomic payment through POS, price-change rejection and table availability. Accommodation: rooms, guest-linked stays, exact nights and overlap rejection. Stays remain bookings, not automatically recognized invoice revenue.
- Verify offline queue recovery, oversell warning/reconciliation and unverified electronic payment labeling. Do not count unverified evidence as cash.
- Open every new panel empty, populated, after server validation failure, during loading and after a network interruption. Retry an uncertain write with the same key; inputs remain frozen until resolved.
- Test 390px mobile and desktop widths: forms usable, tables scroll inside their panel, no page-wide overflow, sidebar opens/closes, focus/labels remain usable.
- Refresh `?page=purchases`, invoices, expenses, accounting and products; test back/forward. Switch tenant/branch and verify cached data/detail forms are cleared.
- Review seeded historical sales/journals/receipts after migration. No reset of business data is required. Optional native-device/hardware execution, full French localization and production deployment remain separate verification work.
