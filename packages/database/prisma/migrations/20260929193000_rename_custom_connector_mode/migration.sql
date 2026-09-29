-- Replace the retired licensed API integration label with FreeFlow's
-- vendor-neutral, separately deployed custom connector mode.
ALTER TYPE "EncompassIntegrationMode"
  RENAME VALUE 'DEVELOPER_CONNECT' TO 'CUSTOM_CONNECTOR';
