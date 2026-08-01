import { isOwnedEntityImageUrl } from "./entity-image-upload.js";

/** True when `url` is a public Vercel Blob URL under `users/{userId}/…`. */
export function isOwnedUserUploadUrl(url: string, userId: string): boolean {
  if (!userId) return false;
  return isOwnedEntityImageUrl(url, "users", userId);
}
