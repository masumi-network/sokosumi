import { z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import type { BetterAuthOptions } from "better-auth/minimal";
import pTimeout from "p-timeout";
import { getEnv } from "@/config/env";
import { uploadProfileImage } from "@/lib/blob";

const env = getEnv();

export const socialProviderOptions = {
  google: {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    overrideUserInfoOnSignIn: false,
    mapProfileToUser,
  },
  microsoft: {
    clientId: env.MICROSOFT_CLIENT_ID,
    clientSecret: env.MICROSOFT_CLIENT_SECRET,
    overrideUserInfoOnSignIn: false,
    mapProfileToUser,
  },
} satisfies BetterAuthOptions["socialProviders"];

export const accountOptions = {
  accountLinking: {
    enabled: true,
    trustedProviders: ["google", "microsoft"],
    // requireLocalEmailVerified omitted so the 1.7 default (true) applies.
  },
} satisfies BetterAuthOptions["account"];

interface MappedProfileNameImage {
  name: string;
  image?: string;
}

interface MappedSocialProfile extends MappedProfileNameImage {
  emailVerified: true;
  [key: string]: unknown;
}

// Better Auth spreads this after its provider emailVerified. Microsoft Entra
// omits email_verified by default and would otherwise insert unverified users.
async function mapProfileToUser(profile: {
  name: string;
  picture: string;
}): Promise<MappedSocialProfile> {
  let mapped: MappedProfileNameImage;
  try {
    mapped = await pTimeout(mapProfileToUserInner(profile), {
      milliseconds: env.BETTER_AUTH_PROFILE_PICTURE_TIMEOUT,
    });
  } catch (error) {
    Sentry.captureException(error);
    console.error("Failed to map profile to user", {
      name: profile.name,
      pictureKind: profile.picture?.startsWith("data:")
        ? `data-uri(${profile.picture.length}b)`
        : "url",
      error,
    });
    mapped = {
      name: profile.name,
      image: undefined,
    };
  }
  return { ...mapped, emailVerified: true };
}

async function mapProfileToUserInner(profile: {
  name: string;
  picture: string;
}): Promise<MappedProfileNameImage> {
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
  }

  const imageURL = await uploadProfileImage(profilePicture);
  return {
    name: profile.name,
    image: imageURL ?? undefined,
  };
}
