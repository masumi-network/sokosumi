import {
  type UploadUserFileDirectOptions,
  uploadUserFileDirect,
} from "@/lib/utils/user-file-upload.client";

export type UploadTaskAttachmentOptions = Pick<
  UploadUserFileDirectOptions,
  "abortSignal" | "onUploadProgress"
>;

export async function uploadTaskAttachment(
  file: File,
  options: UploadTaskAttachmentOptions = {},
): Promise<string> {
  const response = await uploadUserFileDirect(file, options);
  return response.publicUrl;
}
