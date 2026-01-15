import "server-only";

import { InputSchemaType } from "@sokosumi/masumi/schemas";

import { uploadFile } from "@/lib/blob";

export interface UploadedFile {
  userId: string;
  url: string;
  name?: string;
  size?: bigint;
  mimeType?: string;
}

/**
 * This function upload files from inputData to blob storage and return the file urls
 *
 * @param userId - The user id
 * @param inputData - The input data
 * @returns The file urls
 */
export async function handleInputDataFileUploads(
  userId: string,
  inputData: InputSchemaType,
): Promise<UploadedFile[]> {
  const results: UploadedFile[] = [];
  for (const [key, value] of Object.entries(inputData)) {
    if (value instanceof File) {
      const blob = await uploadFile(userId, value);
      inputData[key] = blob.url;
      results.push({
        userId,
        url: blob.url,
        name: value.name,
        size: BigInt(value.size),
        mimeType: blob.contentType,
      });
    } else if (Array.isArray(value) && value.every((v) => v instanceof File)) {
      const uploaded = await Promise.all(
        value.map(async (file: File) => {
          const blob = await uploadFile(userId, file);
          return {
            userId,
            url: blob.url,
            name: file.name,
            size: BigInt(file.size),
            mimeType: blob.contentType,
          } satisfies UploadedFile;
        }),
      );
      results.push(...uploaded);

      const fileUrls = uploaded.map((u) => u.url);
      if (fileUrls.length === 1) {
        inputData[key] = fileUrls[0];
      } else {
        inputData[key] = fileUrls;
      }
    }
  }
  return results;
}
