import { withRequestContext } from '../../../../server/auth/requestContext';
import { createDocumentPullStatusHandler } from '../../../../server/integrations/encompass/documentPullStatusRoute';

export { createDocumentPullStatusHandler };

export default withRequestContext('encompass:pull', createDocumentPullStatusHandler());
