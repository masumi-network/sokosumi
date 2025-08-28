import "server-only";

import { uploadFile } from "@/lib/blob";
import { blobRepository } from "@/lib/db/repositories";
import { JobInputData } from "@/lib/job-input";

export interface UploadedFileWithMeta {
  url: string;
  fileName: string;
  size: number;
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
  inputData: JobInputData,
): Promise<UploadedFileWithMeta[]> {
  const results: UploadedFileWithMeta[] = [];
  for (const [key, value] of inputData.entries()) {
    if (value instanceof File) {
      const blob = await uploadFile(userId, value);
      inputData.set(key, blob.url);
      results.push({
        url: blob.url,
        fileName: value.name,
        size: value.size,
      });
    } else if (Array.isArray(value) && value.every((v) => v instanceof File)) {
      const uploaded = await Promise.all(
        value.map(async (file: File) => {
          const blob = await uploadFile(userId, file);
          return {
            url: blob.url,
            fileName: file.name,
            size: file.size,
          } satisfies UploadedFileWithMeta;
        }),
      );
      results.push(...uploaded);

      const fileUrls = uploaded.map((u) => u.url);
      if (fileUrls.length === 1) inputData.set(key, fileUrls[0]);
      else inputData.set(key, fileUrls);
    }
  }
  return results;
}

/**
 * This function save uploaded files to blob storage
 *
 * @param userId - The user id
 * @param jobId - The job id
 * @param fileUrls - The file urls
 */
export async function saveUploadedFiles(
  userId: string,
  jobId: string,
  files: UploadedFileWithMeta[],
) {
  for (const file of files) {
    await blobRepository.createBlob(
      userId,
      jobId,
      file.url,
      file.fileName,
      BigInt(file.size),
    );
  }
}
