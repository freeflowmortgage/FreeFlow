import { withRequestContext } from '../../../../../server/auth/requestContext';
import { createWebhookSecretRotationHandler } from '../../../../../server/integrations/webhooks/adminRoutes';

export default withRequestContext('webhooks:manage', createWebhookSecretRotationHandler());
