import { withRequestContext } from '../../../../../../../server/auth/requestContext';
import { createMetadataRequirementsHandler } from '../../../../../../../server/income/metadataRequirementsRoute';

export { createMetadataRequirementsHandler };
export default withRequestContext('loan:read', createMetadataRequirementsHandler());
