import { withRequestContext } from '../../../../../server/auth/requestContext';
import { createEncompassSyncPreviewHandler } from '../../../../../server/integrations/encompass/syncPreviewRoute';

export default withRequestContext('encompass:sync', createEncompassSyncPreviewHandler());
