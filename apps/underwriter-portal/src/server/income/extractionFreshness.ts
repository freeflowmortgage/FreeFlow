export type CalculationExtractionProvenance = Readonly<{
  extractionId: string;
  extractionHash: string;
  sourceDocumentId: string;
  sourceDocumentVersion: number;
  sourceContentHash: string;
  metadataReviewId?: string | null;
  metadataReviewVersion?: number | null;
  metadataReviewHash?: string | null;
  extraction: Readonly<{
    status: 'ACTIVE' | 'SUPERSEDED';
    canonicalHash: string;
    sourceDocumentVersion: number;
    sourceContentHash: string;
    sourceDocument: Readonly<{ version: number; sourceContentHash: string | null }>;
    metadataReviews?: ReadonlyArray<Readonly<{ id: string; metadataVersion: number; canonicalHash: string }>>;
  }>;
}>;

export function hasCurrentCalculationExtractions(
  bindings: ReadonlyArray<CalculationExtractionProvenance>,
): boolean {
  return bindings.length > 0 && bindings.every((binding) =>
    binding.extraction.status === 'ACTIVE'
    && binding.extractionHash === binding.extraction.canonicalHash
    && binding.sourceDocumentVersion === binding.extraction.sourceDocumentVersion
    && binding.sourceContentHash === binding.extraction.sourceContentHash
    && binding.extraction.sourceDocument.version === binding.sourceDocumentVersion
    && binding.extraction.sourceDocument.sourceContentHash === binding.sourceContentHash
    && metadataIsCurrent(binding));
}

function metadataIsCurrent(binding: CalculationExtractionProvenance): boolean {
  const latest = binding.extraction.metadataReviews?.[0];
  if (!binding.metadataReviewId) return !latest;
  return latest?.id === binding.metadataReviewId
    && latest.metadataVersion === binding.metadataReviewVersion
    && latest.canonicalHash === binding.metadataReviewHash;
}
