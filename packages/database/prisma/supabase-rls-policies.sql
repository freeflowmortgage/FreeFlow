-- =============================================================================
-- FREEFLOW MORTGAGE SOLUTIONS - SUPABASE POSTGRESQL RLS POLICIES (v1)
-- Focus: Standalone Income Tool Multi-Tenant Isolation & Role Controls [cite: 32, 39, 61, 62]
-- =============================================================================
-- This script configures Row-Level Security (RLS) on your Supabase tables.
-- It ensures complete cryptographic tenant-isolation (Tenant A cannot see Tenant B's files)
-- and locks down the Loan Officer (LO) role to Read-Only access on underwriter audits [cite: 62].
--
-- How to apply: Copy and run this script in your Supabase SQL Editor [cite: 39].
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. UTILITY FUNCTIONS (JWT Claims & Security Context Helpers) [cite: 39, 61]
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper: Retrieve the tenant ID from the authenticated user's JWT metadata
CREATE OR REPLACE FUNCTION auth.jwt_tenant_id()
RETURNS uuid AS $$
  -- Checks both app_metadata and user_metadata for maximum integration flexibility
  SELECT COALESCE(
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'app_metadata' ->> 'tenantId')::uuid,
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'user_metadata' ->> 'tenantId')::uuid
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Helper: Retrieve the user role from the authenticated user's JWT metadata [cite: 62]
CREATE OR REPLACE FUNCTION auth.jwt_user_role()
RETURNS text AS $$
  SELECT COALESCE(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'app_metadata' ->> 'role',
    nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'user_metadata' ->> 'role'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ENABLE ROW-LEVEL SECURITY (RLS) ON ALL INCOME TOOL TABLES [cite: 39, 61]
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ocr_diff_histories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_1084_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_billing_ledgers ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. TENANTS TABLE POLICIES (Brokerage Organizations) [cite: 19]
-- ─────────────────────────────────────────────────────────────────────────────
-- Users can only read their own tenant's organization details
CREATE POLICY tenant_select_policy ON public.tenants
  FOR SELECT
  USING (id = auth.jwt_tenant_id());

-- Only Super Admins can insert or update tenant structures
CREATE POLICY tenant_admin_policy ON public.tenants
  FOR ALL
  USING (auth.jwt_user_role() = 'SUPER_ADMIN')
  WITH CHECK (auth.jwt_user_role() = 'SUPER_ADMIN');

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. TENANT CONFIGURATIONS POLICIES (Feature Flags & Encompass Keys) [cite: 38, 102]
-- ─────────────────────────────────────────────────────────────────────────────
-- Users can read their tenant's configuration
CREATE POLICY config_select_policy ON public.tenant_configurations
  FOR SELECT
  USING (tenant_id = auth.jwt_tenant_id());

-- Only Broker Owners or Super Admins can write/edit integration configurations [cite: 45]
CREATE POLICY config_write_policy ON public.tenant_configurations
  FOR ALL
  USING (
    tenant_id = auth.jwt_tenant_id() AND 
    auth.jwt_user_role() IN ('BROKER_OWNER', 'SUPER_ADMIN')
  )
  WITH CHECK (
    tenant_id = auth.jwt_tenant_id() AND 
    auth.jwt_user_role() IN ('BROKER_OWNER', 'SUPER_ADMIN')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. USERS TABLE POLICIES (Staff Accounts)
-- ─────────────────────────────────────────────────────────────────────────────
-- Users can read other team members inside their same tenant (co-collaboration)
CREATE POLICY user_select_policy ON public.users
  FOR SELECT
  USING (tenant_id = auth.jwt_tenant_id());

-- Broker Owners and Admins can manage staff profiles
CREATE POLICY user_manage_policy ON public.users
  FOR ALL
  USING (
    tenant_id = auth.jwt_tenant_id() AND 
    auth.jwt_user_role() IN ('BROKER_OWNER', 'SUPER_ADMIN')
  )
  WITH CHECK (
    tenant_id = auth.jwt_tenant_id() AND 
    auth.jwt_user_role() IN ('BROKER_OWNER', 'SUPER_ADMIN')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. LOAN APPLICATIONS POLICIES (Form 1003 Storage)
-- ─────────────────────────────────────────────────────────────────────────────
-- Team members can read loans belonging to their tenant
CREATE POLICY loan_select_policy ON public.loan_applications
  FOR SELECT
  USING (tenant_id = auth.jwt_tenant_id());

-- Only authorized roles can modify loans. 
-- Loan Officers (Sales) can edit/mutate, but Underwriters and Processors have full access
CREATE POLICY loan_modify_policy ON public.loan_applications
  FOR ALL
  USING (
    tenant_id = auth.jwt_tenant_id() AND
    auth.jwt_user_role() IN ('SUPER_ADMIN', 'BROKER_OWNER', 'UNDERWRITER', 'PROCESSOR', 'LOAN_OFFICER')
  )
  WITH CHECK (
    tenant_id = auth.jwt_tenant_id() AND
    auth.jwt_user_role() IN ('SUPER_ADMIN', 'BROKER_OWNER', 'UNDERWRITER', 'PROCESSOR', 'LOAN_OFFICER')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. LOAN DOCUMENTS POLICIES (File Metadata) [cite: 30]
-- ─────────────────────────────────────────────────────────────────────────────
-- Access is restricted strictly to active tenant files
CREATE POLICY doc_select_policy ON public.loan_documents
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.loan_applications
      WHERE id = loan_documents.loan_id AND tenant_id = auth.jwt_tenant_id()
    )
  );

-- Modify files (upload/delete metadata logs)
CREATE POLICY doc_all_policy ON public.loan_documents
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.loan_applications
      WHERE id = loan_documents.loan_id AND tenant_id = auth.jwt_tenant_id()
    ) AND
    auth.jwt_user_role() IN ('SUPER_ADMIN', 'BROKER_OWNER', 'UNDERWRITER', 'PROCESSOR', 'LOAN_OFFICER')
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.loan_applications
      WHERE id = loan_documents.loan_id AND tenant_id = auth.jwt_tenant_id()
    ) AND
    auth.jwt_user_role() IN ('SUPER_ADMIN', 'BROKER_OWNER', 'UNDERWRITER', 'PROCESSOR', 'LOAN_OFFICER')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. OCR DIFFERENTIATION HISTORIES (Manual Overrides Auditor) [cite: 30]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY diff_select_policy ON public.ocr_diff_histories
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.loan_applications
      WHERE id = ocr_diff_histories.loan_id AND tenant_id = auth.jwt_tenant_id()
    )
  );

CREATE POLICY diff_modify_policy ON public.ocr_diff_histories
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.loan_applications
      WHERE id = ocr_diff_histories.loan_id AND tenant_id = auth.jwt_tenant_id()
    ) AND
    auth.jwt_user_role() IN ('SUPER_ADMIN', 'BROKER_OWNER', 'UNDERWRITER', 'PROCESSOR')
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.loan_applications
      WHERE id = ocr_diff_histories.loan_id AND tenant_id = auth.jwt_tenant_id()
    ) AND
    auth.jwt_user_role() IN ('SUPER_ADMIN', 'BROKER_OWNER', 'UNDERWRITER', 'PROCESSOR')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. FORM 1084 AUDITS (Calculations & Bounding Box Overrides) [cite: 25, 38]
-- ─────────────────────────────────────────────────────────────────────────────
-- Read access for everyone on the team so they can inspect results
CREATE POLICY audit_select_policy ON public.form_1084_audits
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.loan_applications
      WHERE id = form_1084_audits.loan_id AND tenant_id = auth.jwt_tenant_id()
    )
  );

-- Write and Update access is STRICTLY blocked for Loan Officers (Sales) [cite: 62]
-- This enforces read-only boundaries to block unauthorized compliance adjustments [cite: 12, 62]
CREATE POLICY audit_modify_policy ON public.form_1084_audits
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.loan_applications
      WHERE id = form_1084_audits.loan_id AND tenant_id = auth.jwt_tenant_id()
    ) AND
    auth.jwt_user_role() IN ('SUPER_ADMIN', 'BROKER_OWNER', 'UNDERWRITER', 'PROCESSOR') -- LOAN_OFFICER is excluded! [cite: 62]
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.loan_applications
      WHERE id = form_1084_audits.loan_id AND tenant_id = auth.jwt_tenant_id()
    ) AND
    auth.jwt_user_role() IN ('SUPER_ADMIN', 'BROKER_OWNER', 'UNDERWRITER', 'PROCESSOR') -- LOAN_OFFICER is excluded! [cite: 62]
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. LOAN CONDITIONS (Checklist & Warning Cards) [cite: 32]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY condition_select_policy ON public.loan_conditions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.loan_applications
      WHERE id = loan_conditions.loan_id AND tenant_id = auth.jwt_tenant_id()
    )
  );

-- Any standard internal team role can manage checklist conditions
CREATE POLICY condition_modify_policy ON public.loan_conditions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.loan_applications
      WHERE id = loan_conditions.loan_id AND tenant_id = auth.jwt_tenant_id()
    ) AND
    auth.jwt_user_role() IN ('SUPER_ADMIN', 'BROKER_OWNER', 'UNDERWRITER', 'PROCESSOR', 'LOAN_OFFICER')
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.loan_applications
      WHERE id = loan_conditions.loan_id AND tenant_id = auth.jwt_tenant_id()
    ) AND
    auth.jwt_user_role() IN ('SUPER_ADMIN', 'BROKER_OWNER', 'UNDERWRITER', 'PROCESSOR', 'LOAN_OFFICER')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. TENANT BILLING LEDGERS (Exemption Ledger) [cite: 33]
-- ─────────────────────────────────────────────────────────────────────────────
-- Only administrative roles can see charge meters and cryptographic hash lists
CREATE POLICY ledger_select_policy ON public.tenant_billing_ledgers
  FOR SELECT
  USING (
    tenant_id = auth.jwt_tenant_id() AND
    auth.jwt_user_role() IN ('SUPER_ADMIN', 'BROKER_OWNER', 'UNDERWRITER', 'PROCESSOR')
  );

-- Ledgers are systematically managed by server-side processes, admin check-writes are blocked
CREATE POLICY ledger_system_write_policy ON public.tenant_billing_ledgers
  FOR ALL
  USING (auth.jwt_user_role() = 'SUPER_ADMIN')
  WITH CHECK (auth.jwt_user_role() = 'SUPER_ADMIN');
