import type { LiveDocument } from './parseTypes';
import type { ConsoleContext } from './protectedWorkflow';
import {
  protectedWorkspaceContext,
  protectedWorkspaceDocuments,
  type ProtectedWorkspaceContext,
} from './protectedWorkspace';

export const DEMO_DOCUMENT_PREFIX = '/demo-documents';

export type DemoPacket = Readonly<{
  documents: LiveDocument[];
  context: ProtectedWorkspaceContext | null;
}>;

type DemoPacketFile = {
  documents: { attachmentId: string; fileName: string }[];
  context: ConsoleContext;
};

/**
 * The public demo's sample loan, rehydrated through the same functions as a
 * signed-in loan. console-context.json holds what the live tool would have
 * stored for these PDFs (see apps/underwriter-portal/scripts/
 * build-demo-console-context.ts), so the worksheets and highlights match live.
 */
export async function loadDemoPacket(
  fetchImpl: typeof fetch = fetch,
  prefix = DEMO_DOCUMENT_PREFIX,
): Promise<DemoPacket> {
  const response = await fetchImpl(`${prefix}/console-context.json`);
  if (!response.ok) throw new Error('DEMO_PACKET_UNAVAILABLE');
  const packet = (await response.json()) as DemoPacketFile;
  const local = await Promise.all(
    packet.documents.map(async ({ attachmentId, fileName }) => {
      const pdf = await fetchImpl(`${prefix}/${fileName}`);
      if (!pdf.ok) throw new Error('DEMO_PACKET_UNAVAILABLE');
      const blob = await pdf.blob();
      return { attachmentId, file: new File([blob], fileName, { type: 'application/pdf' }) };
    }),
  );
  return {
    documents: protectedWorkspaceDocuments(packet.context, local),
    context: protectedWorkspaceContext(packet.context),
  };
}
