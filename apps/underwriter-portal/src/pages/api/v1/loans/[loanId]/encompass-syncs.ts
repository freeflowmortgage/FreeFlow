import { withRequestContext } from '../../../../../server/auth/requestContext';
import { createEncompassSyncHandler } from '../../../../../server/integrations/encompass/syncRoute';

export default withRequestContext('encompass:sync', createEncompassSyncHandler());
