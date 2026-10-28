import { prisma } from '../src/server/database/client';
import { runOutboundWebhookWorker } from '../src/server/integrations/webhooks/deliveryWorkerRuntime';

runOutboundWebhookWorker(prisma).catch((error: unknown) => {
  console.error('Outbound webhook worker stopped.', { errorType: error instanceof Error ? error.name : 'UnknownError' });
  process.exitCode = 1;
});
