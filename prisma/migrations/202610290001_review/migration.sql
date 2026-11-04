-- Additive review migration; historical sale names, codes and prices stay immutable.
ALTER TABLE products ALTER COLUMN low_stock TYPE numeric(18,3);
ALTER TABLE stock_balances DROP CONSTRAINT stock_nonnegative;
ALTER TABLE stock_balances ALTER COLUMN on_hand TYPE numeric(18,3);
ALTER TABLE stock_balances ADD CONSTRAINT stock_value_supported CHECK (value >= 0 AND (on_hand > 0 OR value = 0));
ALTER TABLE stock_movements ALTER COLUMN quantity TYPE numeric(18,3);
ALTER TABLE sale_lines DROP CONSTRAINT sale_line_positive;
ALTER TABLE sale_lines ALTER COLUMN quantity TYPE numeric(18,3);
ALTER TABLE sale_lines ADD COLUMN discount numeric(20,0) NOT NULL DEFAULT 0;
ALTER TABLE sale_lines ADD CONSTRAINT sale_line_positive CHECK (quantity>0 AND unit_price>=0 AND discount>=0 AND total=round(unit_price*quantity)-discount AND total>=0 AND cost>=0);
ALTER TABLE return_lines ALTER COLUMN quantity TYPE numeric(18,3);
ALTER TABLE businesses ADD COLUMN nif text NOT NULL DEFAULT '', ADD COLUMN tva text NOT NULL DEFAULT '', ADD COLUMN offline_policy text NOT NULL DEFAULT 'warning_reason' CHECK (offline_policy IN ('warning_reason','manager_override'));
ALTER TABLE sales ADD COLUMN offline boolean NOT NULL DEFAULT false, ADD COLUMN device_id uuid, ADD COLUMN synced_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN valuation_pending boolean NOT NULL DEFAULT false;
UPDATE sales SET synced_at=created_at;
ALTER TABLE payments DROP CONSTRAINT payment_amount_check;
ALTER TABLE payments ADD COLUMN provider text, ADD COLUMN reference text;
ALTER TABLE payments ADD CONSTRAINT payment_amount_check CHECK (amount>0 AND method IN ('cash','card','mobile_money') AND status IN ('confirmed','recorded_unverified') AND direction IN ('in','out') AND (method <> 'mobile_money' OR (provider IN ('Lumicash','Ecocash','iHela') AND length(reference)>0)) AND ((method='cash' AND status='confirmed') OR (method<>'cash' AND status='recorded_unverified')));
CREATE TABLE offline_devices (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, business_id uuid NOT NULL, branch_id uuid NOT NULL, user_id text NOT NULL REFERENCES "user"(id), active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,business_id,branch_id,id), FOREIGN KEY(tenant_id,business_id,branch_id) REFERENCES branches(tenant_id,business_id,id));
ALTER TABLE sales ADD CONSTRAINT sale_device_fk FOREIGN KEY(tenant_id,business_id,branch_id,device_id) REFERENCES offline_devices(tenant_id,business_id,branch_id,id);
CREATE TABLE stock_discrepancies (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, business_id uuid NOT NULL, branch_id uuid NOT NULL, product_id uuid NOT NULL, sale_id uuid NOT NULL, opening numeric(18,3) NOT NULL, shortage numeric(18,3) NOT NULL CHECK(shortage>0), local_estimate numeric(18,3) NOT NULL, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','outstanding_fulfillment','resolved')), created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(tenant_id,business_id,branch_id,sale_id) REFERENCES sales(tenant_id,business_id,branch_id,id), FOREIGN KEY(tenant_id,business_id,product_id) REFERENCES products(tenant_id,business_id,id), UNIQUE(tenant_id,business_id,branch_id,id));
CREATE TABLE reconciliation_events (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, business_id uuid NOT NULL, branch_id uuid NOT NULL, discrepancy_id uuid NOT NULL, actor_id text NOT NULL REFERENCES "user"(id), reason text NOT NULL CHECK(length(reason)>=3), action text NOT NULL, reference_id uuid, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(tenant_id,business_id,branch_id,discrepancy_id) REFERENCES stock_discrepancies(tenant_id,business_id,branch_id,id));
CREATE TABLE business_documents (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, business_id uuid NOT NULL, name text NOT NULL, mime text NOT NULL CHECK(mime IN ('application/pdf','image/png','image/jpeg')), data text NOT NULL CHECK(length(data)<=280000), actor_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(tenant_id,business_id) REFERENCES businesses(tenant_id,id));
CREATE TABLE rooms (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, business_id uuid NOT NULL, branch_id uuid NOT NULL, name text NOT NULL, rate numeric(20,0) NOT NULL CHECK(rate>0), created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(tenant_id,business_id,branch_id) REFERENCES branches(tenant_id,business_id,id), UNIQUE(tenant_id,business_id,branch_id,id), UNIQUE(branch_id,name));
CREATE TABLE stays (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, business_id uuid NOT NULL, branch_id uuid NOT NULL, room_id uuid NOT NULL, customer_id uuid NOT NULL, check_in text NOT NULL, check_out text NOT NULL, nights integer NOT NULL CHECK(nights>0), rate numeric(20,0) NOT NULL CHECK(rate>0), total numeric(20,0) NOT NULL CHECK(total=rate*nights), actor_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), CHECK(check_in<check_out), FOREIGN KEY(tenant_id,business_id,branch_id,room_id) REFERENCES rooms(tenant_id,business_id,branch_id,id), FOREIGN KEY(tenant_id,business_id,customer_id) REFERENCES customers(tenant_id,business_id,id));
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['offline_devices','stock_discrepancies','reconciliation_events','business_documents','rooms','stays'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('CREATE POLICY business_scope ON %I USING(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND business_id=nullif(current_setting(''app.business_id'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND business_id=nullif(current_setting(''app.business_id'',true),'''')::uuid)',tab);
 IF tab <> 'business_documents' THEN
 EXECUTE format('CREATE POLICY branch_scope ON %I AS RESTRICTIVE USING(branch_id=nullif(current_setting(''app.branch_id'',true),'''')::uuid) WITH CHECK(branch_id=nullif(current_setting(''app.branch_id'',true),'''')::uuid)',tab);
 END IF;
 EXECUTE format('GRANT SELECT, INSERT ON %I TO mybusiness_app',tab);
 END LOOP;
END $$;
GRANT UPDATE ON stock_discrepancies TO mybusiness_app;
-- Only the selected business may be changed by the runtime connection.
CREATE POLICY business_update ON businesses FOR UPDATE USING(id=nullif(current_setting('app.business_id',true),'')::uuid AND tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(id=nullif(current_setting('app.business_id',true),'')::uuid AND tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
GRANT UPDATE(nif,tva,offline_policy) ON businesses TO mybusiness_app;

-- Registration delegates provisioning to the existing identity-checked routine.
ALTER FUNCTION provision_business_onboarding(text,text,jsonb) RENAME TO provision_business_base;
REVOKE EXECUTE ON FUNCTION provision_business_base(text,text,jsonb) FROM PUBLIC, mybusiness_app;
CREATE FUNCTION provision_business_onboarding(actor text, operation_key text, input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE result jsonb; extra jsonb; doc jsonb; ordinal integer:=0; configured jsonb;
BEGIN
 IF current_setting('app.user_id',true) IS DISTINCT FROM actor THEN RAISE EXCEPTION 'ONBOARDING_ACTOR_MISMATCH'; END IF;
 IF jsonb_array_length(coalesce(input->'projects','[]'::jsonb))>2 OR jsonb_array_length(coalesce(input->'documents','[]'::jsonb))>3 THEN RAISE EXCEPTION 'INVALID_ONBOARDING'; END IF;
 result:=provision_business_base(actor,operation_key,input);
 UPDATE businesses SET nif=coalesce(input->>'nif',''),tva=coalesce(input->>'tva','') WHERE id=(result->>'businessId')::uuid;
 -- Repeat requests do not insert the same documents again.
 IF NOT EXISTS(SELECT 1 FROM business_documents WHERE business_id=(result->>'businessId')::uuid) THEN
 FOR doc IN SELECT * FROM jsonb_array_elements(coalesce(input->'documents','[]'::jsonb)) LOOP
 INSERT INTO business_documents(id,tenant_id,business_id,name,mime,data,actor_id) VALUES(gen_random_uuid(),(result->>'tenantId')::uuid,(result->>'businessId')::uuid,doc->>'name',doc->>'mime',doc->>'data',actor);
 END LOOP;
 END IF;
 FOR extra IN SELECT * FROM jsonb_array_elements(coalesce(input->'projects','[]'::jsonb)) LOOP
 ordinal:=ordinal+1;
 configured:=provision_business_base(actor,operation_key||'_project_'||ordinal,(input-'projects'-'documents'-'nif'-'tva')||jsonb_build_object('companyName',extra->>'name','industryId',extra->>'industryId'));
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION provision_business_onboarding(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provision_business_onboarding(text,text,jsonb) TO mybusiness_app;

CREATE FUNCTION add_business_staff(actor text, tenant uuid, business uuid, branch uuid, staff_email text, staff_name text, staff_role text, password_hash text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE staff text; actor_role text;
BEGIN
 IF current_setting('app.user_id',true) IS DISTINCT FROM actor OR current_setting('app.business_id',true) IS DISTINCT FROM business::text THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT role INTO actor_role FROM memberships WHERE user_id=actor AND tenant_id=tenant AND business_id=business AND branch_id=branch AND active FOR SHARE;
 IF actor_role NOT IN ('owner','manager') OR actor_role IS NULL OR staff_role NOT IN ('manager','cashier','inventory','accountant','viewer') OR (actor_role='manager' AND staff_role='manager') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT id INTO staff FROM "user" WHERE lower(email)=lower(staff_email);
 IF staff IS NULL THEN
 staff:=gen_random_uuid()::text;
 INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES(staff,staff_name,lower(staff_email),false,now(),now());
 INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES(gen_random_uuid()::text,staff,'credential',staff,password_hash,now(),now());
 END IF;
 IF EXISTS(SELECT 1 FROM memberships WHERE user_id=staff AND branch_id=branch) THEN RAISE EXCEPTION 'STAFF_ALREADY_ADDED'; END IF;
 INSERT INTO memberships(id,user_id,tenant_id,business_id,branch_id,role,active) VALUES(gen_random_uuid(),staff,tenant,business,branch,staff_role,true);
 RETURN staff;
END $$;
REVOKE ALL ON FUNCTION add_business_staff(text,uuid,uuid,uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION add_business_staff(text,uuid,uuid,uuid,text,text,text,text) TO mybusiness_app;
CREATE FUNCTION list_business_staff(actor text, business uuid, branch uuid) RETURNS TABLE(id text,name text,email text,role text,active boolean) LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
 SELECT u.id,u.name,u.email,m.role,m.active FROM memberships m JOIN "user" u ON u.id=m.user_id WHERE m.business_id=business AND m.branch_id=branch AND current_setting('app.user_id',true)=actor AND EXISTS(SELECT 1 FROM memberships a WHERE a.user_id=actor AND a.business_id=business AND a.branch_id=branch AND a.active AND a.role IN ('owner','manager'));
$$;
REVOKE ALL ON FUNCTION list_business_staff(text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_business_staff(text,uuid,uuid) TO mybusiness_app;
