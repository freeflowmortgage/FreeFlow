import { withRequestContext } from '../../../../../server/auth/requestContext';
import { createHostWriteCompletionHandler } from '../../../../../server/integrations/encompass/hostWriteRoute';
export { createHostWriteCompletionHandler };
export default withRequestContext('encompass:sync', createHostWriteCompletionHandler());
