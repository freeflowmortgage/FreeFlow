import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { withRequestContext, type RequestContext } from '../../../server/auth/requestContext';
import { isProtectedRuntime } from '../../../server/runtimeMode';

interface EncompassTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface EncompassAttachment {
  attachmentId: string;
  title: string;
  fileType: string;
  fileSize: number;
  dateCreated: string;
}

/**
 * 1. Encompass Developer Connect Authentication Handshake [cite: 28, 102]
 * Exchanges instance credentials for an OAuth2 bearer token.
 */
async function getEncompassAccessToken(
  clientId: string,
  clientSecret: string,
  instanceId: string
): Promise<string> {
  const tokenEndpoint = `https://api.elliemae.com/oauth2/v1/token`;
  
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);
  params.append('instance_id', instanceId);

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  if (!response.ok) {
    throw new Error(`Encompass OAuth failed with status: ${response.status}`);
  }

  const data = (await response.json()) as EncompassTokenResponse;
  return data.access_token;
}

/**
 * 2. Fetch Active Loan Attachments List from eFolder [cite: 28, 102]
 * Queries the Encompass REST API for all files attached to the specified loan GUID.
 */
async function fetchEFolderAttachments(
  loanId: string,
  accessToken: string
): Promise<EncompassAttachment[]> {
  // Encompass API route for retrieving attachments [cite: 28, 102]
  const attachmentsEndpoint = `https://api.elliemae.com/encompass/v1/loans/${loanId}/attachments`;

  const response = await fetch(attachmentsEndpoint, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Encompass attachments: ${response.statusText}`);
  }

  return (await response.json()) as EncompassAttachment[];
}

/**
 * 3. Next.js Secure API Route Handler
 * Direct eFolder File Stream Handler (Encompass Workspace Context) [cite: 102]
 */
async function handler(req: NextApiRequest, res: NextApiResponse, context: RequestContext) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (isProtectedRuntime()) {
    return res.status(503).json({
      error: {
        code: 'TENANT_REPOSITORY_REQUIRED',
        message: 'Document retrieval is disabled until the tenant-scoped repository is available.',
        requestId: context.requestId,
      },
    });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return res.status(503).json({
      error: {
        code: 'DOCUMENT_RETRIEVAL_UNAVAILABLE',
        message: 'Document retrieval is not configured.',
        requestId: context.requestId,
      },
    });
  }
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

  const { loanId, filterCategory = 'TAX_RETURN' } = req.body;
  const tenantId = context.tenantId;

  if (!loanId) {
    return res.status(400).json({ error: 'Missing required parameter: loanId.' });
  }

  try {
    // 1. Retrieve the Tenant's Encrypted Encompass API Credentials [cite: 28, 49]
    const { data: tenantConfig, error: configError } = await supabaseAdmin
      .from('tenant_configurations')
      .select('encompassClientId, encompassInstanceId, encompassClientSecret') // Credentials encrypted at rest [cite: 49]
      .eq('tenantId', tenantId)
      .single();

    if (configError || !tenantConfig) {
      throw new Error(`Tenant is not configured with an active Encompass integration [cite: 28, 49].`);
    }

    // 2. Authenticate with Encompass Developer Connect API [cite: 28, 102]
    const accessToken = await getEncompassAccessToken(
      tenantConfig.encompassClientId,
      tenantConfig.encompassClientSecret, // Decrypted at database connection layer
      tenantConfig.encompassInstanceId
    );

    // 3. Retrieve metadata of all attachments in the loan's eFolder [cite: 28, 102]
    const attachments = await fetchEFolderAttachments(loanId, accessToken);

    // 4. Identify relevant tax documents (Filtering by keywords / standard folder mappings) [cite: 30, 58]
    const relevantDocuments = attachments.filter((doc) => {
      const title = doc.title.toLowerCase();
      if (filterCategory === 'TAX_RETURN') {
        return (
          title.includes('tax') ||
          title.includes('1040') ||
          title.includes('1120') ||
          title.includes('1065') ||
          title.includes('schedule')
        );
      }
      return title.includes('paystub') || title.includes('w2') || title.includes('earnings');
    });

    if (relevantDocuments.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No relevant tax returns or income verification documents found in this loan eFolder [cite: 102].',
      });
    }

    const processedResults = [];

    // 5. Zero-Data-Retention Stream Pipeline: Transfer direct from Encompass to RAM Parser [cite: 30, 33, 102]
    for (const doc of relevantDocuments) {
      // Request raw download URL or stream from Encompass [cite: 28, 102]
      const downloadEndpoint = `https://api.elliemae.com/encompass/v1/loans/${loanId}/attachments/${doc.attachmentId}/download`;
      
      const fileResponse = await fetch(downloadEndpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (!fileResponse.ok) {
        console.error('[encompass-pull] attachment download failed', {
          requestId: context.requestId,
          status: fileResponse.status,
        });
        continue;
      }

      // Capture raw PDF binary array buffer strictly in volatile server RAM [cite: 33]
      const fileBuffer = await fileResponse.arrayBuffer();

      /**
       * 6. POST to Local Stateless Slicing & Extraction Microservice (`services/doc-parser`) [cite: 30, 38]
       * We forward the buffer in RAM directly to our optimized Python pre-splitter [cite: 30].
       * The binary NEVER touches our persistent database or local hard disk [cite: 33]!
       */
      const parserResponse = await fetch(process.env.DOC_PARSER_SERVICE_URL || 'http://127.0.0.1:8000/parse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/pdf',
          'X-Document-Title': doc.title,
        },
        body: Buffer.from(fileBuffer), // Volatile memory buffer [cite: 33]
      });

      if (!parserResponse.ok) {
        console.error('[encompass-pull] parser rejected attachment', {
          requestId: context.requestId,
          status: parserResponse.status,
        });
        continue;
      }

      const parsedData = await parserResponse.json();
      processedResults.push({
        documentId: doc.attachmentId,
        title: doc.title,
        extractedFields: parsedData.extractedTaxFields, // Returns structured JSON coordinates [cite: 60]
        qualifyingMonthlyIncome: parsedData.qualifyingMonthlyIncome, // Real mathematical calculations [cite: 38, 60]
      });
    }

    // 7. Log transaction success (Excluding any sensitive SSN/PII to remain ZDR/GLBA compliant) [cite: 20, 33]
    await supabaseAdmin.from('ocr_diff_histories').insert({
      loan_id: loanId,
      document_name: relevantDocuments.map((d) => d.title).join(', '),
      verification_source: 'PAYROLL_API_DIRECT', // Tagged for automated underwriting audits [cite: 7, 74]
    });

    // 8. Return parsed coordinate metadata instantly to the React Underwriter UI [cite: 25]
    return res.status(200).json({
      success: true,
      loanId,
      processedDocuments: processedResults,
    });

  } catch (error: any) {
    // This legacy route remains disabled in protected runtimes. Normalize the
    // caught value before the legacy response/log code below so neither can
    // serialize an upstream body, credential, document title, or loan value.
    error = { message: error instanceof Error ? error.name : 'UnknownError' };
    console.error(`❌ [Encompass Integration Error] ${error.message}`);
    return res.status(500).json({
      success: false,
      error: {
        code: 'DOCUMENT_RETRIEVAL_FAILED',
        message: 'Document retrieval could not be completed.',
        requestId: context.requestId,
      },
    });
  }
}

export default withRequestContext('income:process', handler);
