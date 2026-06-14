import "server-only";

import { apiKey } from "@better-auth/api-key";
import { i18n } from "@better-auth/i18n";
import { oauthProvider } from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { stripe } from "@better-auth/stripe";
import * as Sentry from "@sentry/nextjs";
import { MemberRole, type User } from "@sokosumi/database";
import {
  ENTERPRISE_SUBSCRIPTION_EXCLUSIVITY_MESSAGE,
  hasConsumableEnterpriseContract,
} from "@sokosumi/database/helpers";
import {
  memberRepository,
  workspaceRepository,
} from "@sokosumi/database/repositories";
import {
  renderMagicLinkEmail,
  renderOrganizationInvitationEmail,
  renderResetPasswordEmail,
  renderVerificationEmail,
} from "@sokosumi/email";
import { authTranslations } from "@sokosumi/masumi/auth";
import {
  getEmailLocale,
  getOrganizationMetadata,
  getStoredUserName,
  resolveBetterAuthCookieName,
  resolveBetterAuthCookiePrefix,
} from "@sokosumi/utils";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth/minimal";
import { nextCookies } from "better-auth/next-js";
import {
  admin,
  jwt,
  lastLoginMethod,
  magicLink,
  oAuthProxy,
  organization,
} from "better-auth/plugins";
import pTimeout from "p-timeout";
import Stripe from "stripe";
import * as z from "zod";

import { getBetterAuthProductionUrl } from "@/config/better-auth-production-url";
import { getBetterAuthPublicBaseUrl } from "@/config/better-auth-public-url";
import { getEnvPublicConfig } from "@/config/env.public";
import { getEnvSecrets } from "@/config/env.secrets";
import { ORGANIZATION_HAS_ADDITIONAL_MEMBERS_ERROR_CODE } from "@/lib/actions/errors/better-auth";
import { OrganizationErrorCode } from "@/lib/actions/errors/error-codes";
import { uploadProfileImage } from "@/lib/blob/utils";
import { stripeClient } from "@/lib/clients/stripe.client";
import prisma from "@/lib/db/prisma";
import { postmarkClient } from "@/lib/email/postmark";
import { marketingOptInUserSchema } from "@/lib/schemas";
import {
  callAccountCreatedWebHook,
  callUserCreatedWebHook,
  callUserUpdatedWebHook,
  organizationSubscriptionService,
  preferredOrganizationService,
  stripeService,
} from "@/lib/services";
import { getBetterAuthSubscriptionPlans } from "@/lib/stripe/subscription-catalog";
import {
  handleSubscriptionDeletedEvent,
  reconcileActiveStripeBackedSubscription,
} from "@/lib/stripe/webhook-handlers";

export type Session = typeof auth.$Infer.Session;
export type SessionUser = typeof auth.$Infer.Session.user;
export type Invitation = typeof auth.$Infer.Invitation;
export type Account = Awaited<
  ReturnType<typeof auth.api.listUserAccounts>
>[number];

const secrets = getEnvSecrets();
const env = getEnvPublicConfig();

const stripeInstance = new Stripe(secrets.STRIPE_SECRET_KEY);

const fromEmail = secrets.POSTMARK_FROM_EMAIL;
const betterAuthProductionUrl = getBetterAuthProductionUrl();

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
  slug: string;
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
        organizationSlug: organization.slug,
      },
    });
  }
}

async function ensureStripeCustomerForCreatedUser(user: {
  email: string;
  id: string;
  name: string;
}): Promise<void> {
  await stripeClient.createUserCustomer(user.id, user.name, user.email);
}

async function ensureStripeCustomerForCreatedOrganization(organization: {
  id: string;
  metadata?: string | null;
  name: string;
  slug: string;
}): Promise<void> {
  const { invoiceEmail } = getOrganizationMetadata(organization.metadata);
  await stripeClient.createOrganizationCustomer(
    organization.id,
    organization.slug,
    organization.name,
    invoiceEmail,
  );
}

type StripeBackedLocalSubscription = NonNullable<
  Parameters<typeof reconcileActiveStripeBackedSubscription>[0]
>;

async function handleStripeBackedSubscriptionLifecycle({
  event,
  subscription,
}: {
  event: {
    id: string;
    type: string;
  };
  subscription: StripeBackedLocalSubscription;
}): Promise<void> {
  try {
    await reconcileActiveStripeBackedSubscription(subscription);
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        stripeEventType: event.type,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
      },
      extra: {
        eventId: event.id,
        localSubscriptionId: subscription.id,
        referenceId: subscription.referenceId,
      },
    });
    throw error;
  }
}

async function ensureOrganizationHasNoAdditionalMembers(
  organizationId: string,
  userId: string,
): Promise<void> {
  const members = await memberRepository.getMembersByOrganizationId(
    organizationId,
    prisma,
  );
  const hasAdditionalMembers = members.some(
    (member) => member.userId !== userId,
  );

  if (hasAdditionalMembers) {
    throw new APIError("BAD_REQUEST", {
      code: ORGANIZATION_HAS_ADDITIONAL_MEMBERS_ERROR_CODE,
      message: "Remove all other members before deleting this organization.",
    });
  }
}

const betterAuthBaseUrl = getBetterAuthPublicBaseUrl();
const betterAuthCookiePrefixParams = {
  network: secrets.NETWORK,
  vercelEnv: secrets.VERCEL_ENV,
  vercelGitCommitRef: secrets.VERCEL_GIT_COMMIT_REF,
};

export const auth = betterAuth({
  appName: "Sokosumi",
  baseURL: betterAuthBaseUrl,
  advanced: {
    database: {
      generateId: "uuid",
    },
    cookiePrefix: resolveBetterAuthCookiePrefix(betterAuthCookiePrefixParams),
    ...(secrets.BETTER_AUTH_COOKIE_DOMAIN
      ? {
          crossSubDomainCookies: {
            enabled: true,
            domain: secrets.BETTER_AUTH_COOKIE_DOMAIN,
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
    cookieCache: {
      enabled: true,
      maxAge: secrets.BETTER_AUTH_SESSION_COOKIE_CACHE_MAX_AGE,
    },
    storeSessionInDatabase: true,
  },
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  socialProviders: {
    google: {
      clientId: secrets.GOOGLE_CLIENT_ID,
      clientSecret: secrets.GOOGLE_CLIENT_SECRET,
      overrideUserInfoOnSignIn: true,
      mapProfileToUser,
    },
    microsoft: {
      clientId: secrets.MICROSOFT_CLIENT_ID,
      clientSecret: secrets.MICROSOFT_CLIENT_SECRET,
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
    session: {
      create: {
        before: async (session, _ctx) => {
          try {
            const activeOrganizationId =
              await preferredOrganizationService.resolveActiveOrganizationIdForSession(
                session.userId,
              );

            return {
              data: {
                ...session,
                activeOrganizationId,
              },
            };
          } catch (error) {
            Sentry.captureException(error, {
              tags: {
                context: "session_create_preferred_organization",
              },
              extra: {
                userId: session.userId,
              },
            });
            return { data: session };
          }
        },
      },
    },
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
          void ensureStripeCustomerForCreatedUser(user).catch((error) => {
            Sentry.captureException(error, {
              tags: {
                context: "stripe_user_customer_creation",
              },
              extra: {
                email: user.email,
                name: user.name,
                userId: user.id,
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
  trustedOrigins: [
    "https://app.sokosumi.com",
    "https://preprod.sokosumi.com",
    "https://*.preview.sokosumi.com", // Vercel preview deployment suffix
    ...(secrets.NODE_ENV === "development"
      ? ["http://localhost:*"] // local dev only; omit in staging/production deploys
      : []),
  ],
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
  emailAndPassword: {
    enabled: true,
    maxPasswordLength: env.NEXT_PUBLIC_PASSWORD_MAX_LENGTH,
    minPasswordLength: env.NEXT_PUBLIC_PASSWORD_MIN_LENGTH,
    requireEmailVerification: false,
    autoSignIn: true,
    sendResetPassword: async ({ user, url }, request) => {
      const email = await renderResetPasswordEmail({
        locale: getEmailLocale(request),
        name: user.name,
        resetLink: url,
      });

      postmarkClient.sendEmail({
        From: fromEmail,
        To: user.email,
        Tag: "reset-password",
        Subject: email.subject,
        HtmlBody: email.html,
        MessageStream: "authentications",
      });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }, request) => {
      const email = await renderVerificationEmail({
        locale: getEmailLocale(request),
        name: user.name,
        verificationLink: url,
      });

      postmarkClient.sendEmail({
        From: fromEmail,
        To: user.email,
        Tag: "verification-email",
        Subject: email.subject,
        HtmlBody: email.html,
        MessageStream: "authentications",
      });
    },
    sendOnSignUp: true,
    sendOnSignIn: true,
    expiresIn: secrets.BETTER_AUTH_EMAIL_VERIFICATION_EXPIRES_IN,
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
  rateLimit: {
    storage: "database",
  },
  plugins: [
    admin(),
    apiKey({
      configId: "default",
      references: "user",
      rateLimit: {
        enabled: true,
        timeWindow: 60, // 60 seconds
        maxRequests: 100, // 100 requests per minute
      },
      enableMetadata: true,
      enableSessionForAPIKeys: true,
    }),
    jwt({ disableSettingJwtHeader: true }),
    magicLink({
      disableSignUp: false,
      expiresIn: 60 * 10, // 10 minutes
      storeToken: "hashed",
      sendMagicLink: async ({ email, url }, ctx) => {
        const locale = getEmailLocale(ctx?.request, ctx?.headers);
        const name =
          typeof ctx?.body?.name === "string" ? ctx.body.name : undefined;
        const renderedEmail = await renderMagicLinkEmail({
          locale,
          magicLink: url,
          name,
        });

        void postmarkClient
          .sendEmail({
            From: fromEmail,
            To: email,
            Tag: "magic-link",
            Subject: renderedEmail.subject,
            HtmlBody: renderedEmail.html,
            MessageStream: "authentications",
          })
          .catch((error) => {
            Sentry.captureException(error, {
              tags: {
                context: "magic_link_email",
              },
              extra: {
                email,
              },
            });
          });
      },
    }),
    passkey({
      rpID: secrets.BETTER_AUTH_RP_ID,
      rpName: "Sokosumi",
    }),
    lastLoginMethod({
      cookieName: resolveBetterAuthCookieName(
        betterAuthCookiePrefixParams,
        "last_used_login_method",
      ),
    }),
    oauthProvider({
      loginPage: "/signin",
      consentPage: "/oauth/consent",
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
      productionURL: betterAuthProductionUrl,
    }),
    organization({
      organizationHooks: {
        afterCreateOrganization: async ({ organization }) => {
          await ensureWorkspaceForCreatedOrganization(organization);
          void ensureStripeCustomerForCreatedOrganization(organization).catch(
            (error) => {
              Sentry.captureException(error, {
                tags: {
                  context: "stripe_organization_customer_creation",
                },
                extra: {
                  organizationId: organization.id,
                  organizationName: organization.name,
                  organizationSlug: organization.slug,
                },
              });
            },
          );
        },
        beforeAcceptInvitation: async ({ organization }) => {
          await organizationSubscriptionService.ensureCanAcceptInvitation(
            organization.id,
          );
        },
        afterAcceptInvitation: async ({ organization }) => {
          await organizationSubscriptionService.syncLocalFreeSeatsAndCreditsForCurrentMembers(
            organization.id,
          );
        },
        afterAddMember: async ({ organization }) => {
          await organizationSubscriptionService.syncLocalFreeSeatsAndCreditsForCurrentMembers(
            organization.id,
          );
        },
        beforeDeleteOrganization: async ({ organization, user }) => {
          await ensureOrganizationHasNoAdditionalMembers(
            organization.id,
            user.id,
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
          },
        },
      },
      async sendInvitationEmail(data, request) {
        const inviteLink = `${betterAuthBaseUrl}/accept-invitation/${data.id}`;
        const email = await renderOrganizationInvitationEmail({
          invitationLink: inviteLink,
          invitorUsername: data.inviter.user.name,
          locale: getEmailLocale(request),
          organizationName: data.organization.name,
        });

        postmarkClient.sendEmail({
          From: fromEmail,
          To: data.email,
          Tag: "invitation-email",
          Subject: email.subject,
          HtmlBody: email.html,
          MessageStream: "organizations",
        });
      },
      invitationLimit: secrets.BETTER_AUTH_ORG_INVITATION_LIMIT,
      cancelPendingInvitationsOnReInvite: true,
      allowUserToCreateOrganization(user) {
        return user.emailVerified;
      },
      organizationLimit: secrets.BETTER_AUTH_ORG_LIMIT,
      invitationExpiresIn: secrets.BETTER_AUTH_ORG_INVITATION_EXPIRES_IN,
    }),
    i18n({
      translations: authTranslations,
      defaultLocale: "en",
      detection: ["header", "cookie"],
    }),
    nextCookies(),
    stripe({
      stripeClient: stripeInstance,
      stripeWebhookSecret: secrets.STRIPE_WEBHOOK_SECRET,
      createCustomerOnSignUp: false,
      subscription: {
        enabled: true,
        plans: async () => await getBetterAuthSubscriptionPlans(stripeInstance),
        onSubscriptionCreated: handleStripeBackedSubscriptionLifecycle,
        onSubscriptionUpdate: handleStripeBackedSubscriptionLifecycle,
        getCheckoutSessionParams: async () => ({
          params: {
            billing_address_collection: "required",
            customer_update: {
              address: "auto",
              name: "auto",
            },
            tax_id_collection: {
              enabled: true,
            },
          },
        }),
        authorizeReference: async ({ referenceId, user, action }) => {
          const member =
            await memberRepository.getMemberByUserIdAndOrganizationId(
              user.id,
              referenceId,
              prisma,
            );

          if (
            !member ||
            (member.role !== MemberRole.OWNER &&
              member.role !== MemberRole.ADMIN)
          ) {
            return false;
          }

          // Enterprise-contract exclusivity: an organization with an active,
          // consumable enterprise contract cannot also buy a self-serve
          // subscription. Scoped to the upgrade action only — the billing
          // portal, cancel, restore and list actions stay available.
          if (
            action === "upgrade-subscription" &&
            (await hasConsumableEnterpriseContract(referenceId, prisma))
          ) {
            throw new APIError("BAD_REQUEST", {
              code: OrganizationErrorCode.ORGANIZATION_ENTERPRISE_CONTRACT_EXCLUSIVE,
              message: ENTERPRISE_SUBSCRIPTION_EXCLUSIVITY_MESSAGE,
            });
          }

          return true;
        },
      },
      organization: {
        enabled: true,
      },
      onEvent: async (event) => {
        // invoice.paid, customer.updated, and customer.created moved to the
        // core webhook receiver (POST /webhooks/stripe) — the Stripe dashboard
        // endpoint for web no longer subscribes to them.
        switch (event.type) {
          case "customer.subscription.deleted": {
            const subscription = event.data.object as Stripe.Subscription;
            try {
              await handleSubscriptionDeletedEvent(subscription);
            } catch (error) {
              Sentry.captureException(error, {
                tags: {
                  stripeEventType: "customer.subscription.deleted",
                  stripeSubscriptionId: subscription.id,
                },
                extra: {
                  customer:
                    typeof subscription.customer === "string"
                      ? subscription.customer
                      : subscription.customer.id,
                  eventId: event.id,
                  subscription: subscription.id,
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
    return await pTimeout(mapProfileToUserInner(profile), {
      milliseconds: secrets.BETTER_AUTH_PROFILE_PICTURE_TIMEOUT,
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
