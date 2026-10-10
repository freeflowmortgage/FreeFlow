import { withRequestContext } from '../../../../../server/auth/requestContext';
import { createHostFieldMapHandler } from '../../../../../server/integrations/encompass/hostWriteRoute';
export { createHostFieldMapHandler };
export default withRequestContext('encompass:sync', createHostFieldMapHandler());
