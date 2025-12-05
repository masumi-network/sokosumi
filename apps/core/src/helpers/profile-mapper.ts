import crypto from "node:crypto";

import { z } from "@hono/zod-openapi";
import { userRepository } from "@sokosumi/database/repositories";

import { uploadImage } from "@/lib/blob";

/**
 * Maps OAuth profile data to user fields
 * Hash-based approach to avoid cookie size limits with base64 images
 */
export async function mapProfileToUser(profile: {
  name: string;
  picture: string;
}) {
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
}): Promise<{
  name: string;
  image: string | undefined;
  imageHash: string | null;
}> {
  const profilePicture = profile.picture;

  if (!profilePicture) {
    return {
      name: profile.name,
      image: undefined,
      imageHash: null,
    };
  }

  // 1. Check if it's a valid URL (pass through directly)
  if (z.httpUrl().safeParse(profilePicture).success) {
    // OAuth provider URLs are short and don't cause cookie issues
    // Just pass them through without uploading
    return {
      name: profile.name,
      image: profilePicture,
      imageHash: null,
    };
  }

  // 2. Check if it's a data URI (base64 encoded image)
  const dataUriRegex =
    /^data:image\/(png|jpg|jpeg|gif|webp|bmp|svg\+xml);base64,/;
  const dataUriMatch = profilePicture.match(dataUriRegex);

  if (dataUriMatch) {
    const imageHash = crypto
      .createHash("sha256")
      .update(profilePicture)
      .digest("hex");

    // Check if we've already stored this exact image
    const foundImage = await userRepository.findImageByHash(imageHash);
    if (foundImage) {
      return {
        name: profile.name,
        image: foundImage,
        imageHash,
      };
    }

    // Extract MIME type from data URI (e.g., "image/jpeg")
    const mimeType = `image/${dataUriMatch[1]}`;

    // Extract the base64 encoded image data
    const imageData = Buffer.from(
      profilePicture.replace(dataUriRegex, ""),
      "base64",
    );

    // Upload the image to Vercel Blob Storage
    const uploaded = await uploadImage(imageData, mimeType);
    return {
      name: profile.name,
      image: uploaded.url,
      imageHash,
    };
  }

  return {
    name: profile.name,
    image: undefined,
    imageHash: null,
  };
}
