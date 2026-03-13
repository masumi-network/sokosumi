import { apiKey } from "@better-auth/api-key";
import { i18n } from "@better-auth/i18n";
import { oauthProvider } from "@better-auth/oauth-provider";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { renderMagicLinkEmail } from "@sokosumi/email";
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

const env = getEnv();
const EMAIL_LOCALE_COOKIE_NAMES = new Set(["sokosumi.locale", "locale"]);

interface ParsedLanguagePreference {
  index: number;
  quality: number;
  tag: string;
}

function normalizeLocaleTag(
  rawLocale: null | string | undefined,
): null | string {
  if (!rawLocale) {
    return null;
  }

  const trimmedLocale = rawLocale.trim();

  if (!trimmedLocale || trimmedLocale === "*") {
    return null;
  }

  try {
    return (
      Intl.getCanonicalLocales(trimmedLocale.replaceAll("_", "-")).at(0) ?? null
    );
  } catch {
    return null;
  }
}

function parseLocaleCookie(cookieHeader?: null | string): null | string {
  if (!cookieHeader) {
    return null;
  }

  for (const rawCookie of cookieHeader.split(";")) {
    const separatorIndex = rawCookie.indexOf("=");

    if (separatorIndex < 0) {
      continue;
    }

    const cookieName = rawCookie.slice(0, separatorIndex).trim();

    if (!EMAIL_LOCALE_COOKIE_NAMES.has(cookieName)) {
      continue;
    }

    const cookieValue = rawCookie.slice(separatorIndex + 1).trim();

    if (!cookieValue) {
      return null;
    }

    try {
      return normalizeLocaleTag(decodeURIComponent(cookieValue));
    } catch {
      return normalizeLocaleTag(cookieValue);
    }
  }

  return null;
}

function parseAcceptLanguage(
  acceptLanguageHeader?: null | string,
): null | string {
  if (!acceptLanguageHeader) {
    return null;
  }

  const preferences = acceptLanguageHeader
    .split(",")
    .map((part, index): null | ParsedLanguagePreference => {
      const [rawTag, ...rawParams] = part.split(";");
      const normalizedTag = normalizeLocaleTag(rawTag);

      if (!normalizedTag) {
        return null;
      }

      let quality = 1;

      for (const rawParam of rawParams) {
        const [rawKey, rawValue] = rawParam.split("=");

        if (rawKey?.trim().toLowerCase() !== "q") {
          continue;
        }

        if (!rawValue) {
          return null;
        }

        const parsedQuality = Number.parseFloat(rawValue.trim());

        if (
          Number.isNaN(parsedQuality) ||
          parsedQuality < 0 ||
          parsedQuality > 1
        ) {
          return null;
        }

        quality = parsedQuality;
        break;
      }

      if (quality === 0) {
        return null;
      }

      return {
        index,
        quality,
        tag: normalizedTag,
      };
    })
    .filter((preference): preference is ParsedLanguagePreference =>
      Boolean(preference),
    )
    .sort((left, right) => {
      if (left.quality !== right.quality) {
        return right.quality - left.quality;
      }

      return left.index - right.index;
    });

  return preferences.at(0)?.tag ?? null;
}

function getEmailLocale(
  request?: Request,
  fallbackHeaders?: Headers,
): string | undefined {
  const cookieHeader =
    request?.headers.get("cookie") ?? fallbackHeaders?.get("cookie") ?? null;
  const acceptLanguageHeader =
    request?.headers.get("accept-language") ??
    fallbackHeaders?.get("accept-language") ??
    null;

  return (
    parseLocaleCookie(cookieHeader) ??
    parseAcceptLanguage(acceptLanguageHeader) ??
    undefined
  );
}

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
      sendMagicLink: async ({ email, url, token }, ctx) => {
        const locale = getEmailLocale(ctx?.request, ctx?.headers);
        const name =
          typeof ctx?.body?.name === "string" ? ctx.body.name : undefined;
        const renderedEmail = await renderMagicLinkEmail({
          locale,
          magicLink: url,
          name,
          token,
        });

        await postmarkClient.sendEmail({
          From: env.POSTMARK_FROM_EMAIL,
          To: email,
          Tag: "magic-link",
          Subject: renderedEmail.subject,
          HtmlBody: renderedEmail.html,
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
      silenceWarnings: {
        oauthAuthServerConfig: true,
      },
    }),
  ],
});
