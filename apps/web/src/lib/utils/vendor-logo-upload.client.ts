import type { BlobFile } from "@/lib/clients/generated/core";
import {
  cleanupOwnedLogoBestEffort,
  type UploadUserFileDirectOptions,
  uploadOwnedLogoDirect,
} from "@/lib/utils/user-file-upload.client";

export {
  getUserFileUploadErrorMessage as getVendorLogoUploadErrorMessage,
  UserFileUploadError,
} from "@/lib/utils/user-file-upload.client";
export type { UploadUserFileDirectOptions as UploadVendorLogoDirectOptions };

export async function uploadVendorLogoDirect(
  vendorId: string,
  file: File,
  options: UploadUserFileDirectOptions = {},
): Promise<BlobFile> {
  return uploadOwnedLogoDirect({
    kind: "vendor",
    ownerId: vendorId,
    file,
    options,
  });
}

export async function cleanupVendorLogoBestEffort(
  vendorId: string,
  previousLogoUrl: string | null | undefined,
): Promise<void> {
  return cleanupOwnedLogoBestEffort("vendor", vendorId, previousLogoUrl);
}
