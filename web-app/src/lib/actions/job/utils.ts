import "server-only";

import { uploadFile } from "@/lib/blob";
import { blobRepository } from "@/lib/db/repositories";
import { JobInputData } from "@/lib/job-input";

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
): Promise<string[]> {
  const results: string[] = [];
  for (const [key, value] of inputData.entries()) {
    if (value instanceof File) {
      const blob = await uploadFile(userId, value);
      inputData.set(key, blob.url);
      results.push(blob.url);
    } else if (Array.isArray(value) && value.every((v) => v instanceof File)) {
      const fileUrls = await Promise.all(
        value.map(async (file: File) => {
          const blob = await uploadFile(userId, file);
          return blob.url;
        }),
      );
      results.push(...fileUrls);

      if (fileUrls.length === 1) {
        inputData.set(key, fileUrls[0]);
      } else {
        inputData.set(key, fileUrls);
      }
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
  fileUrls: string[],
) {
  for (const fileUrl of fileUrls) {
    await blobRepository.createBlob(userId, jobId, fileUrl);
  }
}
