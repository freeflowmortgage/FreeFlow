import { withRequestContext } from '../../../../../server/auth/requestContext';
import { createDocumentPullHandler } from '../../../../../server/integrations/encompass/documentPullRoute';

export { createDocumentPullHandler };

export default withRequestContext('encompass:pull', createDocumentPullHandler());
