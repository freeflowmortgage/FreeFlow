import { withRequestContext } from '../../../../../server/auth/requestContext';
import { createAttachmentListHandler } from '../../../../../server/integrations/encompass/attachmentListRoute';

export { createAttachmentListHandler };
export default withRequestContext('loan:read', createAttachmentListHandler());
