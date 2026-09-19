/**
 * Custom Encompass connector SERVICE SKELETON.
 *
 * Separate process/package from the portal. Not wired to document-pull APIs,
 * SQS workers, or Developer Connect. Do not deploy to live ECS.
 *
 * Stubbed: LOS I/O, PDF download, production S2S (mTLS / signed+replay).
 * Forbidden: LOS credentials, PDF persistence, flipping DC/worker flags.
 */
import { NonProdBearerServiceAuthVerifier } from './auth';
import { MemoryBindingStore } from './binding';
import { CustomConnectorService } from './connector/customConnectorService';
import { startConnectorHttpServer } from './http/nodeServer';

const port = Number.parseInt(process.env.PORT ?? '8080', 10);

const serviceToken = process.env.CONNECTOR_SERVICE_TOKEN?.trim();
const tenantId = process.env.CONNECTOR_BOUND_TENANT_ID?.trim();
const lenderId = process.env.CONNECTOR_BOUND_LENDER_ID?.trim();
const deploymentId = process.env.CONNECTOR_BOUND_DEPLOYMENT_ID?.trim();

// Fail-closed when env is unset. NON-PROD Bearer stub — replace before live wiring.
const authVerifier = new NonProdBearerServiceAuthVerifier(
  serviceToken && tenantId
    ? [{ token: serviceToken, serviceId: 'portal', tenantId }]
    : [],
);

const bindingStore = new MemoryBindingStore(
  tenantId && lenderId && deploymentId
    ? [{ tenantId, lenderId, deploymentId }]
    : [],
);

startConnectorHttpServer({
  port: Number.isFinite(port) ? port : 8080,
  deps: {
    authVerifier,
    bindingStore,
    connector: new CustomConnectorService(),
  },
});
