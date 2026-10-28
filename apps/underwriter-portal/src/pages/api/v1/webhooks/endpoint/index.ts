import { withRequestContext } from '../../../../../server/auth/requestContext';
import { createWebhookEndpointHandler } from '../../../../../server/integrations/webhooks/adminRoutes';

export default withRequestContext('webhooks:manage', createWebhookEndpointHandler());
