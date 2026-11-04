CREATE TABLE dining_tables (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, business_id uuid NOT NULL, branch_id uuid NOT NULL, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,business_id,branch_id,id), UNIQUE(branch_id,name), FOREIGN KEY(tenant_id,business_id,branch_id) REFERENCES branches(tenant_id,business_id,id));
CREATE TABLE restaurant_orders (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, business_id uuid NOT NULL, branch_id uuid NOT NULL, table_id uuid, sale_id uuid, lines jsonb NOT NULL, total numeric(20,0) NOT NULL CHECK(total>0), status text NOT NULL DEFAULT 'unpaid' CHECK(status IN ('unpaid','paid')), actor_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), CHECK((status='paid')=(sale_id IS NOT NULL)), UNIQUE(sale_id), FOREIGN KEY(tenant_id,business_id,branch_id,table_id) REFERENCES dining_tables(tenant_id,business_id,branch_id,id), FOREIGN KEY(tenant_id,business_id,branch_id,sale_id) REFERENCES sales(tenant_id,business_id,branch_id,id));
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['dining_tables','restaurant_orders'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('CREATE POLICY business_scope ON %I USING(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND business_id=nullif(current_setting(''app.business_id'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND business_id=nullif(current_setting(''app.business_id'',true),'''')::uuid)',tab);
 EXECUTE format('CREATE POLICY branch_scope ON %I AS RESTRICTIVE USING(branch_id=nullif(current_setting(''app.branch_id'',true),'''')::uuid) WITH CHECK(branch_id=nullif(current_setting(''app.branch_id'',true),'''')::uuid)',tab);
 EXECUTE format('GRANT SELECT,INSERT ON %I TO mybusiness_app',tab);
 END LOOP;
END $$;
GRANT UPDATE ON restaurant_orders TO mybusiness_app;
