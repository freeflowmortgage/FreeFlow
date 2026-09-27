import { withRequestContext } from '../../../../server/auth/requestContext';
import { createEncompassSyncStatusHandler } from '../../../../server/integrations/encompass/syncStatusRoute';

export default withRequestContext('encompass:sync', createEncompassSyncStatusHandler());
