import "server-only";

import { put, PutBlobResult } from "@vercel/blob";

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
