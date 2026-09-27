-- The portal reads the tenant-bound connector routing metadata before queuing
-- document-pull and sync jobs. Row-level security remains the tenant boundary.
GRANT SELECT ON "encompass_connector_bindings" TO freeflow_app;
