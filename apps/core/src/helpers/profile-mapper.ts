import { z } from "@hono/zod-openapi";
import type { User } from "@sokosumi/database";

import { uploadProfileImage } from "@/lib/blob.js";

/**
 * Maps OAuth profile data to user fields
 * Hash-based approach to avoid cookie size limits with base64 images
 */
export async function mapProfileToUser(profile: {
  name: string;
  picture: string;
}): Promise<Partial<User>> {
  try {
    return await mapProfileToUserInner(profile);
  } catch (error) {
    console.error(
      `Failed to map profile to user: ${JSON.stringify(profile)}`,
      error,
    );
    return {
      name: profile.name,
      image: undefined,
    };
  }
}

/**
 * Inner function for profile mapping
 * Due to Cookie size limit (4KB) and JWT encryption,
 * we can NOT store big profile images (which are stored in cookies)
 */
async function mapProfileToUserInner(profile: {
  name: string;
  picture: string;
}): Promise<Partial<User>> {
  const profilePicture = profile.picture;

  if (!profilePicture) {
    return {
      name: profile.name,
      image: undefined,
    };
  }

  if (z.httpUrl().safeParse(profilePicture).success) {
    return {
      name: profile.name,
      image: profilePicture,
    };
  } else {
    const imageURL = await uploadProfileImage(profilePicture);
    return {
      name: profile.name,
      image: imageURL,
    };
  }
}
