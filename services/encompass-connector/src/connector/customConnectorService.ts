import { EncompassV3Connector } from './encompassApiClient';

/**
 * Service-side EncompassConnector shell (Custom path).
 *
 * FORBIDDEN:
 * - LOS credentials outside this connector process, in logs, or in git
 * - PDF persistence (disk, S3, /tmp). Any future download must stay in memory
 *   and zero the buffer after the response (ZDR).
 * - Portal document-pull / worker enablement (not this package)
 */
/** Backward-compatible name for the real connector-side V3 implementation. */
export class CustomConnectorService extends EncompassV3Connector {}
