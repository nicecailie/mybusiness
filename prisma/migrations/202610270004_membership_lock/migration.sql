ALTER TABLE memberships ADD CONSTRAINT membership_user_fk FOREIGN KEY(user_id) REFERENCES "user"(id);
-- Read-only runtime membership access with a narrow row-locking function.
CREATE FUNCTION lock_membership(actor text,tenant uuid,business uuid,branch uuid) RETURNS TABLE(role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF actor IS DISTINCT FROM current_setting('app.user_id',true) THEN RETURN; END IF;
 RETURN QUERY SELECT m.role FROM memberships m WHERE m.user_id=actor AND m.tenant_id=tenant AND m.business_id=business AND m.branch_id=branch AND m.active FOR SHARE;
END $$;
REVOKE ALL ON FUNCTION lock_membership(text,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_membership(text,uuid,uuid,uuid) TO mybusiness_app;
