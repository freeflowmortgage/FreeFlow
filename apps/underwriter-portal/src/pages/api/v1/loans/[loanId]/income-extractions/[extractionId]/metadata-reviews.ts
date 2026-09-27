import { withRequestContext } from '../../../../../../../server/auth/requestContext';
import { createExtractionMetadataReviewHandler } from '../../../../../../../server/income/extractionMetadataReviewRoute';

export default withRequestContext('income:metadata:review', createExtractionMetadataReviewHandler());
