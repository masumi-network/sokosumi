import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { apiKey, organization } from "better-auth/plugins";
import { localization } from "better-auth-localization";
import { getTranslations } from "next-intl/server";

import { getEnvPublicConfig } from "@/config/env.public";
import { getEnvSecrets } from "@/config/env.secrets";
import { prisma } from "@/lib/db/repositories";
import { reactChangeEmailVerificationEmail } from "@/lib/email/change-email";
import { reactInviteUserEmail } from "@/lib/email/invitation";
import { postmarkClient } from "@/lib/email/postmark";
import { reactResetPasswordEmail } from "@/lib/email/reset-password";
import { reactVerificationEmail } from "@/lib/email/verification";
import { marketingOptInUserSchema } from "@/lib/schemas";
import {
  callMarketingOptInWebHookEmail,
  callMarketingOptInWebHookSocialProvider,
  stripeService,
} from "@/lib/services";

export type Session = typeof auth.$Infer.Session;
export type SessionUser = typeof auth.$Infer.Session.user;
export type Invitation = typeof auth.$Infer.Invitation;
export type Account = Awaited<
  ReturnType<typeof auth.api.listUserAccounts>
>[number];

const fromEmail = getEnvSecrets().POSTMARK_FROM_EMAIL;

export const auth = betterAuth({
  session: {
    cookieCache: {
      enabled: true,
      maxAge: getEnvSecrets().BETTER_AUTH_SESSION_COOKIE_CACHE_MAX_AGE,
    },
  },
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  socialProviders: {
    google: {
      clientId: getEnvSecrets().GOOGLE_CLIENT_ID,
      clientSecret: getEnvSecrets().GOOGLE_CLIENT_SECRET,
      overrideUserInfoOnSignIn: true,
      mapProfileToUser,
    },
    microsoft: {
      clientId: getEnvSecrets().MICROSOFT_CLIENT_ID,
      clientSecret: getEnvSecrets().MICROSOFT_CLIENT_SECRET,
      overrideUserInfoOnSignIn: true,
      mapProfileToUser,
    },
  },
  databaseHooks: {
    account: {
      create: {
        after: async (account) => {
          callMarketingOptInWebHookSocialProvider(
            account.userId,
            account.providerId,
          );
        },
      },
    },
    user: {
      create: {
        after: async (user) => {
          await stripeService.createStripeCustomerForUser(user.id);

          // Validate user data before calling webhook
          const { success, data, error } =
            marketingOptInUserSchema.safeParse(user);
          if (success) {
            callMarketingOptInWebHookEmail(
              data.id,
              data.email,
              data.name,
              data.marketingOptIn,
            );
          } else {
            console.error("Invalid user data for marketing webhook:", error);
          }
        },
      },
      update: {
        after: async (user) => {
          // Validate user data before calling webhook
          // Fires on any user update to keep marketing system synchronized
          const { success, data, error } =
            marketingOptInUserSchema.safeParse(user);
          if (success) {
            callMarketingOptInWebHookEmail(
              data.id,
              data.email,
              data.name,
              data.marketingOptIn,
            );
          } else {
            console.error("Invalid user data for marketing webhook:", error);
          }
        },
      },
    },
  },
  trustedOrigins: () => {
    const origins = [getEnvSecrets().BETTER_AUTH_TRUSTED_ORIGIN];
    const vercelBranchUrl = getEnvSecrets().VERCEL_BRANCH_URL;
    if (vercelBranchUrl) {
      origins.push(vercelBranchUrl);
    }
    const vercelUrl = getEnvSecrets().VERCEL_URL;
    if (vercelUrl) {
      origins.push(vercelUrl);
    }
    return origins;
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      switch (ctx.path) {
        case "/sign-up/email": {
          const allowedEmailDomains = getEnvSecrets().ALLOWED_EMAIL_DOMAINS;
          if (
            allowedEmailDomains.length !== 0 &&
            !allowedEmailDomains.includes(ctx.body?.email.split("@")[1])
          ) {
            throw new APIError("BAD_REQUEST", {
              code: "EMAIL_DOMAIN_NOT_ALLOWED",
              message: allowedEmailDomains.join(", "),
            });
          }

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
          stripeService
            .syncUserEmailWithStripe(user.id, user.email)
            .catch((error) => {
              console.error("Failed to sync user email with Stripe:", error);
            });
        }
      }
    }),
  },
  disabledPaths: ["/sign-up/email", "/sign-in"],
  emailAndPassword: {
    enabled: true,
    maxPasswordLength: getEnvPublicConfig().NEXT_PUBLIC_PASSWORD_MAX_LENGTH,
    minPasswordLength: getEnvPublicConfig().NEXT_PUBLIC_PASSWORD_MIN_LENGTH,
    requireEmailVerification: true,
    autoSignIn: false,
    sendResetPassword: async ({ user, url }) => {
      const t = await getTranslations("Library.Auth.Email.ResetPassword");

      postmarkClient.sendEmail({
        From: fromEmail,
        To: user.email,
        Tag: "reset-password",
        Subject: t("subject"),
        HtmlBody: await reactResetPasswordEmail({
          name: user.name,
          resetLink: url,
        }),
        MessageStream: "authentications",
      });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      const t = await getTranslations("Library.Auth.Email.Verification");

      postmarkClient.sendEmail({
        From: fromEmail,
        To: user.email,
        Tag: "verification-email",
        Subject: t("subject"),
        HtmlBody: await reactVerificationEmail({
          name: user.name,
          verificationLink: url,
        }),
        MessageStream: "authentications",
      });
    },
    sendOnSignUp: true,
    sendOnSignIn: true,
    expiresIn: getEnvSecrets().BETTER_AUTH_EMAIL_VERIFICATION_EXPIRES_IN,
    autoSignInAfterVerification: true,
  },
  user: {
    changeEmail: {
      enabled: true,
      sendChangeEmailVerification: async ({ user, url }) => {
        const t = await getTranslations("Library.Auth.Email.ChangeEmail");

        postmarkClient.sendEmail({
          From: fromEmail,
          To: user.email,
          Tag: "change-email",
          Subject: t("subject"),
          HtmlBody: await reactChangeEmailVerificationEmail({
            name: user.name,
            changeEmailLink: url,
          }),
          MessageStream: "authentications",
        });
      },
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
      jobStatusEmailNotificationsEnabled: {
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
  rateLimit: {
    storage: "database",
  },
  plugins: [
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
          await stripeService.createStripeCustomerForOrganization(
            organization.id,
          );
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
            invoiceEmail: {
              type: "string",
              required: false,
              defaultValue: null,
              input: false,
            },
          },
        },
      },
      async sendInvitationEmail(data) {
        const inviteLink = `${getEnvSecrets().BETTER_AUTH_URL}/accept-invitation/${data.id}`;
        const t = await getTranslations("Library.Auth.Email.InviteUserEmail");

        postmarkClient.sendEmail({
          From: fromEmail,
          To: data.email,
          Tag: "invitation-email",
          Subject: t("subject"),
          HtmlBody: await reactInviteUserEmail({
            organizationName: data.organization.name,
            invitorUsername: data.inviter.user.name,
            inviteLink,
          }),
          MessageStream: "organizations",
        });
      },
      invitationLimit: getEnvSecrets().BETTER_AUTH_ORG_INVITATION_LIMIT,
      cancelPendingInvitationsOnReInvite: true,
      allowUserToCreateOrganization(user) {
        return user.emailVerified;
      },
      organizationLimit: getEnvSecrets().BETTER_AUTH_ORG_LIMIT,
      invitationExpiresIn:
        getEnvSecrets().BETTER_AUTH_ORG_INVITATION_EXPIRES_IN,
    }),
    localization({
      defaultLocale: "default",
      // TODO:
      // implement dynamic localization
      // by using `getLocale` function
    }),
    nextCookies(),
  ],
});

// check image is longer than 256 characters
function mapProfileToUser(profile: { name: string; picture: string }) {
  if (profile.picture && profile.picture.length > 256) {
    return {
      name: profile.name,
      image: undefined,
    };
  }
  return {
    name: profile.name,
    image: profile.picture,
  };
}
