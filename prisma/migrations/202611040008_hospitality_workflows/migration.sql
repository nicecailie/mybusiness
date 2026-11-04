-- Existing unpaid orders are open/served; paid orders and sales are unchanged.
ALTER TABLE restaurant_orders DROP CONSTRAINT restaurant_orders_status_check;
UPDATE restaurant_orders SET status='served' WHERE status='unpaid';
ALTER TABLE restaurant_orders ALTER COLUMN status SET DEFAULT 'new';
ALTER TABLE restaurant_orders ADD CHECK(status IN ('new','preparing','ready','served','paid','cancelled'));
ALTER TABLE memberships DROP CONSTRAINT member_role_check;
ALTER TABLE memberships ADD CONSTRAINT member_role_check CHECK(role IN ('owner','manager','cashier','inventory','purchasing','accountant','viewer','waiter','kitchen','receptionist','housekeeping'));
CREATE OR REPLACE FUNCTION add_business_staff(actor text, tenant uuid, business uuid, branch uuid, staff_email text, staff_name text, staff_role text, password_hash text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE staff text; actor_role text;
BEGIN
 IF current_setting('app.user_id',true) IS DISTINCT FROM actor OR current_setting('app.business_id',true) IS DISTINCT FROM business::text THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT role INTO actor_role FROM memberships WHERE user_id=actor AND tenant_id=tenant AND business_id=business AND branch_id=branch AND active FOR SHARE;
 IF actor_role NOT IN ('owner','manager') OR actor_role IS NULL OR staff_role NOT IN ('manager','cashier','inventory','purchasing','accountant','viewer','waiter','kitchen','receptionist','housekeeping') OR (actor_role='manager' AND staff_role='manager') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
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

CREATE OR REPLACE FUNCTION update_business_staff(actor text, tenant uuid, business uuid, branch uuid, staff text, new_role text, enabled boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE actor_role text; old_role text;
BEGIN
 IF current_setting('app.user_id',true) IS DISTINCT FROM actor OR current_setting('app.business_id',true) IS DISTINCT FROM business::text OR current_setting('app.branch_id',true) IS DISTINCT FROM branch::text OR actor=staff THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT role INTO actor_role FROM memberships WHERE user_id=actor AND tenant_id=tenant AND business_id=business AND branch_id=branch AND active FOR SHARE;
 SELECT role INTO old_role FROM memberships WHERE user_id=staff AND tenant_id=tenant AND business_id=business AND branch_id=branch FOR UPDATE;
 IF actor_role IS NULL OR actor_role NOT IN ('owner','manager') OR old_role IS NULL OR old_role='owner' OR new_role NOT IN ('manager','cashier','inventory','purchasing','accountant','viewer','waiter','kitchen','receptionist','housekeeping') OR (actor_role='manager' AND (old_role='manager' OR new_role='manager')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 UPDATE memberships SET role=new_role,active=enabled WHERE user_id=staff AND tenant_id=tenant AND business_id=business AND branch_id=branch;
END $$;
REVOKE ALL ON FUNCTION update_business_staff(text,uuid,uuid,uuid,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_business_staff(text,uuid,uuid,uuid,text,text,boolean) TO mybusiness_app;
