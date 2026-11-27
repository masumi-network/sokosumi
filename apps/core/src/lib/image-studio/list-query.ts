export const assetSelect = {
  id: true,
  projectId: true,
  project: { select: { name: true } },
  settings: true,
  rootId: true,
  parentId: true,
  version: true,
  prompt: true,
  model: true,
  width: true,
  height: true,
  bytes: true,
  contentType: true,
  mediaType: true,
  aiGenerated: true,
  durationSeconds: true,
  createdAt: true,
  jobId: true,
  headline: { select: { text: true, revision: true } },
  job: {
    select: {
      lettering: true,
      productId: true,
      productName: true,
      batchId: true,
      batchSlot: { select: { batchId: true } },
    },
  },
} as const;

export const jobSelect = {
  id: true,
  projectId: true,
  status: true,
  kind: true,
  model: true,
  prompt: true,
  settings: true,
  referenceAssetIds: true,
  brandReferenceCount: true,
  referenceFileIds: true,
  useProductCutout: true,
  lettering: true,
  exportHeadline: true,
  productId: true,
  productName: true,
  error: true,
  failureReason: true,
  parentAssetId: true,
  createdAt: true,
  submittedAt: true,
  settledAt: true,
  cancelRequestedAt: true,
  chargedCents: true,
  transactionId: true,
  asset: { select: { id: true } },
  templateId: true,
  creativeDirection: true,
  variationIndex: true,
} as const;

export interface StudioPageCursor {
  createdAt: Date;
  id: string;
}

export function olderStudioRows(before: StudioPageCursor | undefined) {
  if (!before) return {};
  return {
    OR: [
      { createdAt: { lt: before.createdAt } },
      { createdAt: before.createdAt, id: { lt: before.id } },
    ],
  };
}
