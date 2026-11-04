# Industry workspace manual checklist

Use a demo database and Node 24+. Passwords come from the ignored `.env`; never copy them into a report. Record business/branch and preserve an operation key when retrying an uncertain response.

## Purchase → receive → pay (A)

1. Owner/Purchasing → Purchases → New purchase. Add an inline supplier and product, quantity/cost; Save as order.
2. Receive part of the order. For a batch product enter its expiry date. Confirm the received quantity and stock rise once and a receipt-backed supplier bill appears.
3. Owner/Accountant pays part, then the remaining balance. Supplier owed decreases; purchase stock is not expensed again on payment. Repeating an uncertain action creates no extra receipt/payment.

## Variant → sale → return and expiry (B)

1. Products → choose a base product in Variants. Enter attribute labels, distinct SKU/barcode, price and optional opening quantity/cost (expiry for a batch child); save. Each child keeps its own stock/cost. POS should show each child as a one-tap item.
2. Sell Blue/M, then return one unit. Only Blue/M stock changes; Red/L stays unchanged. Replaying an offline mobile sale for the same child posts once.
3. Create a goods product with batch expiry enabled. Receive an expired lot plus two future lots. Sell: the earliest valid lot is consumed first. Selling more than valid quantities must fail and preserve the cart. Return a unit: its original lot returns, and an expired lot remains unsellable.
4. Stock/Products show expired and soon-expiring quantities. Write off expired stock with an adjustment and reason. Transfer another valid lot: destination expiry/quantity must match; no second purchase is recorded.
5. Low-stock Reorder opens Purchases with suggested quantity, last supplier/cost when known. VAT-inclusive 1,180 BIF at 18% shows 180 VAT on the receipt; Money revenue is 1,000. Refund reverses the original VAT.
6. Expiry-tracked products must be sold online; ordinary products and variants retain offline recording/replay.

## Restaurant order → kitchen → payment (C)

1. `waiter@example.test` → Tables & orders. Choose a table/counter, tap items, Send. Append an item to an open order; preparation restarts. Cancelling consumes no stock.
2. `kitchen@example.test` → Kitchen. Cards show quantities/preparation data and no BIF/price/cost/payment. Start → Ready. Kitchen cannot open Money, suppliers or payments even by direct API request.
3. Restaurant owner/cashier opens a register through Sell if needed. Tables & orders → Ready/Served order → Collect payment. Receipt, stock, COGS and revenue post once. Repeat/retry cannot duplicate them.
4. For a service menu item save a recipe with a goods ingredient. Pay two meals. Ingredient stock, not service stock, decreases. Change the recipe and refund one meal: original ingredient quantity and cost must be restored. A direct goods menu item must not also deduct a recipe.

## Hotel booking → check-in → checkout → cleaning (D)

1. `hotel-owner@example.test` or receptionist → Rooms & guests → Book from a room card. Enter guest, dates/count and optional deposit. Another overlapping booking must fail. Booking/deposit must not create room revenue.
2. Check in the reservation. The room shows In use. Optionally prepare a restaurant order and charge it to this occupied room; no cash payment should be invented.
3. Checkout opens the guest bill. Add an extra, take full or partial payment, confirm. Invoice includes nights/extras/linked restaurant charge; deposits reduce the balance. Room revenue appears once, restaurant revenue/stock do not double. Any remaining balance stays owed and can be collected later.
4. `housekeeping@example.test` → Housekeeping. The room shows Needs cleaning → Start → Done → Available. No guest bills, rates or money are visible. A receptionist cannot open general finance/suppliers/team.
5. Cancel/no-show another reservation with a deposit. The held amount refunds to the original cash/bank account and those dates become bookable. Under-repair rooms cannot be checked in; repair completion requires cleaning.

## Presentation and security

- Repeat on a 390px phone viewport and tablet/desktop. No horizontal page overflow; one-screen cards/forms remain usable.
- Switch to French, refresh, and confirm translated labels persist.
- Switch branch; all operational queries/actions must use the selected branch. Guessed branch/tenant IDs and forged roles must fail.
- Review Money: accommodation versus restaurant revenue, guest deposits held, customer owed and stock value must agree with the journal. Deposits are liabilities, not sales.
- Room-charge credit notes, early-departure proration, deposit forfeiture, depreciation and advanced bar/serving-unit workflows remain outside this increment. Legacy stays need review; migrations do not invent historical revenue.
