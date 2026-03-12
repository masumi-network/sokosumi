import { apiKey } from "@better-auth/api-key";
import { i18n } from "@better-auth/i18n";
import { oauthProvider } from "@better-auth/oauth-provider";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { authTranslations } from "@sokosumi/masumi/auth";
import { betterAuth } from "better-auth/minimal";
import {
  admin,
  jwt,
  magicLink,
  openAPI,
  organization,
} from "better-auth/plugins";

import { postmarkClient } from "@/clients/postmark.client";
import { LIMITS, TIME } from "@/config/constants";
import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import { renderMagicLinkTemplate } from "@/lib/email";

const env = getEnv();

export const auth = betterAuth({
  appName: "Sokosumi", // Define the name of your application
  advanced: {
    crossSubDomainCookies: {
      enabled: true,
    },
    ipAddress: {
      // For Vercel
      ipAddressHeaders: ["x-vercel-forwarded-for", "x-forwarded-for"],
    },
  },
  experimental: {
    joins: true,
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: TIME.SESSION_COOKIE_CACHE_MAX_AGE,
    },
    storeSessionInDatabase: true,
  },
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  basePath: "/auth",
  rateLimit: {
    storage: "database",
  },
  trustedOrigins: [env.BETTER_AUTH_TRUSTED_ORIGIN],
  user: {
    emailAndPassword: {
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
      notificationsOptIn: {
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
    },
  },
  plugins: [
    magicLink({
      expiresIn: 60 * 60 * 48, // 48 hours in seconds
      allowedAttempts: 1,
      sendMagicLink: async ({ email, url, token }, ctx) => {
        const name =
          typeof ctx?.body?.name === "string" ? ctx.body.name : undefined;

        await postmarkClient.sendEmail({
          From: env.POSTMARK_FROM_EMAIL,
          To: email,
          Tag: "magic-link",
          Subject: "Sokosumi - Magic Link",
          HtmlBody: renderMagicLinkTemplate({
            magicLink: url,
            token,
            name,
          }),
          MessageStream: "authentications",
        });
      },
    }),
    i18n({
      translations: authTranslations,
      defaultLocale: "en",
      detection: ["header", "cookie"],
    }),
    openAPI(),
    admin(),
    apiKey({
      configId: "default",
      references: "user",
      rateLimit: {
        enabled: true,
        timeWindow: TIME.RATE_LIMIT_WINDOW,
        maxRequests: LIMITS.API_KEY_MAX_REQUESTS_PER_MINUTE,
      },
      enableMetadata: true,
    }),
    jwt({ disableSettingJwtHeader: true }),
    organization({
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
    oauthProvider({
      loginPage: `${env.BETTER_AUTH_TRUSTED_ORIGIN}/signin`,
      consentPage: `${env.BETTER_AUTH_TRUSTED_ORIGIN}/oauth/consent`,
      scopes: ["openid", "offline_access"],
      clientRegistrationDefaultScopes: ["openid", "offline_access"],
      accessTokenExpiresIn: 7_200, // 2 hours (default: 3_600)
      refreshTokenExpiresIn: 7_776_000, // 90 days (default: 2_592_000)
      idTokenExpiresIn: 72_000, // 20 hours (default: 3_6000)
      codeExpiresIn: 600, // 10 minutes (default: 600)
      prefix: {
        opaqueAccessToken: "soko_access_token_",
        refreshToken: "soko_refresh_token_",
        clientSecret: "soko_client_secret_",
      },
    }),
  ],
});
