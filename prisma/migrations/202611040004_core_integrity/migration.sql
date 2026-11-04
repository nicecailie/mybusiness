-- A final fractional delivery can have zero incremental whole-BIF cost after rounding.
ALTER TABLE goods_receipts DROP CONSTRAINT goods_receipts_total_check;
ALTER TABLE goods_receipts ADD CHECK(total>=0);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['purchase_orders','goods_receipts','supplier_bills','expenses','invoices','finance_payments','stock_transfers','stock_counts'] LOOP
 EXECUTE format('ALTER TABLE %I ADD FOREIGN KEY(actor_id) REFERENCES "user"(id)',tab);
 END LOOP;
END $$;
ALTER TABLE stock_transfers ADD FOREIGN KEY(sent_by) REFERENCES "user"(id), ADD FOREIGN KEY(received_by) REFERENCES "user"(id);
ALTER TABLE stock_counts ADD FOREIGN KEY(finalized_by) REFERENCES "user"(id);
