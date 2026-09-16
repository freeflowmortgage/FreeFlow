import { runQueueWorker } from '../src/server/integrations/encompass/documentPullWorkerRuntime';

runQueueWorker().catch((error: unknown) => {
  // Never serialize the error: provider errors and SDK objects can contain URLs or headers.
  console.error('document_pull_worker_stopped', { errorType: error instanceof Error ? error.name : 'Unknown' });
  process.exitCode = 1;
});
