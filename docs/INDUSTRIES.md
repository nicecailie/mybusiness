# Industry onboarding and module availability

The central catalog is `packages/domain/src/industries.ts`. IDs are stable and persisted on `businesses.industry_id`; existing businesses keep `NULL` until an owner selects an industry. A business industry is shared by all its members. The API resolves the stored industry after verifying membership and role.

## Implemented modules

`catalog`, `inventory`, `sales` (cash POS), `crm` (customer directory), `accounting` (posted journal view), and `reporting` are the only implemented operational modules at this milestone. Direct API calls for an industry-disabled module, or one not in the implemented set, are rejected. Role permissions are checked separately. The current product has no subscription-entitlement service, so subscription access is not represented or claimed by this configuration.

All other module IDs in the catalog are configuration markers only. In particular, room/reservation management, restaurant tables and kitchen queue, pharmacy batches and expiry, property listings, construction projects, appointments, memberships, and service-job scheduling are unavailable. They are not exposed as working routes or dashboard actions.

## Catalog

| Category           | Industries                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------- |
| Retail             | Clothing store, Furniture store, Grocery store, Hardware store, Other retail              |
| Food & Hospitality | Bar and Pub, Restaurant, Fast Food, Guest House, Beverage distributor, Hotel, Spa Resort  |
| Real estate        | Real estate agency, Construction company, Property Management, Gardening                  |
| Health & Fitness   | Eyewear store, Fitness Center, Pharmacy, Hair salon                                       |
| Trades             | Handyman, IT hardware & support, Solar energy system, Electronic store, Cleaning services |

Every industry can use the shared customer directory and reports where enabled by its configuration. Retail, food, hospitality, construction, health and trades use the existing product/inventory/POS services when those services fit the industry. Real estate agency and property management currently enable customer records and reporting only; their property workflows and POS/catalog are unavailable. Industry-specific room, menu, batch, project, service or membership modules remain marked but unavailable until implemented.

Hotels and spa resorts compose the accommodation and food/bar module groups under one business identity. Those operational workflows are currently unavailable; only the shared implemented modules appear in the interface. Pharmacy has no hotel or restaurant module enabled.

## Provisioning and demo data

The combined account and business setup creates a verified account, then provisions a tenant, business, first branch and owner membership. The request key is required and retries with the same body return the original business. The schema function derives all identifiers server-side. Demo setup, when selected, marks the tenant as demo, seeds explicitly named sample customers and relevant products, initial stock and balanced opening journals where catalog/inventory are implemented, and opens a local demo cash register for supported POS industries. Unchecked setup creates no sample records.

Account creation requires `ALLOW_REGISTRATION=true`, `RESEND_API_KEY`, and a verified sender in `EMAIL_FROM`. Better Auth sends the verification link through Resend. After email confirmation, the onboarding flow resumes and provisions the business; unverified accounts cannot provision a tenant. Terms acceptance is recorded with the business; legal document URLs are optional and stored when configured.
