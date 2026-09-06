# Zero-Data-Retention Data Disposition Plan

This procedure is required before the destructive
`20260906150000_zero_data_retention` migration is applied to any environment
that might contain real data. It is not a license to delete production data
without privacy/legal approval.

## Scope

The migration removes FreeFlow-managed persistence of raw document names/object
keys, full OCR payloads, raw OCR values, user-entered replacement values, and
unbounded calculation/override JSON. FreeFlow keeps only approved metadata,
normalized calculation outputs, versioned hashes, and immutable audit evidence.
Original documents remain in Encompass.

## Preconditions

1. Confirm the environment classification and whether it contains borrower,
   customer, or regulated data. Development and staging use synthetic data only.
2. Security/privacy/legal approve the data inventory, deletion scope, backup
   treatment, retention obligations, and any legal hold.
3. Verify no running application version references a column being removed.
   Deploy the compatible application release before the contract migration.
4. Record change ID, environment, operator, schema version, database snapshot
   point, and rollback owner. A database snapshot does not make raw-content
   retention acceptable; it is controlled recovery evidence.

## Execution and evidence

1. Run the migration with the one-off migrator task only. Never let an ECS
   application task mutate schema at startup.
2. Run `tenant-rls-isolation.sql` and the production canary suite with synthetic
   markers that resemble a PDF, OCR line, and raw XML value.
3. Search database columns, application logs, queues/DLQs, cache, object stores,
   trace exports, crash artifacts, and CI artifacts. The markers must be absent.
4. Confirm the audit ledger and calculation results still work with only the
   allowlisted metadata.
5. Record evidence links, reviewer approval, backup-expiry handling, and the
   date on which any pre-migration recoverable copies age out under the approved
   retention policy.

## Failure handling

Stop the rollout if an old task attempts to write a removed column, a marker is
found outside the approved recovery record, or a legal hold conflicts with the
plan. Follow the raw-document/OCR incident runbook; do not improvise a manual
purge or restore into a networked environment.
