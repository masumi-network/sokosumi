import { Blob } from "@/prisma/generated/client";

export function getBlobUrl(blob: Blob): string {
  return blob.fileUrl ?? blob.sourceUrl ?? "#";
}

export function getBlobFileName(blob: Blob): string | null {
  return blob.fileName ?? null;
}

export function getBlobKey(blob: Blob): string {
  return blob.id ?? `${getBlobUrl(blob)}-${getBlobFileName(blob)}` ?? "";
}
