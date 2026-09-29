/**
 * Custom Encompass connector SERVICE SKELETON.
 *
 * Separate process/package from the portal. Not wired to document-pull APIs,
 * SQS workers, or Developer Connect. Do not deploy to live ECS.
 *
 * Stubbed: real LOS I/O and production S2S (mTLS / signed+replay).
 * freeflow-dev may explicitly select deterministic synthetic I/O
 * (in-memory W-2 plus baked morning-pack fixtures).
 * Forbidden: LOS credentials, PDF persistence, flipping DC/worker flags.
 *
 * NODE_ENV=production refuses to boot while the NON-PROD Bearer stub is selected.
 */
import { EncompassConnectorError } from '@mortgage-pos/encompass-connector-contract';
import { bootConnectorService } from './boot';

try {
  bootConnectorService(process.env);
} catch (error) {
  const message = error instanceof EncompassConnectorError
    ? error.message
    : 'Connector service failed to start.';
  console.error(message);
  process.exitCode = 1;
}
