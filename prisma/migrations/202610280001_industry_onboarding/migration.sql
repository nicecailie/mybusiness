ALTER TABLE businesses
  ADD COLUMN industry_id text,
  ADD COLUMN contact_name text,
  ADD COLUMN country text NOT NULL DEFAULT 'BI',
  ADD COLUMN phone text,
  ADD COLUMN company_size text,
  ADD COLUMN primary_interest text;

ALTER TABLE businesses ADD CONSTRAINT business_industry_id_check CHECK (
  industry_id IS NULL OR industry_id IN (
    'clothing_store','furniture_store','grocery_store','hardware_store','other_retail',
    'bar_pub','restaurant','fast_food','guest_house','beverage_distributor','hotel','spa_resort',
    'real_estate_agency','construction_company','property_management','gardening',
    'eyewear_store','fitness_center','pharmacy','hair_salon',
    'handyman','it_hardware_support','solar_energy_system','electronic_store','cleaning_services'
  )
);

ALTER TABLE products ADD COLUMN demo boolean NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN demo boolean NOT NULL DEFAULT false;

CREATE TABLE onboarding_submissions (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,idempotency_key)
);
REVOKE ALL ON onboarding_submissions FROM PUBLIC;
REVOKE ALL ON onboarding_submissions FROM mybusiness_app;

CREATE FUNCTION provision_business_onboarding(actor text, operation_key text, input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  payload_hash text := md5(input::text);
  saved_hash text;
  saved_result jsonb;
  tenant_key uuid;
  business_key uuid;
  branch_key uuid;
  product_key uuid;
  movement_key uuid;
  journal_key uuid;
  sample record;
  sample_value numeric;
  business_name text := btrim(input->>'companyName');
  industry_key text := input->>'industryId';
  account_email text := lower(btrim(input->>'email'));
  contact_name text := btrim(input->>'fullName');
  locale_key text := input->>'locale';
  country_key text := upper(input->>'country');
BEGIN
  IF current_setting('app.user_id', true) IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'ONBOARDING_ACTOR_MISMATCH' USING ERRCODE='42501';
  END IF;
  IF operation_key !~ '^[A-Za-z0-9_-]{16,100}$' THEN
    RAISE EXCEPTION 'IDEMPOTENCY_REQUIRED' USING ERRCODE='22023';
  END IF;
  IF contact_name IS NULL OR length(contact_name) NOT BETWEEN 2 AND 160
     OR business_name IS NULL OR length(business_name) NOT BETWEEN 2 AND 120
     OR industry_key NOT IN (
       'clothing_store','furniture_store','grocery_store','hardware_store','other_retail',
       'bar_pub','restaurant','fast_food','guest_house','beverage_distributor','hotel','spa_resort',
       'real_estate_agency','construction_company','property_management','gardening',
       'eyewear_store','fitness_center','pharmacy','hair_salon',
       'handyman','it_hardware_support','solar_energy_system','electronic_store','cleaning_services'
     ) THEN
    RAISE EXCEPTION 'INVALID_ONBOARDING' USING ERRCODE='22023';
  END IF;
  IF locale_key NOT IN ('en','fr') OR country_key !~ '^[A-Z]{2}$'
     OR input->>'companySize' NOT IN ('1-5','6-20','21-50','51-200','201+')
     OR input->>'primaryInterest' NOT IN ('company','explore') THEN
    RAISE EXCEPTION 'INVALID_ONBOARDING' USING ERRCODE='22023';
  END IF;
  IF account_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     OR coalesce(input->>'phone','') !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'INVALID_CONTACT' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "user" u WHERE u.id=actor AND u."emailVerified" AND lower(u.email)=account_email
  ) THEN
    RAISE EXCEPTION 'VERIFIED_ACCOUNT_REQUIRED' USING ERRCODE='42501';
  END IF;

  INSERT INTO onboarding_submissions(user_id,idempotency_key,payload_hash)
  VALUES(actor,operation_key,payload_hash)
  ON CONFLICT(user_id,idempotency_key) DO NOTHING;
  SELECT payload_hash,result INTO saved_hash,saved_result
    FROM onboarding_submissions WHERE user_id=actor AND idempotency_key=operation_key FOR UPDATE;
  IF saved_hash IS DISTINCT FROM payload_hash THEN
    RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='23505';
  END IF;
  IF saved_result IS NOT NULL THEN RETURN saved_result; END IF;

  tenant_key := gen_random_uuid();
  business_key := gen_random_uuid();
  branch_key := gen_random_uuid();
  INSERT INTO tenants(id,name,demo) VALUES(tenant_key,business_name,coalesce((input->>'demoData')::boolean,false));
  INSERT INTO businesses(id,tenant_id,name,currency,timezone,locale,industry_id,contact_name,country,phone,company_size,primary_interest)
  VALUES(business_key,tenant_key,business_name,'BIF','Africa/Bujumbura',locale_key,industry_key,contact_name,country_key,input->>'phone',input->>'companySize',input->>'primaryInterest');
  INSERT INTO branches(id,tenant_id,business_id,name)
  VALUES(branch_key,tenant_key,business_key,CASE WHEN locale_key='fr' THEN 'Centre-ville' ELSE 'Main branch' END);
  INSERT INTO memberships(id,user_id,tenant_id,business_id,branch_id,role,active)
  VALUES(gen_random_uuid(),actor,tenant_key,business_key,branch_key,'owner',true);

  IF coalesce((input->>'demoData')::boolean,false) THEN
    IF industry_key NOT IN ('real_estate_agency','property_management') THEN
      FOR sample IN SELECT * FROM jsonb_to_recordset(CASE industry_key
        WHEN 'clothing_store' THEN '[{"name":"Demo cotton T-shirt","sku":"DEMO-TOP-01","category":"Clothing","kind":"goods","price":18000,"cost":12000}]'::jsonb
        WHEN 'furniture_store' THEN '[{"name":"Demo wooden chair","sku":"DEMO-FUR-01","category":"Furniture","kind":"goods","price":85000,"cost":60000}]'::jsonb
        WHEN 'grocery_store' THEN '[{"name":"Demo rice 1 kg","sku":"DEMO-GRO-01","category":"Groceries","kind":"goods","price":5000,"cost":3500}]'::jsonb
        WHEN 'hardware_store' THEN '[{"name":"Demo claw hammer","sku":"DEMO-HDW-01","category":"Tools","kind":"goods","price":22000,"cost":15000}]'::jsonb
        WHEN 'bar_pub' THEN '[{"name":"Demo soft drink","sku":"DEMO-BAR-01","category":"Beverages","kind":"goods","price":4000,"cost":2500}]'::jsonb
        WHEN 'restaurant' THEN '[{"name":"Demo lunch plate","sku":"DEMO-MNU-01","category":"Menu","kind":"service","price":18000,"cost":10000}]'::jsonb
        WHEN 'fast_food' THEN '[{"name":"Demo burger meal","sku":"DEMO-FF-01","category":"Menu","kind":"service","price":16000,"cost":9000}]'::jsonb
        WHEN 'guest_house' THEN '[{"name":"Demo guest welcome kit","sku":"DEMO-GH-01","category":"Guest supplies","kind":"goods","price":9000,"cost":6000}]'::jsonb
        WHEN 'beverage_distributor' THEN '[{"name":"Demo beverage crate","sku":"DEMO-BEV-01","category":"Beverages","kind":"goods","price":36000,"cost":26000}]'::jsonb
        WHEN 'hotel' THEN '[{"name":"Demo guest travel kit","sku":"DEMO-HOT-01","category":"Guest supplies","kind":"goods","price":12000,"cost":8000}]'::jsonb
        WHEN 'spa_resort' THEN '[{"name":"Demo spa service","sku":"DEMO-SPA-01","category":"Spa services","kind":"service","price":30000,"cost":12000}]'::jsonb
        WHEN 'construction_company' THEN '[{"name":"Demo cement bag","sku":"DEMO-CON-01","category":"Materials","kind":"goods","price":32000,"cost":25000}]'::jsonb
        WHEN 'gardening' THEN '[{"name":"Demo garden maintenance","sku":"DEMO-GAR-01","category":"Services","kind":"service","price":25000,"cost":12000}]'::jsonb
        WHEN 'eyewear_store' THEN '[{"name":"Demo frame","sku":"DEMO-EYE-01","category":"Frames","kind":"goods","price":45000,"cost":28000}]'::jsonb
        WHEN 'fitness_center' THEN '[{"name":"Demo day pass","sku":"DEMO-FIT-01","category":"Memberships","kind":"service","price":10000,"cost":2000}]'::jsonb
        WHEN 'pharmacy' THEN '[{"name":"Demo first-aid kit","sku":"DEMO-PHA-01","category":"First aid","kind":"goods","price":24000,"cost":15000}]'::jsonb
        WHEN 'hair_salon' THEN '[{"name":"Demo haircut service","sku":"DEMO-SAL-01","category":"Services","kind":"service","price":18000,"cost":4000}]'::jsonb
        WHEN 'handyman' THEN '[{"name":"Demo repair service","sku":"DEMO-HAN-01","category":"Services","kind":"service","price":25000,"cost":10000}]'::jsonb
        WHEN 'it_hardware_support' THEN '[{"name":"Demo keyboard","sku":"DEMO-IT-01","category":"Hardware","kind":"goods","price":35000,"cost":24000}]'::jsonb
        WHEN 'solar_energy_system' THEN '[{"name":"Demo solar lamp","sku":"DEMO-SOL-01","category":"Solar equipment","kind":"goods","price":45000,"cost":33000}]'::jsonb
        WHEN 'electronic_store' THEN '[{"name":"Demo LED desk lamp","sku":"DEMO-ELC-01","category":"Electronics","kind":"goods","price":28000,"cost":19000}]'::jsonb
        WHEN 'cleaning_services' THEN '[{"name":"Demo office cleaning","sku":"DEMO-CLN-01","category":"Services","kind":"service","price":40000,"cost":18000}]'::jsonb
        ELSE '[{"name":"Demo sample item","sku":"DEMO-ITEM-01","category":"Sample items","kind":"goods","price":10000,"cost":7000}]'::jsonb
      END) AS p(name text,sku text,category text,kind text,price numeric,cost numeric)
      LOOP
        product_key := gen_random_uuid();
        movement_key := gen_random_uuid();
        journal_key := gen_random_uuid();
        sample_value := sample.cost * 5;
        INSERT INTO products(id,tenant_id,business_id,name,sku,category,type,price,low_stock,demo)
          VALUES(product_key,tenant_key,business_key,sample.name,sample.sku,sample.category,sample.kind,sample.price,5,true);
        INSERT INTO stock_balances(id,tenant_id,business_id,branch_id,product_id,on_hand,value)
          VALUES(gen_random_uuid(),tenant_key,business_key,branch_key,product_key,
            CASE WHEN sample.kind='goods' THEN 5 ELSE 0 END,
            CASE WHEN sample.kind='goods' THEN sample_value ELSE 0 END);
        IF sample.kind='goods' THEN
          INSERT INTO stock_movements(id,tenant_id,business_id,branch_id,product_id,quantity,value,source_type,source_id,reason,actor_id)
            VALUES(movement_key,tenant_key,business_key,branch_key,product_key,5,sample_value,'demo_opening',movement_key,'Demo sample stock',actor);
          INSERT INTO journals(id,tenant_id,business_id,branch_id,source_type,source_id)
            VALUES(journal_key,tenant_key,business_key,branch_key,'demo_opening',movement_key);
          INSERT INTO journal_lines(id,tenant_id,business_id,branch_id,journal_id,account,debit,credit)
            VALUES(gen_random_uuid(),tenant_key,business_key,branch_key,journal_key,'1200 Inventory',sample_value,0),
                  (gen_random_uuid(),tenant_key,business_key,branch_key,journal_key,'3000 Opening equity',0,sample_value);
        END IF;
      END LOOP;
    END IF;
    INSERT INTO customers(id,tenant_id,business_id,name,phone,email,demo)
      VALUES(gen_random_uuid(),tenant_key,business_key,'Demo customer one','','',true),
            (gen_random_uuid(),tenant_key,business_key,'Demo customer two','','',true);
    IF industry_key NOT IN ('real_estate_agency','property_management') THEN
      INSERT INTO cash_sessions(id,tenant_id,business_id,branch_id,user_id,status,opening_float)
        VALUES(gen_random_uuid(),tenant_key,business_key,branch_key,actor,'open',0);
    END IF;
  END IF;

  saved_result := jsonb_build_object('tenantId',tenant_key,'businessId',business_key,'branchId',branch_key,'industryId',industry_key);
  UPDATE onboarding_submissions SET result=saved_result WHERE user_id=actor AND idempotency_key=operation_key;
  RETURN saved_result;
END;
$$;
REVOKE ALL ON FUNCTION provision_business_onboarding(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provision_business_onboarding(text,text,jsonb) TO mybusiness_app;
