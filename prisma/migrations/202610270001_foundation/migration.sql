-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "demo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "businesses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BIF',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Bujumbura',
    "locale" TEXT NOT NULL DEFAULT 'fr',

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "category" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'goods',
    "price" DECIMAL(20,0) NOT NULL,
    "low_stock" INTEGER NOT NULL DEFAULT 5,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "on_hand" INTEGER NOT NULL DEFAULT 0,
    "value" DECIMAL(20,0) NOT NULL DEFAULT 0,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "value" DECIMAL(20,0) NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "opening_float" DECIMAL(20,0) NOT NULL,
    "counted" DECIMAL(20,0),
    "variance" DECIMAL(20,0),
    "reason" TEXT,
    "opened_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ,

    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "customer_id" UUID,
    "customer_name" TEXT,
    "cash_session_id" UUID NOT NULL,
    "total" DECIMAL(20,0) NOT NULL,
    "tendered" DECIMAL(20,0) NOT NULL,
    "change" DECIMAL(20,0) NOT NULL,
    "cost" DECIMAL(20,0) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(20,0) NOT NULL,
    "total" DECIMAL(20,0) NOT NULL,
    "cost" DECIMAL(20,0) NOT NULL,

    CONSTRAINT "sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "returns" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "cash_session_id" UUID NOT NULL,
    "total" DECIMAL(20,0) NOT NULL,
    "cost" DECIMAL(20,0) NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "sale_line_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "disposition" TEXT NOT NULL,
    "total" DECIMAL(20,0) NOT NULL,
    "cost" DECIMAL(20,0) NOT NULL,

    CONSTRAINT "return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "return_id" UUID,
    "cash_session_id" UUID NOT NULL,
    "amount" DECIMAL(20,0) NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'cash',
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "journal_id" UUID NOT NULL,
    "account" TEXT NOT NULL,
    "debit" DECIMAL(20,0) NOT NULL,
    "credit" DECIMAL(20,0) NOT NULL,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "periods" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "through_date" TEXT NOT NULL,

    CONSTRAINT "periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMPTZ,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "businesses_tenant_id_id_key" ON "businesses"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "branches_tenant_id_business_id_id_key" ON "branches"("tenant_id", "business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_branch_id_key" ON "memberships"("user_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_business_id_id_key" ON "products"("tenant_id", "business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_business_id_sku_key" ON "products"("tenant_id", "business_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_business_id_barcode_key" ON "products"("tenant_id", "business_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balances_tenant_id_business_id_branch_id_product_id_key" ON "stock_balances"("tenant_id", "business_id", "branch_id", "product_id");

-- CreateIndex
CREATE INDEX "stock_movements_tenant_id_business_id_branch_id_created_at_idx" ON "stock_movements"("tenant_id", "business_id", "branch_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_business_id_id_key" ON "customers"("tenant_id", "business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_sessions_tenant_id_business_id_branch_id_id_key" ON "cash_sessions"("tenant_id", "business_id", "branch_id", "id");

-- CreateIndex
CREATE INDEX "sales_tenant_id_business_id_branch_id_created_at_idx" ON "sales"("tenant_id", "business_id", "branch_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sales_tenant_id_business_id_id_key" ON "sales"("tenant_id", "business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_tenant_id_business_id_number_key" ON "sales"("tenant_id", "business_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "sale_lines_tenant_id_business_id_id_key" ON "sale_lines"("tenant_id", "business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "returns_tenant_id_business_id_id_key" ON "returns"("tenant_id", "business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "journals_tenant_id_business_id_id_key" ON "journals"("tenant_id", "business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "journals_tenant_id_business_id_source_type_source_id_key" ON "journals"("tenant_id", "business_id", "source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_tenant_id_business_id_branch_id_user_id_operati_key" ON "idempotency"("tenant_id", "business_id", "branch_id", "user_id", "operation", "key");
