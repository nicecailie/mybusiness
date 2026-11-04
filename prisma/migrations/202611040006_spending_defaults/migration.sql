-- Default reference categories for future businesses; no changes to old postings.
CREATE FUNCTION seed_spending_categories() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$ BEGIN
 INSERT INTO expense_categories(id,tenant_id,business_id,name,kind,system_key)
 SELECT gen_random_uuid(),NEW.tenant_id,NEW.id,d.name,d.kind,d.key FROM (VALUES('Rent','running','rent'),('Utilities','running','utilities'),('Equipment','equipment','equipment'),('Other','other','other')) d(name,kind,key) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION seed_spending_categories() FROM PUBLIC,mybusiness_app;
CREATE TRIGGER business_spending_defaults AFTER INSERT ON businesses FOR EACH ROW EXECUTE FUNCTION seed_spending_categories();
