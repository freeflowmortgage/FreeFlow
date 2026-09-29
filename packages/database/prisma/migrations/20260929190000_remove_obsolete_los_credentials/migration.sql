-- Core FreeFlow must not store lender LOS credential metadata.
ALTER TABLE "tenant_configurations"
  DROP COLUMN IF EXISTS "encompassClientId",
  DROP COLUMN IF EXISTS "encompassInstanceId";
