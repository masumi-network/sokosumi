import prisma from "@sokosumi/database/client";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { apiKey, openAPI, organization } from "better-auth/plugins";

// Build trusted origins based on environment
const trustedOrigins = ["https://*.sokosumi.com"];

// Add localhost origins in non-production environments
if (process.env.NODE_ENV !== "production") {
  trustedOrigins.push(
    "http://localhost:3000",
    "http://localhost:8787", // Core API default port
  );
}

// Add additional trusted origins from environment variable
// Format: comma-separated list (e.g., "http://localhost:4000,https://custom.dev")
if (process.env.TRUSTED_ORIGINS) {
  const additionalOrigins = process.env.TRUSTED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  trustedOrigins.push(...additionalOrigins);
}

export const auth = betterAuth({
  advanced: {
    crossSubDomainCookies: {
      enabled: true,
    },
  },
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
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
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      overrideUserInfoOnSignIn: true,
    },
    microsoft: {
      clientId: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
      overrideUserInfoOnSignIn: true,
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
      allowUserToCreateOrganization(user) {
        return user.emailVerified;
      },
      cancelPendingInvitationsOnReInvite: true,
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
  user: {
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
});
