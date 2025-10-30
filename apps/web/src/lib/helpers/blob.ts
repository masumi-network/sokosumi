import { Blob } from "@sokosumi/database";

export function getBlobUrl(blob: Blob): string {
  return blob.fileUrl ?? blob.sourceUrl ?? "#";
}

export function getBlobFileName(blob: Blob): string | null {
  return blob.fileName ?? null;
}
