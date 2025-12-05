import crypto from "node:crypto";

import { z } from "@hono/zod-openapi";
import prisma from "@sokosumi/database/client";
import { userRepository } from "@sokosumi/database/repositories";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { apiKey, openAPI, organization } from "better-auth/plugins";

import { getEnv } from "@/config/env";
import { uploadImage } from "@/lib/blob";
import {
  renderEmailVerificationTemplate,
  renderOrganizationInvitationTemplate,
  renderPasswordResetTemplate,
} from "@/lib/email/index.js";
import { i18next } from "@/lib/i18next";
import { postmarkClient } from "@/lib/postmark";

const env = getEnv();

/**
 * Maps OAuth profile data to user fields
 * Hash-based approach to avoid cookie size limits with base64 images
 */
async function mapProfileToUser(profile: { name: string; picture: string }) {
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

// Build trusted origins based on environment
const trustedOrigins = ["https://*.sokosumi.com"];

// Add additional trusted origins from environment variable
if (env.TRUSTED_ORIGINS) {
  trustedOrigins.push(...env.TRUSTED_ORIGINS);
}

export const auth = betterAuth({
  advanced: {
    crossSubDomainCookies: {
      enabled: true,
    },
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 300, // 5 minutes in seconds
    },
  },
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  basePath: "/v1/auth",
  rateLimit: {
    storage: "database",
  },
  trustedOrigins,
  emailAndPassword: {
    enabled: true,
    maxPasswordLength: 256,
    minPasswordLength: 8,
    requireEmailVerification: false,
    autoSignIn: false,
    sendResetPassword: async ({ user, url }) => {
      const language = "en";
      const t = i18next.getFixedT(language, "emails");

      postmarkClient.sendEmail({
        From: env.POSTMARK_FROM_EMAIL,
        To: user.email,
        Tag: "reset-password",
        Subject: t("resetPassword.subject"),
        HtmlBody: renderPasswordResetTemplate({
          name: user.name,
          resetLink: url,
          lng: language,
        }),
        MessageStream: "authentications",
      });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      const language = "en";
      const t = i18next.getFixedT(language, "emails");

      postmarkClient.sendEmail({
        From: env.POSTMARK_FROM_EMAIL,
        To: user.email,
        Tag: "verification-email",
        Subject: t("verification.subject"),
        HtmlBody: renderEmailVerificationTemplate({
          name: user.name,
          verificationLink: url,
          lng: language,
        }),
        MessageStream: "authentications",
      });
    },
    sendOnSignUp: true,
    sendOnSignIn: true,
    expiresIn: 172800, // 2 days in seconds
    autoSignInAfterVerification: true,
  },
  user: {
    changeEmail: {
      enabled: true,
    },
    deleteUser: {
      enabled: true,
    },
    additionalFields: {
      termsAccepted: {
        type: "boolean",
        required: true,
        defaultValue: true,
      },
      marketingOptIn: {
        type: "boolean",
        required: true,
        defaultValue: true,
      },
      jobStatusNotificationsOptIn: {
        type: "boolean",
        required: false,
        defaultValue: true,
      },
      stripeCustomerId: {
        type: "string",
        required: false,
        defaultValue: null,
      },
      onboardingCompleted: {
        type: "boolean",
        required: true,
        defaultValue: false,
      },
      imageHash: {
        type: "string",
        required: false,
      },
    },
  },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      overrideUserInfoOnSignIn: true,
      mapProfileToUser,
    },
    microsoft: {
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
      overrideUserInfoOnSignIn: true,
      mapProfileToUser,
    },
  },
  plugins: [
    openAPI(),
    apiKey({
      rateLimit: {
        enabled: true,
        timeWindow: 60, // 60 seconds
        maxRequests: 100, // 100 requests per minute
      },
      enableMetadata: true,
    }),
    organization({
      invitationLimit: 100,
      organizationLimit: 100,
      invitationExpiresIn: 604800, // 7 days in seconds
      cancelPendingInvitationsOnReInvite: true,
      allowUserToCreateOrganization(user) {
        return user.emailVerified;
      },
      async sendInvitationEmail(data) {
        const inviteLink = `${env.BETTER_AUTH_URL}/accept-invitation/${data.id}`;
        const language = "en";
        const t = i18next.getFixedT(language, "emails");

        postmarkClient.sendEmail({
          From: env.POSTMARK_FROM_EMAIL,
          To: data.email,
          Tag: "invitation-email",
          Subject: t("invitation.subject"),
          HtmlBody: renderOrganizationInvitationTemplate({
            organizationName: data.organization.name,
            invitorUsername: data.inviter.user.name,
            invitationLink: inviteLink,
            lng: language,
          }),
          MessageStream: "organizations",
        });
      },
      schema: {
        organization: {
          additionalFields: {
            stripeCustomerId: {
              type: "string",
              required: false,
              defaultValue: null,
              input: false,
            },
            invoiceEmail: {
              type: "string",
              required: false,
              defaultValue: null,
              input: false,
            },
          },
        },
      },
    }),
  ],
});
