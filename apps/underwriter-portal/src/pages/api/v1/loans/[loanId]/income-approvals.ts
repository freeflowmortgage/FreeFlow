import { withRequestContext } from '../../../../../server/auth/requestContext';
import { createIncomeApprovalHandler } from '../../../../../server/audit/incomeApprovalsRoute';

export { createIncomeApprovalHandler };

export default withRequestContext('income:approve', createIncomeApprovalHandler());
