import { withRequestContext } from '../../../../../server/auth/requestContext';
import { createWebhookDeliveriesHandler } from '../../../../../server/integrations/webhooks/adminRoutes';

export default withRequestContext('webhooks:manage', createWebhookDeliveriesHandler());
