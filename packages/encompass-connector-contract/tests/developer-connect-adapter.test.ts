import assert from 'node:assert/strict';
import test from 'node:test';
import { DeveloperConnectAdapter } from '../src/index';

const context = { tenantId: 'tenant', loanId: 'loan', correlationId: 'corr-1' };

// ECC-20: opt-in wrap only. The adapter is not constructed by the factory while DC is OFF.
test('ECC-20: DeveloperConnectAdapter delegates to the wrapped client without forwarding context secrets', async () => {
  const seen: string[] = [];
  const adapter = new DeveloperConnectAdapter({
    listActiveAttachments: async (loanGuid) => {
      seen.push(`list:${loanGuid}`);
      return [{ id: 'one' }];
    },
    downloadOriginalAttachment: async (loanGuid, attachmentId) => {
      seen.push(`download:${loanGuid}:${attachmentId}`);
      return { bytes: new Uint8Array([1, 2]), sha256: 'ab'.repeat(32) };
    },
  });

  assert.equal(adapter.kind, 'developer-connect');
  assert.deepEqual(await adapter.listActiveAttachments(context, 'guid'), [{ id: 'one' }]);
  const downloaded = await adapter.downloadOriginalAttachment(context, 'guid', 'att');
  assert.equal(downloaded.bytes.length, 2);
  assert.deepEqual(seen, ['list:guid', 'download:guid:att']);
});
