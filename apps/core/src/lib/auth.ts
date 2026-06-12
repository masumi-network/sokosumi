import { apiKey } from "@better-auth/api-key";
import { i18n } from "@better-auth/i18n";
import { oauthProvider } from "@better-auth/oauth-provider";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import * as Sentry from "@sentry/node";
import { workspaceRepository } from "@sokosumi/database/repositories";
import { renderMagicLinkEmail } from "@sokosumi/email";
import { authTranslations } from "@sokosumi/masumi/auth";
import {
  getStoredUserName,
  resolveBetterAuthCookiePrefix,
} from "@sokosumi/utils";
import { betterAuth } from "better-auth/minimal";
import {
  admin,
  jwt,
  magicLink,
  oAuthProxy,
  openAPI,
  organization,
} from "better-auth/plugins";
import { postmarkClient } from "@/clients/postmark.client";
import { stripeClient } from "@/clients/stripe.client";
import { getBetterAuthProductionUrl } from "@/config/better-auth-production-url";
import { LIMITS, TIME } from "@/config/constants";
import {
  getBetterAuthPublicBaseUrl,
  getEnv,
  getWebAppBaseUrl,
} from "@/config/env";
import prisma from "@/lib/db/prisma";

const env = getEnv();
const webAppBaseUrl = getWebAppBaseUrl();
const betterAuthBaseUrl = getBetterAuthPublicBaseUrl();
const betterAuthCookiePrefix = resolveBetterAuthCookiePrefix({
  network: env.NETWORK,
  vercelEnv: env.VERCEL_ENV,
  vercelGitCommitRef: env.VERCEL_GIT_COMMIT_REF,
});

async function ensureWorkspaceForCreatedUser(user: {
  email: string;
  id: string;
  name: string;
}): Promise<void> {
  try {
    await workspaceRepository.upsertPersonalWorkspace({
      userId: user.id,
      tx: prisma,
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        context: "workspace_user_creation",
      },
      extra: {
        email: user.email,
        name: user.name,
        userId: user.id,
      },
    });
  }
}

async function ensureWorkspaceForCreatedOrganization(organization: {
  id: string;
  name: string;
}): Promise<void> {
  try {
    await workspaceRepository.upsertOrganizationWorkspace({
      organizationId: organization.id,
      tx: prisma,
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        context: "workspace_organization_creation",
      },
      extra: {
        organizationId: organization.id,
        organizationName: organization.name,
      },
    });
  }
}

export const auth = betterAuth({
  appName: "Sokosumi",
  advanced: {
    database: {
      generateId: "uuid",
    },
    cookiePrefix: betterAuthCookiePrefix,
    ...(env.BETTER_AUTH_COOKIE_DOMAIN
      ? {
          crossSubDomainCookies: {
            enabled: true,
            domain: env.BETTER_AUTH_COOKIE_DOMAIN,
          },
        }
      : {}),
    ipAddress: {
      ipAddressHeaders: ["x-vercel-forwarded-for", "x-forwarded-for"],
    },
  },
  experimental: {
    joins: true,
  },
  session: {
    storeSessionInDatabase: true,
  },
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  databaseHooks: {
    user: {
      create: {
        before: async (user, _ctx) => {
          return {
            data: {
              ...user,
              name: getStoredUserName(user.name, user.email),
            },
          };
        },
        after: async (user, _ctx) => {
          await ensureWorkspaceForCreatedUser(user);
          stripeClient
            .createUserCustomer({
              email: user.email,
              name: user.name,
              userId: user.id,
            })
            .catch((error) => {
              Sentry.captureException(error, {
                tags: {
                  context: "stripe_user_customer_creation",
                },
                extra: {
                  userId: user.id,
                  email: user.email,
                  name: user.name,
                },
              });
            });
        },
      },
    },
  },
  secret: env.BETTER_AUTH_SECRET,
  baseURL: betterAuthBaseUrl,
  basePath: "/auth",
  rateLimit: {
    storage: "database",
  },
  trustedOrigins: [
    "https://app.sokosumi.com",
    "https://preprod.sokosumi.com",
    "https://*.preview.sokosumi.com", // Vercel preview deployment suffix
    ...(env.NODE_ENV === "development"
      ? ["http://localhost:*"] // local dev only; omit in staging/production deploys
      : []),
  ],
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
      logo: {
        type: "string",
        required: false,
        defaultValue: null,
      },
      metadata: {
        type: "string",
        required: false,
        defaultValue: null,
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
      storeToken: "hashed",
      sendMagicLink: async ({ email, url }, ctx) => {
        const name =
          typeof ctx?.body?.name === "string" ? ctx.body.name : undefined;
        const renderedEmail = await renderMagicLinkEmail({
          locale: "en",
          magicLink: url,
          name,
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
      organizationHooks: {
        afterCreateOrganization: async ({ organization }) => {
          await ensureWorkspaceForCreatedOrganization(organization);
        },
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
          },
        },
      },
    }),
    oauthProvider({
      loginPage: `${webAppBaseUrl}/signin`,
      consentPage: `${webAppBaseUrl}/oauth/consent`,
      scopes: ["openid"],
      clientRegistrationDefaultScopes: ["openid"],
      grantTypes: ["authorization_code"],
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
    oAuthProxy({
      productionURL: getBetterAuthProductionUrl(),
    }),
  ],
});
