-- Existing posted spending remains on its original cost account.
ALTER TABLE expense_categories ADD COLUMN kind text NOT NULL DEFAULT 'running' CHECK(kind IN ('running','equipment','other')), ADD COLUMN system_key text;
CREATE UNIQUE INDEX expense_category_system_key ON expense_categories(tenant_id,business_id,system_key) WHERE system_key IS NOT NULL;
ALTER TABLE expenses ADD COLUMN posting_account text NOT NULL DEFAULT '6000 Operating expenses' CHECK(posting_account IN ('6000 Operating expenses','1500 Equipment','6100 Other spending'));
-- Add defaults without changing the classification of an existing category or expense.
INSERT INTO expense_categories(id,tenant_id,business_id,name,kind,system_key)
SELECT gen_random_uuid(),b.tenant_id,b.id,d.name,d.kind,d.key FROM businesses b CROSS JOIN (VALUES('Rent','running','rent'),('Utilities','running','utilities'),('Equipment','equipment','equipment'),('Other','other','other')) d(name,kind,key)
WHERE NOT EXISTS(SELECT 1 FROM expense_categories c WHERE c.tenant_id=b.tenant_id AND c.business_id=b.id AND (c.name=d.name OR c.system_key=d.key));
