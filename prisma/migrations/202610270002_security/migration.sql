CREATE SEQUENCE document_sequence;
GRANT USAGE ON SEQUENCE document_sequence TO mybusiness_app;
ALTER TABLE branches ADD CONSTRAINT branch_business_fk FOREIGN KEY (tenant_id,business_id) REFERENCES businesses(tenant_id,id);
ALTER TABLE businesses ADD CONSTRAINT business_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE memberships ADD CONSTRAINT member_branch_fk FOREIGN KEY (tenant_id,business_id,branch_id) REFERENCES branches(tenant_id,business_id,id);
ALTER TABLE memberships ADD CONSTRAINT member_role_check CHECK (role IN ('owner','manager','cashier','inventory','accountant','viewer'));
ALTER TABLE products ADD CONSTRAINT product_price_check CHECK (price>=0 AND low_stock>=0 AND type IN ('goods','service'));
ALTER TABLE stock_balances ADD CONSTRAINT stock_nonnegative CHECK (on_hand>=0 AND value>=0 AND (on_hand>0 OR value=0));
ALTER TABLE sale_lines ADD CONSTRAINT sale_line_positive CHECK (quantity>0 AND unit_price>=0 AND total=unit_price*quantity AND cost>=0);
ALTER TABLE return_lines ADD CONSTRAINT return_line_positive CHECK (quantity>0 AND total>=0 AND cost>=0 AND disposition IN ('restockable','damaged'));
ALTER TABLE sales ADD CONSTRAINT sale_amounts_check CHECK (total>0 AND tendered>=total AND change=tendered-total AND cost>=0);
ALTER TABLE payments ADD CONSTRAINT payment_amount_check CHECK (amount>0 AND method='cash' AND status='confirmed' AND direction IN ('in','out'));
ALTER TABLE cash_sessions ADD CONSTRAINT cash_status_check CHECK (status IN ('open','closed') AND opening_float>=0 AND (counted IS NULL OR counted>=0));
CREATE UNIQUE INDEX cash_one_open_per_branch ON cash_sessions(tenant_id,business_id,branch_id) WHERE status='open';
ALTER TABLE journal_lines ADD CONSTRAINT journal_line_one_side CHECK (debit>=0 AND credit>=0 AND ((debit>0 AND credit=0) OR (credit>0 AND debit=0)));
ALTER TABLE returns ADD CONSTRAINT return_total_positive CHECK (total>0 AND cost>=0);
ALTER TABLE periods ADD CONSTRAINT period_date_check CHECK (through_date ~ '^\d{4}-\d{2}-\d{2}$');

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['products','customers','periods'] LOOP
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id,business_id) REFERENCES businesses(tenant_id,id)',tab,tab||'_business_fk');
 END LOOP;
 FOREACH tab IN ARRAY ARRAY['stock_balances','stock_movements','cash_sessions','sales','sale_lines','returns','return_lines','payments','journals','journal_lines','audit_events','outbox_events','idempotency'] LOOP
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id,business_id,branch_id) REFERENCES branches(tenant_id,business_id,id)',tab,tab||'_branch_fk');
 END LOOP;
 FOREACH tab IN ARRAY ARRAY['stock_balances','stock_movements','sale_lines'] LOOP
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id,business_id,product_id) REFERENCES products(tenant_id,business_id,id)',tab,tab||'_product_fk');
 END LOOP;
END $$;
ALTER TABLE sales ADD UNIQUE(tenant_id,business_id,branch_id,id);
ALTER TABLE sale_lines ADD UNIQUE(tenant_id,business_id,branch_id,id);
ALTER TABLE returns ADD UNIQUE(tenant_id,business_id,branch_id,id);
ALTER TABLE journals ADD UNIQUE(tenant_id,business_id,branch_id,id);
ALTER TABLE sales ADD CONSTRAINT sale_customer_fk FOREIGN KEY(tenant_id,business_id,customer_id) REFERENCES customers(tenant_id,business_id,id);
ALTER TABLE sales ADD CONSTRAINT sale_cash_fk FOREIGN KEY(tenant_id,business_id,branch_id,cash_session_id) REFERENCES cash_sessions(tenant_id,business_id,branch_id,id);
ALTER TABLE sale_lines ADD CONSTRAINT line_sale_fk FOREIGN KEY(tenant_id,business_id,branch_id,sale_id) REFERENCES sales(tenant_id,business_id,branch_id,id);
ALTER TABLE returns ADD CONSTRAINT return_sale_fk FOREIGN KEY(tenant_id,business_id,branch_id,sale_id) REFERENCES sales(tenant_id,business_id,branch_id,id);
ALTER TABLE returns ADD CONSTRAINT return_cash_fk FOREIGN KEY(tenant_id,business_id,branch_id,cash_session_id) REFERENCES cash_sessions(tenant_id,business_id,branch_id,id);
ALTER TABLE return_lines ADD CONSTRAINT return_line_fk FOREIGN KEY(tenant_id,business_id,branch_id,return_id) REFERENCES returns(tenant_id,business_id,branch_id,id);
ALTER TABLE return_lines ADD CONSTRAINT original_line_fk FOREIGN KEY(tenant_id,business_id,branch_id,sale_line_id) REFERENCES sale_lines(tenant_id,business_id,branch_id,id);
ALTER TABLE payments ADD CONSTRAINT payment_sale_fk FOREIGN KEY(tenant_id,business_id,branch_id,sale_id) REFERENCES sales(tenant_id,business_id,branch_id,id);
ALTER TABLE payments ADD CONSTRAINT payment_return_fk FOREIGN KEY(tenant_id,business_id,branch_id,return_id) REFERENCES returns(tenant_id,business_id,branch_id,id);
ALTER TABLE payments ADD CONSTRAINT payment_cash_fk FOREIGN KEY(tenant_id,business_id,branch_id,cash_session_id) REFERENCES cash_sessions(tenant_id,business_id,branch_id,id);
ALTER TABLE journal_lines ADD CONSTRAINT journal_parent_fk FOREIGN KEY(tenant_id,business_id,branch_id,journal_id) REFERENCES journals(tenant_id,business_id,branch_id,id);

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY own_memberships ON memberships USING(user_id=current_setting('app.user_id',true));
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['tenants','businesses','branches'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
 END LOOP;
END $$;
CREATE POLICY tenant_member ON tenants FOR SELECT USING(EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=tenants.id AND m.active));
CREATE POLICY business_member ON businesses FOR SELECT USING(EXISTS(SELECT 1 FROM memberships m WHERE m.business_id=businesses.id AND m.active));
CREATE POLICY branch_member ON branches FOR SELECT USING(EXISTS(SELECT 1 FROM memberships m WHERE m.branch_id=branches.id AND m.active));
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['products','customers','periods','stock_balances','stock_movements','cash_sessions','sales','sale_lines','returns','return_lines','payments','journals','journal_lines','audit_events','outbox_events','idempotency'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY business_scope ON %I USING(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND business_id=nullif(current_setting(''app.business_id'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND business_id=nullif(current_setting(''app.business_id'',true),'''')::uuid)',tab);
 END LOOP;
 FOREACH tab IN ARRAY ARRAY['stock_balances','stock_movements','cash_sessions','sales','sale_lines','returns','return_lines','payments','journals','journal_lines','audit_events','outbox_events','idempotency'] LOOP
  EXECUTE format('CREATE POLICY branch_scope ON %I AS RESTRICTIVE USING(branch_id=nullif(current_setting(''app.branch_id'',true),'''')::uuid) WITH CHECK(branch_id=nullif(current_setting(''app.branch_id'',true),'''')::uuid)',tab);
 END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM mybusiness_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO mybusiness_app;
GRANT INSERT ON products,customers,stock_balances,stock_movements,cash_sessions,sales,sale_lines,returns,return_lines,payments,journals,journal_lines,audit_events,outbox_events,idempotency TO mybusiness_app;
GRANT UPDATE ON products,stock_balances,cash_sessions,outbox_events TO mybusiness_app;

-- Lines may only be added during their journal's original transaction.
ALTER TABLE journals ADD COLUMN posting_xid bigint NOT NULL DEFAULT txid_current();
CREATE FUNCTION guard_journal_lines() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM journals WHERE id=NEW.journal_id AND posting_xid=txid_current()) THEN RAISE EXCEPTION 'POSTED_JOURNAL_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_journal_lines BEFORE INSERT ON journal_lines FOR EACH ROW EXECUTE FUNCTION guard_journal_lines();
CREATE FUNCTION check_journal_balance() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE jid uuid; n integer; balance numeric; BEGIN
 IF TG_TABLE_NAME='journals' THEN jid:=NEW.id; ELSE jid:=NEW.journal_id; END IF;
 SELECT count(*),coalesce(sum(debit-credit),0) INTO n,balance FROM journal_lines WHERE journal_id=jid;
 IF n<2 OR balance<>0 THEN RAISE EXCEPTION 'UNBALANCED_JOURNAL'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_balanced_header AFTER INSERT ON journals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_journal_balance();
CREATE CONSTRAINT TRIGGER journal_balanced_lines AFTER INSERT ON journal_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_journal_balance();
CREATE FUNCTION guard_closed_period() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM periods p JOIN businesses b ON b.id=p.business_id WHERE p.tenant_id=NEW.tenant_id AND p.business_id=NEW.business_id AND p.through_date::date >= (NEW.created_at AT TIME ZONE b.timezone)::date) THEN RAISE EXCEPTION 'PERIOD_CLOSED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER closed_period BEFORE INSERT ON journals FOR EACH ROW EXECUTE FUNCTION guard_closed_period();
