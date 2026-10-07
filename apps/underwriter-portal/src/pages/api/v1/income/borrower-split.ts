import { withRequestContext } from '../../../../server/auth/requestContext';
import { createBorrowerSplitHandler } from '../../../../server/income/borrowerSplitRoute';

export { createBorrowerSplitHandler };

export const config = {
  api: { bodyParser: { sizeLimit: '64kb' } },
};

export default withRequestContext('income:calculate', createBorrowerSplitHandler());
