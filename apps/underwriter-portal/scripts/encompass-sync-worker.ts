import { runSyncQueueWorker } from '../src/server/integrations/encompass/syncWorkerRuntime';

runSyncQueueWorker().catch((error: unknown) => {
  console.error('Encompass sync worker stopped.', { errorType: error instanceof Error ? error.name : 'UnknownError' });
  process.exitCode = 1;
});
