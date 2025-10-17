import "server-only";

import { put, PutBlobResult } from "@vercel/blob";

import { getEnvSecrets } from "@/config/env.secrets";

export async function uploadFile(
  userId: string,
  inputFile: File,
): Promise<PutBlobResult> {
  const blob = await put(
    `${userId}/${inputFile.name.replace(/ /g, "_")}`,
    inputFile,
    {
      access: "public",
      addRandomSuffix: true,
    },
  );
  return blob;
}

export async function uploadImage(
  data: Buffer | Blob,
  contentType?: string,
): Promise<PutBlobResult> {
  const blob = await put(
    `${getEnvSecrets().VERCEL_IMAGES_UPLOAD_DIR}/${crypto.randomUUID()}`,
    data,
    {
      access: "public",
      contentType,
    },
  );
  return blob;
}
