import "server-only";

import { oauthProvider } from "@better-auth/oauth-provider";
import { stripe } from "@better-auth/stripe";
import * as Sentry from "@sentry/nextjs";
import { MemberRole, User } from "@sokosumi/database";
import { memberRepository } from "@sokosumi/database/repositories";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { apiKey, jwt, organization } from "better-auth/plugins";
import { localization } from "better-auth-localization";
import { getTranslations } from "next-intl/server";
import pTimeout from "p-timeout";
import Stripe from "stripe";
import * as z from "zod";

import { getEnvPublicConfig } from "@/config/env.public";
import { getEnvSecrets } from "@/config/env.secrets";
import { uploadProfileImage } from "@/lib/blob/utils";
import { stripeClient } from "@/lib/clients/stripe.client";
import prisma from "@/lib/db/prisma";
import { reactInviteUserEmail } from "@/lib/email/invitation";
import { postmarkClient } from "@/lib/email/postmark";
import { reactResetPasswordEmail } from "@/lib/email/reset-password";
import { reactVerificationEmail } from "@/lib/email/verification";
import { marketingOptInUserSchema } from "@/lib/schemas";
import {
  callAccountCreatedWebHook,
  callUserCreatedWebHook,
  callUserUpdatedWebHook,
  organizationSubscriptionService,
  stripeService,
} from "@/lib/services";
import { getBetterAuthSubscriptionPlans } from "@/lib/stripe/subscription-catalog";
import {
  handleCustomerCreatedEvent,
  handleCustomerUpdatedEvent,
  handleInvoicePaidEvent,
} from "@/lib/stripe/webhook-handlers";

export type Session = typeof auth.$Infer.Session;
export type SessionUser = typeof auth.$Infer.Session.user;
export type Invitation = typeof auth.$Infer.Invitation;
export type Account = Awaited<
  ReturnType<typeof auth.api.listUserAccounts>
>[number];

const stripeInstance = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY);

const fromEmail = getEnvSecrets().POSTMARK_FROM_EMAIL;

export const auth = betterAuth({
  session: {
    cookieCache: {
      enabled: true,
      maxAge: getEnvSecrets().BETTER_AUTH_SESSION_COOKIE_CACHE_MAX_AGE,
    },
    storeSessionInDatabase: true,
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
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google", "microsoft"],
    },
  },
  databaseHooks: {
    account: {
      create: {
        after: async (account, _ctx) => {
          callAccountCreatedWebHook(account.userId, account.providerId);
        },
      },
    },
    user: {
      create: {
        after: async (user, _ctx) => {
          stripeClient
            .createUserCustomer(user.id, user.name, user.email)
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
          // Validate user data before calling webhook
          const { success, data, error } =
            marketingOptInUserSchema.safeParse(user);
          if (success) {
            callUserCreatedWebHook(
              data.id,
              data.email,
              data.name,
              data.marketingOptIn,
            );
          } else {
            console.error("Invalid user data for user created webhook:", error);
          }
        },
      },
      update: {
        after: async (user, _ctx) => {
          // Validate user data before calling webhook
          // Fires on any user update to keep marketing system synchronized
          const { success, data, error } =
            marketingOptInUserSchema.safeParse(user);
          if (success) {
            callUserUpdatedWebHook(
              data.id,
              data.email,
              data.name,
              data.marketingOptIn,
            );
          } else {
            console.error("Invalid user data for user updated webhook:", error);
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
        if (user.stripeCustomerId) {
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
  disabledPaths: ["/sign-up/email", "/sign-in", "/token"],
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
    jwt({ disableSettingJwtHeader: true }),
    oauthProvider({
      loginPage: "/signin",
      consentPage: "/oauth/consent",
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
    organization({
      organizationCreation: {
        afterCreate: async ({ organization }) => {
          stripeClient
            .createOrganizationCustomer(
              organization.id,
              organization.slug,
              organization.name,
              organization.invoiceEmail,
            )
            .catch((error) => {
              Sentry.captureException(error, {
                tags: {
                  context: "stripe_organization_customer_creation",
                },
                extra: {
                  organizationId: organization.id,
                  name: organization.name,
                  slug: organization.slug,
                  invoiceEmail: organization.invoiceEmail,
                },
              });
            });
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
      organizationHooks: {
        beforeAcceptInvitation: async ({ organization }) => {
          await organizationSubscriptionService.ensureCanAcceptInvitation(
            organization.id,
          );
        },
        beforeCreateInvitation: async ({ organization }) => {
          await organizationSubscriptionService.ensureCanCreateInvitation(
            organization.id,
          );
        },
      },
    }),
    localization({
      defaultLocale: "default",
    }),
    nextCookies(),
    stripe({
      stripeClient: stripeInstance,
      stripeWebhookSecret: getEnvSecrets().STRIPE_WEBHOOK_SECRET,
      createCustomerOnSignUp: false,
      subscription: {
        enabled: true,
        plans: async () => await getBetterAuthSubscriptionPlans(stripeInstance),
        authorizeReference: async ({ referenceId, user }) => {
          const member = await memberRepository.getMemberByUserIdAndOrganizationId(
            user.id,
            referenceId,
            prisma,
          );

          if (!member) {
            return false;
          }

          return (
            member.role === MemberRole.OWNER ||
            member.role === MemberRole.ADMIN
          );
        },
      },
      organization: {
        enabled: true,
      },
      onEvent: async (event) => {
        switch (event.type) {
          case "invoice.paid": {
            const invoice = event.data.object as Stripe.Invoice;
            try {
              await handleInvoicePaidEvent(invoice);
            } catch (error) {
              Sentry.captureException(error, {
                tags: {
                  stripeEventType: "invoice.paid",
                  invoiceId: invoice.id,
                },
                extra: {
                  eventId: event.id,
                  invoice: invoice.id,
                  customer:
                    typeof invoice.customer === "string"
                      ? invoice.customer
                      : invoice.customer?.id,
                },
              });
              throw error;
            }
            break;
          }
          case "customer.updated": {
            const customer = event.data.object as Stripe.Customer;
            try {
              await handleCustomerUpdatedEvent(customer);
            } catch (error) {
              Sentry.captureException(error, {
                tags: {
                  stripeEventType: "customer.updated",
                  customerId: customer.id,
                },
                extra: {
                  eventId: event.id,
                  customer: customer.id,
                  email: customer.email,
                },
              });
              throw error;
            }
            break;
          }
          case "customer.created": {
            const customer = event.data.object as Stripe.Customer;
            try {
              await handleCustomerCreatedEvent(customer);
            } catch (error) {
              Sentry.captureException(error, {
                tags: {
                  stripeEventType: "customer.created",
                  customerId: customer.id,
                },
                extra: {
                  eventId: event.id,
                  customer: customer.id,
                  email: customer.email,
                },
              });
              throw error;
            }
            break;
          }
          default: {
            console.info(`Unhandled Stripe event type: ${event.type}`);
            break;
          }
        }
      },
    }),
  ],
});

async function mapProfileToUser(profile: { name: string; picture: string }) {
  try {
    return pTimeout(mapProfileToUserInner(profile), {
      milliseconds: getEnvSecrets().BETTER_AUTH_PROFILE_PICTURE_TIMEOUT,
    });
  } catch (error) {
    Sentry.captureException(error);
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

async function mapProfileToUserInner(profile: {
  name: string;
  picture: string;
}): Promise<Partial<User>> {
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
  } else {
    const imageURL = await uploadProfileImage(profilePicture);
    return {
      name: profile.name,
      image: imageURL,
    };
  }
}
