import * as Sentry from "@sentry/node";
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

import { postmarkClient } from "@/clients/postmark.client";
import { stripeClient } from "@/clients/stripe.client";
import { LIMITS, TIME } from "@/config/constants";
import { getEnv } from "@/config/env";
import { mapProfileToUser } from "@/helpers/profile-mapper";
import {
  renderEmailVerificationTemplate,
  renderOrganizationInvitationTemplate,
  renderPasswordResetTemplate,
} from "@/lib/email/index.js";
import { i18next } from "@/lib/i18next";
import { stripeService } from "@/services/stripe.service";
import { webhookService } from "@/services/webhook.service";

const env = getEnv();

export const auth = betterAuth({
  advanced: {
    crossSubDomainCookies: {
      enabled: true,
    },
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: TIME.SESSION_COOKIE_CACHE_MAX_AGE,
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
            throw new APIError("BAD_REQUEST", {
              message: "Terms of service must be accepted to create an account",
              code: "TERMS_NOT_ACCEPTED",
            });
          }
        },
        after: async (user, _ctx) => {
          await stripeService.createUserCustomerAndSave(
            user.id,
            user.name,
            user.email,
          );
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
              message: "Terms of service must be accepted to sign up",
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
            message: "Terms of service must be accepted to sign in",
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
              Sentry.captureException(error, {
                tags: {
                  user_id: user.id,
                  email: user.email,
                  stripe_customer_id: user.stripeCustomerId,
                },
              });
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
  trustedOrigins: [env.BETTER_AUTH_TRUSTED_ORIGIN],
  emailAndPassword: {
    enabled: true,
    maxPasswordLength: LIMITS.PASSWORD_MAX_LENGTH,
    minPasswordLength: LIMITS.PASSWORD_MIN_LENGTH,
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
    expiresIn: TIME.EMAIL_VERIFICATION_EXPIRES,
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
        timeWindow: TIME.RATE_LIMIT_WINDOW,
        maxRequests: LIMITS.API_KEY_MAX_REQUESTS_PER_MINUTE,
      },
      enableMetadata: true,
    }),
    organization({
      organizationCreation: {
        afterCreate: async ({ organization }) => {
          await stripeService.createOrganizationCustomerAndSave(
            organization.id,
            organization.name,
            organization.invoiceEmail ?? null,
            organization.slug,
          );
        },
      },
      invitationLimit: LIMITS.ORGANIZATION_INVITATION_LIMIT,
      organizationLimit: LIMITS.ORGANIZATION_LIMIT,
      invitationExpiresIn: TIME.INVITATION_EXPIRES,
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
