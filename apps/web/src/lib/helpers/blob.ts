import { Blob } from "@sokosumi/database";

export function getBlobUrl(blob: Blob): string {
  return blob.fileUrl ?? blob.sourceUrl ?? "#";
}
