export interface BlobUrlLike {
  fileUrl?: string | null;
  sourceUrl?: string | null;
}

export function getBlobUrl(blob: BlobUrlLike): string {
  return blob.fileUrl ?? blob.sourceUrl ?? "#";
}
