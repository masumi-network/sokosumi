import "server-only";

import { blobRepository } from "@sokosumi/database/repositories";

import { uploadFile } from "@/lib/blob";
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
  for (const [key, value] of Object.entries(inputData)) {
    if (value instanceof File) {
      const blob = await uploadFile(userId, value);
      inputData[key] = blob.url;
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
      if (fileUrls.length === 1) {
        inputData[key] = fileUrls[0];
      } else {
        inputData[key] = fileUrls;
      }
    }
  }
  return results;
}

/**
 * This function save uploaded files to blob storage
 *
 * @param userId - The user id
 * @param jobStatusId - The job status id
 * @param files - The uploaded files with metadata
 */
export async function saveUploadedFiles(
  userId: string,
  jobStatusId: string,
  files: UploadedFileWithMeta[],
) {
  for (const file of files) {
    await blobRepository.createInputBlob(
      userId,
      jobStatusId,
      file.url,
      file.fileName,
      BigInt(file.size),
    );
  }
}
