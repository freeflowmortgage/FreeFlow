import { withRequestContext } from '../../../../../../server/auth/requestContext';
import { createWebhookRedeliveryHandler } from '../../../../../../server/integrations/webhooks/adminRoutes';

export default withRequestContext('webhooks:manage', createWebhookRedeliveryHandler());
