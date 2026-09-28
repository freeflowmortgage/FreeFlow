import { withRequestContext } from '../../../../../server/auth/requestContext';
import { createConsoleContextHandler } from '../../../../../server/income/consoleContextRoute';

export { createConsoleContextHandler };
export default withRequestContext('loan:read', createConsoleContextHandler());
