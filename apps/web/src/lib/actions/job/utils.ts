import "server-only";

import { InputSchemaType } from "@sokosumi/masumi/schemas";

import { uploadFileForUser } from "@/lib/blob/utils";

/**
 * Upload files found in inputData to blob storage and replace file values with URLs.
 *
 * @param userId - The user id
 * @param inputData - The input data
 */
export async function handleInputDataFileUploads(
  userId: string,
  inputData: InputSchemaType,
): Promise<void> {
  for (const [key, value] of Object.entries(inputData)) {
    if (value instanceof File) {
      const blob = await uploadFileForUser(userId, value);
      inputData[key] = blob.url;
    } else if (Array.isArray(value) && value.every((v) => v instanceof File)) {
      const uploaded = await Promise.all(
        value.map(async (file: File) => {
          const blob = await uploadFileForUser(userId, file);
          return blob.url;
        }),
      );
      if (uploaded.length === 1) {
        inputData[key] = uploaded[0];
      } else {
        inputData[key] = uploaded;
      }
    }
  }
}
