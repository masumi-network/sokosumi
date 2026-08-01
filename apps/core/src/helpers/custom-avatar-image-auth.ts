import { userRepository } from "@sokosumi/database/repositories";
import { isOwnedUserUploadUrl } from "@sokosumi/utils";

import prisma from "@/lib/db/prisma";
import { resolveDatabaseHookUserId } from "@/services/stripe-user-email.service";

/**
 * Protects a custom personal avatar (`User.image` under `users/{userId}/`) from
 * being wiped by OAuth profile sync. Explicit `null` clears are allowed.
 */
export async function applyCustomAvatarImageGuardToUserUpdate(
  updateData: Record<string, unknown>,
  ctx: unknown,
): Promise<Record<string, unknown>> {
  if (!Object.hasOwn(updateData, "image")) {
    return updateData;
  }

  if (updateData.image === null) {
    return updateData;
  }

  const userId = resolveDatabaseHookUserId(ctx, updateData);
  const existing = userId
    ? await userRepository.getUserById(userId, prisma)
    : null;
  const existingImage =
    typeof existing?.image === "string" ? existing.image : null;

  if (
    !userId ||
    !existingImage ||
    !isOwnedUserUploadUrl(existingImage, userId)
  ) {
    return updateData;
  }

  const nextImage = updateData.image;
  const nextIsOwnedUpload =
    typeof nextImage === "string" && isOwnedUserUploadUrl(nextImage, userId);

  if (nextIsOwnedUpload) {
    return updateData;
  }

  const { image: _image, ...rest } = updateData;
  return rest;
}
