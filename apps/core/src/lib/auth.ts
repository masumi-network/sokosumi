import prisma from "@sokosumi/database/client";
import { APIError, betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import {
  apiKey,
  createAuthMiddleware,
  openAPI,
  organization,
} from "better-auth/plugins";
import { localization } from "better-auth-localization";

import { stripeClient } from "@/clients/stripe.client";
import { getEnv } from "@/config/env";
import { mapProfileToUser } from "@/helpers/profile-mapper";
import {
  renderEmailVerificationTemplate,
  renderOrganizationInvitationTemplate,
  renderPasswordResetTemplate,
} from "@/lib/email/index.js";
import { i18next } from "@/lib/i18next";
import { postmarkClient } from "@/lib/postmark";
import { webhookService } from "@/services/webhook.service";

// Example getUserLocale implementation (adapt to your needs)
async function getUserLocale(request: Request): Promise<string | null> {
  // Could check user preferences from database, cookies, headers, etc.
  // return await db.user.getLocale(userId);
  // return getCookieValue(request, 'locale');
  return request.headers.get("x-user-locale");
}

const env = getEnv();

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
  databaseHooks: {
    account: {
      create: {
        after: async (account, _ctx) => {
          webhookService.callAccountCreated(account.userId, account.providerId);
        },
      },
    },
    user: {
      create: {
        before: async (user, _ctx) => {
          if (!user.termsAccepted) {
            return false;
          }
          return true;
        },
        after: async (user, _ctx) => {
          await stripeClient.createUserCustomer(user.id, user.name, user.email);
          webhookService.callUserCreated(user);
        },
      },
      update: {
        after: async (user, _ctx) => {
          webhookService.callUserUpdated(user);
        },
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      switch (ctx.path) {
        // Check if user has accepted terms
        case "/sign-up/email": {
          if (!ctx.body?.termsAccepted) {
            throw new APIError("BAD_REQUEST", {
              code: "TERMS_NOT_ACCEPTED",
            });
          }
          break;
        }
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      // Check if user has accepted terms
      if (ctx.path.startsWith("/sign-in")) {
        const user = ctx.context.newSession?.user;
        if (user && !user.termsAccepted) {
          throw new APIError("BAD_REQUEST", {
            code: "TERMS_NOT_ACCEPTED",
          });
        }
      }
      // Sync user email with Stripe after email change verification
      if (ctx.path === "/verify-email" && ctx.context.newSession?.user) {
        const user = ctx.context.newSession?.user;
        if (user.stripeCustomerId && user.email) {
          // Fire and forget - don't wait for sync to complete
          stripeClient
            .updateCustomerEmail(user.stripeCustomerId, user.email)
            .then(() => {
              console.log(
                `✅ Synced user ${user.id} (${user.email}) email to Stripe customer ${user.stripeCustomerId}`,
              );
            })
            .catch((error) => {
              console.error(
                `Error syncing user email with Stripe for user ${user.id} (${user.email}):`,
                error,
              );
            });
        }
      }
    }),
  },
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
    requireEmailVerification: true,
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
    localization({
      defaultLocale: "default",
    }),
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
      organizationCreation: {
        afterCreate: async ({ organization }) => {
          await stripeClient.createOrganizationCustomer(
            organization.id,
            organization.name,
            organization.invoiceEmail ?? null,
            organization.slug,
          );
        },
      },
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
