-- Additive: stable variant product IDs and branch-scoped lot quantities. Valuation remains StockBalance.
ALTER TABLE products ADD COLUMN parent_id uuid, ADD COLUMN variant_label text, ADD COLUMN is_group boolean NOT NULL DEFAULT false, ADD COLUMN batch_tracked boolean NOT NULL DEFAULT false, ADD COLUMN recipe jsonb NOT NULL DEFAULT '[]', ADD COLUMN vat_bps integer NOT NULL DEFAULT 0 CHECK(vat_bps BETWEEN 0 AND 10000), ADD COLUMN system_kind text;
ALTER TABLE products ADD FOREIGN KEY(tenant_id,business_id,parent_id) REFERENCES products(tenant_id,business_id,id), ADD CHECK(parent_id IS NULL OR parent_id<>id);
ALTER TABLE sale_lines ADD COLUMN consumption jsonb NOT NULL DEFAULT '[]', ADD COLUMN tax numeric(20,0) NOT NULL DEFAULT 0 CHECK(tax>=0 AND tax<=total);
ALTER TABLE return_lines ADD COLUMN tax numeric(20,0) NOT NULL DEFAULT 0 CHECK(tax>=0 AND tax<=total);
ALTER TABLE invoice_lines ADD COLUMN tax numeric(20,0) NOT NULL DEFAULT 0 CHECK(tax>=0 AND tax<=total), ADD COLUMN revenue_account text NOT NULL DEFAULT '4000 Sales';
CREATE TABLE stock_batches(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,business_id uuid NOT NULL,branch_id uuid NOT NULL,product_id uuid NOT NULL,expires_on text NOT NULL CHECK(expires_on~'^\d{4}-\d{2}-\d{2}$'),label text NOT NULL,on_hand numeric(18,3) NOT NULL CHECK(on_hand>=0),FOREIGN KEY(tenant_id,business_id,branch_id) REFERENCES branches(tenant_id,business_id,id),FOREIGN KEY(tenant_id,business_id,product_id) REFERENCES products(tenant_id,business_id,id));
CREATE INDEX stock_batches_fefo ON stock_batches(tenant_id,business_id,branch_id,product_id,expires_on,id);
ALTER TABLE stock_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY scope ON stock_batches USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND business_id=nullif(current_setting('app.business_id',true),'')::uuid AND branch_id=nullif(current_setting('app.branch_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND business_id=nullif(current_setting('app.business_id',true),'')::uuid AND branch_id=nullif(current_setting('app.branch_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON stock_batches TO mybusiness_app;

ALTER TABLE stock_transfer_lines ADD COLUMN batch_lots jsonb NOT NULL DEFAULT '[]';
ALTER TABLE stock_count_lines ADD COLUMN expires_on text;
