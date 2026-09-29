import type { BlobFile } from "@/lib/clients/generated/core";
import {
  cleanupOwnedLogoBestEffort,
  type UploadUserFileDirectOptions,
  uploadOwnedLogoDirect,
} from "@/lib/utils/user-file-upload.client";

export {
  getUserFileUploadErrorMessage as getOrganizationLogoUploadErrorMessage,
  UserFileUploadError,
} from "@/lib/utils/user-file-upload.client";
export type {
  UploadUserFileDirectOptions as UploadOrganizationLogoDirectOptions,
};

export async function uploadOrganizationLogoDirect(
  organizationId: string,
  file: File,
  options: UploadUserFileDirectOptions = {},
): Promise<BlobFile> {
  return uploadOwnedLogoDirect({
    kind: "organization",
    ownerId: organizationId,
    file,
    options,
  });
}

export async function cleanupOrganizationLogoBestEffort(
  organizationId: string,
  previousLogoUrl: string | null | undefined,
): Promise<void> {
  return cleanupOwnedLogoBestEffort(
    "organization",
    organizationId,
    previousLogoUrl,
  );
}
