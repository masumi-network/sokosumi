import { z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import type { BetterAuthOptions } from "better-auth/minimal";
import pTimeout from "p-timeout";
import { getEnv } from "@/config/env";
import { uploadProfileImage } from "@/lib/blob";

const env = getEnv();

/** The providers a person can sign in or sign up with, besides email. */
export const SOCIAL_PROVIDER_IDS = ["google", "microsoft"] as const;
export type SocialProviderId = (typeof SOCIAL_PROVIDER_IDS)[number];

export function isSocialProviderId(
  value: string | undefined,
): value is SocialProviderId {
  return SOCIAL_PROVIDER_IDS.some((provider) => provider === value);
}

export const socialProviderOptions = {
  google: {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    disableIdTokenSignIn: true,
    overrideUserInfoOnSignIn: false,
    mapProfileToUser,
  },
  microsoft: {
    clientId: env.MICROSOFT_CLIENT_ID,
    clientSecret: env.MICROSOFT_CLIENT_SECRET,
    disableIdTokenSignIn: true,
    overrideUserInfoOnSignIn: false,
    mapProfileToUser,
  },
} satisfies BetterAuthOptions["socialProviders"] &
  Record<SocialProviderId, object>;

export const accountOptions = {
  accountLinking: {
    enabled: true,
    trustedProviders: [...SOCIAL_PROVIDER_IDS],
    // requireLocalEmailVerified omitted so the 1.7 default (true) applies.
  },
  // The key derives from BETTER_AUTH_SECRET, or from the first entry of
  // BETTER_AUTH_SECRETS when that is set. To rotate, set BETTER_AUTH_SECRETS
  // and keep BETTER_AUTH_SECRET as the legacy key: replacing it in place makes
  // the encrypted tokens unreadable. Turning this off needs a decrypt backfill
  // first, or Better Auth returns the stored ciphertext as the token. Tokens
  // stored before this stay plaintext until the provider sends new ones, and
  // Better Auth still reads them. idToken is never encrypted (SOK-1178).
  encryptOAuthTokens: true,
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
  given_name?: string;
  family_name?: string;
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
  return {
    ...mapped,
    // Prefills the onboarding form. A provider may leave either claim out.
    firstName: profile.given_name?.trim() || undefined,
    lastName: profile.family_name?.trim() || undefined,
    emailVerified: true,
  };
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
