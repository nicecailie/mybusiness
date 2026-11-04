# Industry workspaces — actual implementation status

Updated 4 November 2026. Source of truth: packages/domain/src/industries.ts, backend services and permission gates. This checkpoint completes Phase A shared purchasing/spending/workspace work. It does not complete Phases B–D.

## Gates and navigation

The catalog contains 25 industry IDs. A module is effective only when configured for that industry **and** present in implementedModules. Current effective-capability names: catalog, inventory, sales, crm, purchasing, invoicing, accounting, reporting, accommodation and restaurant. A coarse effective flag does not mean every advanced workflow in that module exists.

workspaceLinks selects actual direct links from the catalog navigation modules intersected with server-compatible role permissions. The small home-card list reuses those links, with permission-gated Money or operational facts. Legacy null-industry businesses preserve their existing shared capabilities. Products terminology comes from the en/fr industry catalog. Settings/Team are further permission controlled; expert invoice/report records remain under More rather than separate Bills/Receipts/Payables entries in the main navigation.

The shared base and services configurations now include invoicing because its existing implemented services were previously unreachable for configured businesses. No variant, batch, kitchen, reservation or property gate has been turned on to expose an unfinished specialist page.

## Per-industry status

| Industry ID            | Effective shared/basic modules                                                                          | Implemented / partial / deferred                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `clothing_store`       | catalog, inventory, sales, crm, purchasing, invoicing, accounting, reporting                            | Partial retail: shared A implemented; Phase B variants/batches/FEFO/VAT/reorder deferred                   |
| `furniture_store`      | catalog, inventory, sales, crm, purchasing, invoicing, accounting, reporting                            | Shared A where configured; specialized industry work deferred                                              |
| `grocery_store`        | catalog, inventory, sales, crm, purchasing, invoicing, accounting, reporting                            | Partial retail: shared A implemented; Phase B variants/batches/FEFO/VAT/reorder deferred                   |
| `hardware_store`       | catalog, inventory, sales, crm, purchasing, invoicing, accounting, reporting                            | Shared A where configured; specialized industry work deferred                                              |
| `other_retail`         | catalog, inventory, sales, crm, purchasing, invoicing, accounting, reporting                            | Partial retail: shared A implemented; Phase B variants/batches/FEFO/VAT/reorder deferred                   |
| `bar_pub`              | catalog, inventory, sales, crm, purchasing, invoicing, accounting, reporting, restaurant                | Partial: shared A + basic tables/orders/payment; Phase C lifecycle/kitchen/recipes deferred                |
| `restaurant`           | catalog, inventory, sales, crm, purchasing, invoicing, accounting, reporting, restaurant                | Partial: shared A + basic tables/orders/payment; Phase C lifecycle/kitchen/recipes deferred                |
| `fast_food`            | catalog, inventory, sales, crm, purchasing, invoicing, accounting, reporting, restaurant                | Partial: shared A + basic tables/orders/payment; Phase C lifecycle/kitchen/recipes deferred                |
| `guest_house`          | catalog, inventory, sales, crm, purchasing, invoicing, accounting, reporting, accommodation, restaurant | Partial: shared A + basic rooms/stays (and restaurant where configured); Phase D finance/cleaning deferred |
| `beverage_distributor` | catalog, inventory, sales, crm, purchasing, invoicing, accounting, reporting                            | Partial retail: shared A implemented; Phase B variants/batches/FEFO/VAT/reorder deferred                   |
| `hotel`                | catalog, inventory, sales, crm, purchasing, invoicing, accounting, reporting, accommodation, restaurant | Partial: shared A + basic rooms/stays (and restaurant where configured); Phase D finance/cleaning deferred |
| `spa_resort`           | catalog, inventory, sales, crm, purchasing, invoicing, accounting, reporting, accommodation, restaurant | Partial: shared A + basic rooms/stays (and restaurant where configured); Phase D finance/cleaning deferred |
| `real_estate_agency`   | crm, accounting, reporting                                                                              | Shared A where configured; specialized industry work deferred                                              |
| `construction_company` | catalog, inventory, sales, crm, purchasing, invoicing, accounting, reporting, purchasing                | Shared A where configured; specialized industry work deferred                                              |
| `property_management`  | crm, accounting, reporting                                                                              | Shared A where configured; specialized industry work deferred                                              |
| `gardening`            | catalog, inventory, sales, crm, purchasing, invoicing, accounting, reporting, invoicing                 | Shared A where configured; specialized industry work deferred                                              |
| `eyewear_store`        | catalog, inventory, sales, crm, purchasing, invoicing, accounting, reporting                            | Shared A where configured; specialized industry work deferred                                              |
| `fitness_center`       | catalog, inventory, sales, crm, purchasing, invoicing, accounting, reporting                            | Shared A where configured; specialized industry work deferred                                              |
| `pharmacy`             | catalog, inventory, sales, crm, purchasing, invoicing, accounting, reporting                            | Shared A where configured; specialized industry work deferred                                              |
| `hair_salon`           | catalog, inventory, sales, crm, purchasing, invoicing, accounting, reporting                            | Shared A where configured; specialized industry work deferred                                              |
| `handyman`             | catalog, inventory, sales, crm, purchasing, invoicing, accounting, reporting, invoicing                 | Shared A where configured; specialized industry work deferred                                              |
| `it_hardware_support`  | catalog, inventory, sales, crm, purchasing, invoicing, accounting, reporting                            | Shared A where configured; specialized industry work deferred                                              |
| `solar_energy_system`  | catalog, inventory, sales, crm, purchasing, invoicing, accounting, reporting, invoicing                 | Shared A where configured; specialized industry work deferred                                              |
| `electronic_store`     | catalog, inventory, sales, crm, purchasing, invoicing, accounting, reporting                            | Partial retail: shared A implemented; Phase B variants/batches/FEFO/VAT/reorder deferred                   |
| `cleaning_services`    | catalog, inventory, sales, crm, purchasing, invoicing, accounting, reporting, invoicing                 | Shared A where configured; specialized industry work deferred                                              |

## What exists

- Phase A: one Purchases list; inline supplier/order entry; partial receipt with automatic receipt-backed bill; partial/full pay; receipt/payment history; supplier owed/pending quantities; exact weighted-average inventory and existing journals.
- Money: journal-based sales/cost/profit, running versus equipment/other spending, current customer/supplier owed amounts, stock value, cash in/out, source-linked spending rows, product and category profit. Equipment is an asset; depreciation is out of scope. Cash is clearly separated from recognition/stock figures.
- Retail baseline: SKU/barcode, ordinary stock intake/adjustments, counts, transfers, POS, registers, returns and offline queues. Variants/batches/expiry and VAT are not implemented.
- Restaurant **does exist**: tables, unpaid orders and atomic payment through postSale with price checking. New/Preparing/Ready/Served lifecycle, kitchen price stripping, waiter/kitchen roles and recipes do not exist yet.
- Accommodation **does exist**: rooms and guest-linked stays, exact night totals and overlap locking. Stay creation still does not post revenue. Checkout/deposits/room charges/housekeeping are Phase D work and must not be claimed as implemented hotel finance.

## Provisioning and safe industry changes

Verified onboarding stores the requested industryId and selects the new owner's business/branch. Industry changes are not accepted by the strict business-update contract; the settings view warns that changing industry after setup is unavailable to protect existing transactions. There is no destructive conversion of historical business data.

Account registration/verification continues to require the existing configured email provider/sender. Demo identities are fictional, local-only fixtures. No new waiter/kitchen/receptionist/housekeeping roles were added in Phase A. See INDUSTRY_WORKSPACE_BASELINE.md and INDUSTRY_WORKSPACE_IMPLEMENTATION_REPORT.md for the phase plan, accounting assumptions, limits and actual tests.
