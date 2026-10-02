import { withRequestContext } from '../../../server/auth/requestContext';
import { createIncomeDocumentPreviewHandler } from '../../../server/integrations/encompass/incomeDocumentPreviewRoute';

export { createIncomeDocumentPreviewHandler };
export const config = { api: { bodyParser: false } };
export default withRequestContext('income:process', createIncomeDocumentPreviewHandler());
