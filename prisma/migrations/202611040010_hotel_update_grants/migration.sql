-- Permit workflow updates without granting deletes or room-rate edits to the runtime role.
GRANT UPDATE(status) ON rooms TO mybusiness_app;
GRANT UPDATE(status,invoice_id,extras,checked_in_at,checked_out_at,legacy_unbilled) ON stays TO mybusiness_app;
CREATE UNIQUE INDEX hotel_service_kind_unique ON products(tenant_id,business_id,system_kind) WHERE system_kind IS NOT NULL;
