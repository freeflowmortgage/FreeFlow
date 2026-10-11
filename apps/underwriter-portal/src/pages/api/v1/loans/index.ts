import { withRequestContext } from '../../../../server/auth/requestContext';
import { createStandaloneLoanHandler } from '../../../../server/income/standaloneLoanRoute';

export { createStandaloneLoanHandler };

export const config = {
  api: {
    bodyParser: { sizeLimit: '16kb' },
  },
};

export default withRequestContext('income:process', createStandaloneLoanHandler());
