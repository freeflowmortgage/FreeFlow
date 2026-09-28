import { withRequestContext } from '../../../../../server/auth/requestContext';
import { createUploadIncomeDocumentHandler } from '../../../../../server/integrations/encompass/uploadIncomeDocumentRoute';

export { createUploadIncomeDocumentHandler };
export const config = { api: { bodyParser: false } };
export default withRequestContext('income:process', createUploadIncomeDocumentHandler());
