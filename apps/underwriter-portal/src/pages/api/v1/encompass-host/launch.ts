import { withRequestContext } from '../../../../server/auth/requestContext';
import { createHostLaunchHandler } from '../../../../server/integrations/encompass/hostLaunchRoute';
export { createHostLaunchHandler };
export default withRequestContext('income:process', createHostLaunchHandler());
