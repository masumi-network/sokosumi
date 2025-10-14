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

export async function uploadAvatar(
  name: string,
  data: Buffer | Blob,
): Promise<PutBlobResult> {
  const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 50);
  const blob = await put(
    `${getEnvSecrets().VERCEL_AVATARS_UPLOAD_DIR}/${sanitizedName}`,
    data,
    {
      access: "public",
      addRandomSuffix: true,
    },
  );
  return blob;
}
