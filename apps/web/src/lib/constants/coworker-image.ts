import {
  COWORKER_IMAGE_ALLOWED_MIME_TYPES,
  COWORKER_IMAGE_MAX_SIZE_BYTES,
} from "@sokosumi/utils";

export { COWORKER_IMAGE_ALLOWED_MIME_TYPES, COWORKER_IMAGE_MAX_SIZE_BYTES };

/** Comma-separated accept string for HTML file input / FileUpload. */
export const COWORKER_IMAGE_ACCEPT =
  COWORKER_IMAGE_ALLOWED_MIME_TYPES.join(",");
