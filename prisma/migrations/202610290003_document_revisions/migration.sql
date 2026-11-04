ALTER TABLE business_documents ADD COLUMN replaces_id uuid;
ALTER TABLE business_documents ADD UNIQUE(tenant_id,business_id,id);
ALTER TABLE business_documents ADD CONSTRAINT document_revision_business_fk FOREIGN KEY(tenant_id,business_id,replaces_id) REFERENCES business_documents(tenant_id,business_id,id);
