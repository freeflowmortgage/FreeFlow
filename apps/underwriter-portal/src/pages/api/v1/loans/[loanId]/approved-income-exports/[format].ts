import { withRequestContext } from '../../../../../../server/auth/requestContext';
import { createApprovedIncomeExportHandler } from '../../../../../../server/http/approvedIncomeExportsRoute';

export { createApprovedIncomeExportHandler };
export default withRequestContext('loan:read', createApprovedIncomeExportHandler());
