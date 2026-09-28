-- The portal remains unable to mutate authoritative extraction rows directly.
-- This narrow operation permits an authenticated, tenant-scoped upload to
-- append parser output only when it exactly matches an existing source document.
CREATE OR REPLACE FUNCTION app.persist_uploaded_income_extraction(
  p_tenant_id UUID,
  p_loan_id UUID,
  p_source_document_id UUID,
  p_source_attachment_id VARCHAR(255),
  p_source_document_version INTEGER,
  p_source_content_hash CHAR(64),
  p_parser_version VARCHAR(100),
  p_schema_version VARCHAR(100),
  p_normalized_input JSONB,
  p_evidence JSONB,
  p_warnings TEXT[],
  p_confidence NUMERIC,
  p_canonical_hash CHAR(64)
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  existing_hash CHAR(64);
BEGIN
  IF p_tenant_id IS DISTINCT FROM app.safe_uuid_setting('app.tenant_id')
    OR app.safe_uuid_setting('app.principal_id') IS NULL THEN
    RAISE EXCEPTION 'authenticated tenant context is required' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.loan_documents AS document
  WHERE document."tenantId" = p_tenant_id
    AND document."loanId" = p_loan_id
    AND document."id" = p_source_document_id
    AND document."sourceAttachmentId" = p_source_attachment_id
    AND document."version" = p_source_document_version
    AND document."sourceContentHash" = p_source_content_hash
    AND document."parserVersion" = p_parser_version
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'uploaded extraction source binding is invalid' USING ERRCODE = '23514';
  END IF;

  SELECT extraction."canonicalHash"
  INTO existing_hash
  FROM public.income_extractions AS extraction
  WHERE extraction."tenantId" = p_tenant_id
    AND extraction."sourceDocumentId" = p_source_document_id
    AND extraction."sourceDocumentVersion" = p_source_document_version
    AND extraction."parserVersion" = p_parser_version;

  IF FOUND THEN
    IF existing_hash IS DISTINCT FROM p_canonical_hash THEN
      RAISE EXCEPTION 'repeated parser output is not deterministic' USING ERRCODE = '23514';
    END IF;
    RETURN FALSE;
  END IF;

  UPDATE public.income_extractions
  SET "status" = 'SUPERSEDED'::public."IncomeExtractionStatus", "supersededAt" = now()
  WHERE "tenantId" = p_tenant_id
    AND "loanId" = p_loan_id
    AND "sourceDocumentId" = p_source_document_id
    AND "status" = 'ACTIVE'::public."IncomeExtractionStatus";

  INSERT INTO public.income_extractions (
    "tenantId", "loanId", "sourceDocumentId", "sourceAttachmentId",
    "sourceDocumentVersion", "sourceContentHash", "parserVersion", "schemaVersion",
    "normalizedInput", "evidence", "warnings", "confidence", "canonicalHash"
  ) VALUES (
    p_tenant_id, p_loan_id, p_source_document_id, p_source_attachment_id,
    p_source_document_version, p_source_content_hash, p_parser_version, p_schema_version,
    p_normalized_input, p_evidence, p_warnings, p_confidence, p_canonical_hash
  );

  RETURN TRUE;
END
$function$;

ALTER FUNCTION app.persist_uploaded_income_extraction(
  UUID, UUID, UUID, VARCHAR, INTEGER, CHAR, VARCHAR, VARCHAR, JSONB, JSONB, TEXT[], NUMERIC, CHAR
) OWNER TO freeflow_owner;
REVOKE ALL ON FUNCTION app.persist_uploaded_income_extraction(
  UUID, UUID, UUID, VARCHAR, INTEGER, CHAR, VARCHAR, VARCHAR, JSONB, JSONB, TEXT[], NUMERIC, CHAR
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.persist_uploaded_income_extraction(
  UUID, UUID, UUID, VARCHAR, INTEGER, CHAR, VARCHAR, VARCHAR, JSONB, JSONB, TEXT[], NUMERIC, CHAR
) TO freeflow_app;
