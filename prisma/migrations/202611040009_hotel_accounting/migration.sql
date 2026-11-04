-- Additive workflow state. Legacy stays retain their historical totals; no backdated revenue is invented.
ALTER TABLE rooms ADD COLUMN status text NOT NULL DEFAULT 'available' CHECK(status IN ('available','needs_cleaning','cleaning','under_repair'));
ALTER TABLE stays ADD COLUMN status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','in_use','checked_out','cancelled','no_show')), ADD COLUMN guest_count integer NOT NULL DEFAULT 1 CHECK(guest_count BETWEEN 1 AND 100), ADD COLUMN invoice_id uuid, ADD COLUMN extras jsonb NOT NULL DEFAULT '[]', ADD COLUMN checked_in_at timestamptz, ADD COLUMN checked_out_at timestamptz, ADD COLUMN legacy_unbilled boolean NOT NULL DEFAULT false;
UPDATE stays SET legacy_unbilled=true;
ALTER TABLE stays ADD UNIQUE(tenant_id,business_id,branch_id,id), ADD FOREIGN KEY(tenant_id,business_id,branch_id,invoice_id) REFERENCES invoices(tenant_id,business_id,branch_id,id);
ALTER TABLE restaurant_orders ADD COLUMN stay_id uuid, ADD FOREIGN KEY(tenant_id,business_id,branch_id,stay_id) REFERENCES stays(tenant_id,business_id,branch_id,id);
ALTER TABLE sales ALTER COLUMN cash_session_id DROP NOT NULL;
ALTER TABLE sales ADD COLUMN settlement_kind text NOT NULL DEFAULT 'paid' CHECK(settlement_kind IN ('paid','room')), ADD COLUMN revenue_account text NOT NULL DEFAULT '4000 Sales';
-- Replace only the original combined sale amount constraint, preserving unrelated checks.
DO $$ DECLARE c record;BEGIN FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='sales'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%tendered%' LOOP EXECUTE format('ALTER TABLE sales DROP CONSTRAINT %I',c.conname);END LOOP;END $$;
ALTER TABLE sales ADD CHECK(total>0 AND cost>=0 AND ((settlement_kind='paid' AND cash_session_id IS NOT NULL AND tendered>=total AND change=tendered-total) OR (settlement_kind='room' AND cash_session_id IS NULL AND tendered=0 AND change=0 AND NOT offline)));
DO $$ DECLARE c record;BEGIN FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='finance_payments'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%account%' LOOP EXECUTE format('ALTER TABLE finance_payments DROP CONSTRAINT %I',c.conname);END LOOP;END $$;
ALTER TABLE finance_payments ADD CHECK(amount>0 AND ((bill_id IS NOT NULL)::int+(invoice_id IS NOT NULL)::int)=1 AND (account IN ('1000 Cash','1010 Bank') OR (account='2300 Guest deposits' AND invoice_id IS NOT NULL)));
CREATE TABLE guest_deposits(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,business_id uuid NOT NULL,branch_id uuid NOT NULL,stay_id uuid NOT NULL,amount numeric(20,0) NOT NULL CHECK(amount>0),kind text NOT NULL CHECK(kind IN ('received','refunded','applied')),account text NOT NULL CHECK(account IN ('1000 Cash','1010 Bank','2300 Guest deposits')),reference text NOT NULL,payment_id uuid,actor_id text NOT NULL REFERENCES "user"(id),created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(tenant_id,business_id,branch_id,stay_id) REFERENCES stays(tenant_id,business_id,branch_id,id),FOREIGN KEY(tenant_id,business_id,branch_id,payment_id) REFERENCES finance_payments(tenant_id,business_id,branch_id,id));
ALTER TABLE guest_deposits ENABLE ROW LEVEL SECURITY;ALTER TABLE guest_deposits FORCE ROW LEVEL SECURITY;
CREATE POLICY scope ON guest_deposits USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND business_id=nullif(current_setting('app.business_id',true),'')::uuid AND branch_id=nullif(current_setting('app.branch_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND business_id=nullif(current_setting('app.business_id',true),'')::uuid AND branch_id=nullif(current_setting('app.branch_id',true),'')::uuid);
GRANT SELECT,INSERT ON guest_deposits TO mybusiness_app;
-- Serialize overlapping reservations at the database boundary as well as in the API.
CREATE FUNCTION guard_stay_overlap() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('room:'||NEW.room_id::text,0));
 IF NEW.status IN ('reserved','in_use') AND EXISTS(SELECT 1 FROM stays WHERE room_id=NEW.room_id AND id<>NEW.id AND status IN ('reserved','in_use') AND check_in<NEW.check_out AND check_out>NEW.check_in) THEN RAISE EXCEPTION 'ROOM_UNAVAILABLE: overlapping reservation' USING ERRCODE='23514';END IF;
 RETURN NEW;END $$;
CREATE TRIGGER stay_overlap BEFORE INSERT OR UPDATE OF room_id,check_in,check_out,status ON stays FOR EACH ROW EXECUTE FUNCTION guard_stay_overlap();
REVOKE ALL ON FUNCTION guard_stay_overlap() FROM PUBLIC;
