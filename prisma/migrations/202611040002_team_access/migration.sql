GRANT DELETE ON purchase_lines TO mybusiness_app;
CREATE FUNCTION update_business_staff(actor text, tenant uuid, business uuid, branch uuid, staff text, new_role text, enabled boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE actor_role text; old_role text;
BEGIN
 IF current_setting('app.user_id',true) IS DISTINCT FROM actor OR current_setting('app.business_id',true) IS DISTINCT FROM business::text OR current_setting('app.branch_id',true) IS DISTINCT FROM branch::text OR actor=staff THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT role INTO actor_role FROM memberships WHERE user_id=actor AND tenant_id=tenant AND business_id=business AND branch_id=branch AND active FOR SHARE;
 SELECT role INTO old_role FROM memberships WHERE user_id=staff AND tenant_id=tenant AND business_id=business AND branch_id=branch FOR UPDATE;
 IF actor_role IS NULL OR actor_role NOT IN ('owner','manager') OR old_role IS NULL OR old_role='owner' OR new_role NOT IN ('manager','cashier','inventory','purchasing','accountant','viewer') OR (actor_role='manager' AND (old_role='manager' OR new_role='manager')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 UPDATE memberships SET role=new_role,active=enabled WHERE user_id=staff AND tenant_id=tenant AND business_id=business AND branch_id=branch;
END $$;
REVOKE ALL ON FUNCTION update_business_staff(text,uuid,uuid,uuid,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_business_staff(text,uuid,uuid,uuid,text,text,boolean) TO mybusiness_app;
