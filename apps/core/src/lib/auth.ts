import { apiKey } from "@better-auth/api-key";
import { i18n } from "@better-auth/i18n";
import { oauthProvider } from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { stripe } from "@better-auth/stripe";
import { z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import { MemberRole, type User } from "@sokosumi/database";
import {
  ENTERPRISE_SUBSCRIPTION_EXCLUSIVITY_MESSAGE,
  getCreditExpiryDate,
  grantSignupBonusCredits,
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
  betterAuthOrganizationAdditionalFields,
  betterAuthUserAdditionalFields,
  getEmailLocale,
  getStoredUserName,
  OAUTH_CLIENT_REGISTRATION_DEFAULT_SCOPES,
  OAUTH_PROVIDER_SCOPES,
  resolveBetterAuthCookieName,
  resolveBetterAuthCookiePrefix,
} from "@sokosumi/utils";
import { waitUntil } from "@vercel/functions";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth/minimal";
import {
  admin,
  jwt,
  lastLoginMethod,
  magicLink,
  oAuthProxy,
  openAPI,
  organization,
} from "better-auth/plugins";
import pTimeout from "p-timeout";
import Stripe from "stripe";
import { postmarkClient } from "@/clients/postmark.client";
import { stripeClient } from "@/clients/stripe.client";
import { getBetterAuthProductionUrl } from "@/config/better-auth-production-url";
import { LIMITS, TIME } from "@/config/constants";
import {
  getBetterAuthPublicBaseUrl,
  getEnv,
  getWebAppBaseUrl,
} from "@/config/env";
import {
  applyDesignMdMetadataGuardToOrganizationCreate,
  applyDesignMdMetadataGuardToOrganizationUpdate,
  applyDesignMdMetadataGuardToUserCreate,
  applyDesignMdMetadataGuardToUserUpdate,
} from "@/helpers/design-md-metadata-auth";
import { prepareTasksForUserDeletion } from "@/helpers/user-deletion-tasks";
import { uploadProfileImage } from "@/lib/blob";
import prisma from "@/lib/db/prisma";
import { captureExternalServiceError } from "@/lib/external-service-errors";
import { handleStripeAuthWebhookOnEvent } from "@/lib/stripe-auth-webhook-on-event";
import {
  ensureCanAcceptOrganizationInvitation,
  syncLocalFreeSeatsAndCreditsForCurrentMembers,
} from "@/services/organization-subscription-auth.service";
import { resolveActiveOrganizationIdForSession } from "@/services/preferred-organization.service";
import { reconcileActiveStripeBackedSubscription } from "@/services/stripe-backed-subscription.service";
import {
  handleUserUpdateStripeEmailSync,
  prepareStripeEmailSyncForUserUpdate,
} from "@/services/stripe-user-email.service";
import { getBetterAuthSubscriptionPlans } from "@/services/subscription-catalog.service";
import { markOutOfCreditsTasksAsToppedUp } from "@/services/task-topup.service";
import { webhookService } from "@/services/webhook.service";

const ORGANIZATION_ENTERPRISE_CONTRACT_EXCLUSIVE =
  "ORGANIZATION_ENTERPRISE_CONTRACT_EXCLUSIVE";
const ORGANIZATION_HAS_ADDITIONAL_MEMBERS =
  "ORGANIZATION_HAS_ADDITIONAL_MEMBERS";

const env = getEnv();
const stripeInstance = new Stripe(env.STRIPE_SECRET_KEY);
const webAppBaseUrl = getWebAppBaseUrl();
const betterAuthBaseUrl = getBetterAuthPublicBaseUrl();
const betterAuthCookiePrefixParams = {
  network: env.NETWORK,
  vercelEnv: env.VERCEL_ENV,
  vercelGitCommitRef: env.VERCEL_GIT_COMMIT_REF,
};
const betterAuthCookiePrefix = resolveBetterAuthCookiePrefix(
  betterAuthCookiePrefixParams,
);

async function grantSignupBonusForCreatedUser(userId: string): Promise<void> {
  const { SIGNUP_BONUS_CREDITS, SIGNUP_BONUS_TTL_DAYS } = getEnv();
  const grantedAt = new Date();
  const expiresAt = getCreditExpiryDate(grantedAt, SIGNUP_BONUS_TTL_DAYS);

  try {
    await prisma.$transaction(async (tx) => {
      const { created } = await grantSignupBonusCredits(
        {
          credits: SIGNUP_BONUS_CREDITS,
          expiresAt,
          userId,
        },
        tx,
      );

      if (created) {
        await markOutOfCreditsTasksAsToppedUp({
          organizationId: null,
          tx,
          userId,
        });
      }
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        context: "signup_bonus_grant",
      },
      extra: {
        userId,
      },
    });
  }
}

async function ensureWorkspaceForCreatedUser(user: {
  email: string;
  id: string;
  name: string;
}): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await workspaceRepository.upsertPersonalWorkspace({
        userId: user.id,
        tx,
      });
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
    await prisma.$transaction(async (tx) => {
      await workspaceRepository.upsertOrganizationWorkspace({
        organizationId: organization.id,
        tx,
      });
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

async function ensureStripeCustomerForCreatedOrganization(organization: {
  id: string;
  name: string;
  slug: string;
}): Promise<void> {
  await stripeClient.createOrganizationCustomer({
    organizationId: organization.id,
    slug: organization.slug,
    name: organization.name,
  });
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
      code: ORGANIZATION_HAS_ADDITIONAL_MEMBERS,
      message: "Remove all other members before deleting this organization.",
    });
  }
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
    cookieCache: {
      enabled: true,
      maxAge: env.BETTER_AUTH_SESSION_COOKIE_CACHE_MAX_AGE,
    },
    storeSessionInDatabase: true,
  },
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
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
          void webhookService
            .callAccountCreated(account.userId, account.providerId)
            .catch((error) => {
              Sentry.captureException(error, {
                tags: {
                  context: "account_created_webhook",
                },
                extra: {
                  userId: account.userId,
                  providerId: account.providerId,
                },
              });
            });
        },
      },
    },
    session: {
      create: {
        before: async (session, _ctx) => {
          try {
            const activeOrganizationId =
              await resolveActiveOrganizationIdForSession(session.userId);

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
          const withName = {
            ...user,
            name: getStoredUserName(user.name, user.email),
          };
          return {
            data: applyDesignMdMetadataGuardToUserCreate(withName),
          };
        },
        after: async (user, _ctx) => {
          await ensureWorkspaceForCreatedUser(user);
          waitUntil(grantSignupBonusForCreatedUser(user.id));
          waitUntil(
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
              }),
          );
          waitUntil(
            webhookService.callUserCreated(user).catch((error) => {
              Sentry.captureException(error, {
                tags: {
                  context: "user_created_webhook",
                },
                extra: {
                  userId: user.id,
                },
              });
            }),
          );
        },
      },
      update: {
        before: async (data, ctx) => {
          await prepareStripeEmailSyncForUserUpdate(data, ctx, prisma);
          const guarded = await applyDesignMdMetadataGuardToUserUpdate(
            data,
            ctx,
          );
          return { data: guarded };
        },
        after: async (user, _ctx) => {
          void webhookService.callUserUpdated(user).catch((error) => {
            Sentry.captureException(error, {
              tags: {
                context: "user_updated_webhook",
              },
              extra: {
                userId: user.id,
              },
            });
          });
          void handleUserUpdateStripeEmailSync(user);
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
  trustedOrigins: Array.from(
    new Set([
      "https://app.sokosumi.com",
      "https://preprod.sokosumi.com",
      webAppBaseUrl,
      "https://*.preview.sokosumi.com", // Vercel preview deployment suffix
      ...(env.NODE_ENV === "development"
        ? ["http://localhost:*"] // local dev only; omit in staging/production deploys
        : []),
    ]),
  ),
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
    }),
  },
  emailAndPassword: {
    enabled: true,
    maxPasswordLength: LIMITS.PASSWORD_MAX_LENGTH,
    minPasswordLength: LIMITS.PASSWORD_MIN_LENGTH,
    requireEmailVerification: false,
    autoSignIn: true,
    sendResetPassword: async ({ user, url }, request) => {
      const email = await renderResetPasswordEmail({
        locale: getEmailLocale(request),
        name: user.name,
        resetLink: url,
      });

      void postmarkClient
        .sendEmail({
          From: env.POSTMARK_FROM_EMAIL,
          To: user.email,
          Tag: "reset-password",
          Subject: email.subject,
          HtmlBody: email.html,
          MessageStream: "authentications",
        })
        .catch((error) => {
          captureExternalServiceError(error, {
            label: "reset_password_email",
            sentry: {
              tags: {
                context: "reset_password_email",
              },
              extra: {
                userId: user.id,
              },
            },
            extra: {
              userId: user.id,
            },
          });
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

      void postmarkClient
        .sendEmail({
          From: env.POSTMARK_FROM_EMAIL,
          To: user.email,
          Tag: "verification-email",
          Subject: email.subject,
          HtmlBody: email.html,
          MessageStream: "authentications",
        })
        .catch((error) => {
          captureExternalServiceError(error, {
            label: "verification_email",
            sentry: {
              tags: {
                context: "verification_email",
              },
              extra: {
                userId: user.id,
              },
            },
            extra: {
              userId: user.id,
            },
          });
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
      beforeDelete: async (user) => {
        await prepareTasksForUserDeletion(user.id, prisma);
      },
    },
    additionalFields: betterAuthUserAdditionalFields,
  },
  plugins: [
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
            From: env.POSTMARK_FROM_EMAIL,
            To: email,
            Tag: "magic-link",
            Subject: renderedEmail.subject,
            HtmlBody: renderedEmail.html,
            MessageStream: "authentications",
          })
          .catch((error) => {
            captureExternalServiceError(error, {
              label: "magic_link_email",
              sentry: {
                tags: {
                  context: "magic_link_email",
                },
                extra: {
                  email,
                },
              },
              extra: {
                email,
              },
            });
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
      enableSessionForAPIKeys: true,
    }),
    jwt({ disableSettingJwtHeader: true }),
    organization({
      organizationHooks: {
        beforeCreateOrganization: async ({ organization }) => {
          return {
            data: applyDesignMdMetadataGuardToOrganizationCreate(
              organization as Record<string, unknown>,
            ),
          };
        },
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
        beforeUpdateOrganization: async ({ organization, member }) => {
          return {
            data: await applyDesignMdMetadataGuardToOrganizationUpdate(
              organization as Record<string, unknown>,
              member.organizationId,
            ),
          };
        },
        beforeAcceptInvitation: async ({ organization }) => {
          await ensureCanAcceptOrganizationInvitation(organization.id);
        },
        afterAcceptInvitation: async ({ organization }) => {
          await syncLocalFreeSeatsAndCreditsForCurrentMembers(organization.id);
        },
        afterAddMember: async ({ organization }) => {
          await syncLocalFreeSeatsAndCreditsForCurrentMembers(organization.id);
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
          additionalFields: betterAuthOrganizationAdditionalFields,
        },
      },
      async sendInvitationEmail(data, request) {
        const inviteLink = `${webAppBaseUrl}/accept-invitation/${data.id}`;
        const email = await renderOrganizationInvitationEmail({
          invitationLink: inviteLink,
          invitorUsername: data.inviter.user.name,
          locale: getEmailLocale(request),
          organizationName: data.organization.name,
        });

        void postmarkClient
          .sendEmail({
            From: env.POSTMARK_FROM_EMAIL,
            To: data.email,
            Tag: "invitation-email",
            Subject: email.subject,
            HtmlBody: email.html,
            MessageStream: "organizations",
          })
          .catch((error) => {
            captureExternalServiceError(error, {
              label: "organization_invitation_email",
              sentry: {
                tags: {
                  context: "organization_invitation_email",
                },
                extra: {
                  invitationId: data.id,
                  organizationId: data.organization.id,
                },
              },
              extra: {
                invitationId: data.id,
                organizationId: data.organization.id,
              },
            });
          });
      },
      invitationLimit: LIMITS.ORGANIZATION_INVITATION_LIMIT,
      cancelPendingInvitationsOnReInvite: true,
      allowUserToCreateOrganization(user) {
        return user.emailVerified;
      },
      organizationLimit: LIMITS.ORGANIZATION_LIMIT,
      invitationExpiresIn: TIME.INVITATION_EXPIRES,
    }),
    passkey({
      rpID: env.BETTER_AUTH_RP_ID,
      rpName: "Sokosumi",
    }),
    lastLoginMethod({
      cookieName: resolveBetterAuthCookieName(
        betterAuthCookiePrefixParams,
        "last_used_login_method",
      ),
    }),
    oauthProvider({
      loginPage: `${webAppBaseUrl}/signin`,
      consentPage: `${webAppBaseUrl}/oauth/consent`,
      scopes: [...OAUTH_PROVIDER_SCOPES],
      // Defaults to identity-only; allow-list keeps sokosumi:api opt-in available
      // for authenticated create-client and for DCR if enabled later.
      clientRegistrationDefaultScopes: [
        ...OAUTH_CLIENT_REGISTRATION_DEFAULT_SCOPES,
      ],
      clientRegistrationAllowedScopes: [...OAUTH_PROVIDER_SCOPES],
      grantTypes: ["authorization_code", "refresh_token"],
      accessTokenExpiresIn: 7_200, // 2 hours (default: 3_600)
      refreshTokenExpiresIn: 7_776_000, // 90 days (default: 2_592_000)
      idTokenExpiresIn: 72_000, // 20 hours (default: 3_6000)
      codeExpiresIn: 600, // 10 minutes (default: 600)
      prefix: {
        opaqueAccessToken: "soko_access_token_",
        refreshToken: "soko_refresh_token_",
        clientSecret: "soko_client_secret_",
      },
      // RFC 8414 metadata is served from the well-known + auth routers, so the
      // startup reminder to expose `/.well-known/oauth-authorization-server/auth`
      // is satisfied; silence it to keep boot logs clean.
      silenceWarnings: {
        oauthAuthServerConfig: true,
      },
    }),
    oAuthProxy({
      productionURL: getBetterAuthProductionUrl(),
    }),
    // Better Auth Stripe plugin webhook (POST /auth/stripe/webhook). Point the
    // Stripe Dashboard here only; billing events are handled from onEvent.
    stripe({
      stripeClient: stripeInstance,
      stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
      createCustomerOnSignUp: false,
      subscription: {
        enabled: true,
        plans: async () => await getBetterAuthSubscriptionPlans(),
        onSubscriptionCreated: handleStripeBackedSubscriptionLifecycle,
        onSubscriptionUpdate: handleStripeBackedSubscriptionLifecycle,
        getCheckoutSessionParams: async () => ({
          params: {
            automatic_tax: {
              enabled: true,
            },
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

          if (
            action === "upgrade-subscription" &&
            (await hasConsumableEnterpriseContract(referenceId, prisma))
          ) {
            throw new APIError("BAD_REQUEST", {
              code: ORGANIZATION_ENTERPRISE_CONTRACT_EXCLUSIVE,
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
        await handleStripeAuthWebhookOnEvent(event);
      },
    }),
  ],
});

async function mapProfileToUser(profile: { name: string; picture: string }) {
  try {
    return await pTimeout(mapProfileToUserInner(profile), {
      milliseconds: env.BETTER_AUTH_PROFILE_PICTURE_TIMEOUT,
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
  }

  const imageURL = await uploadProfileImage(profilePicture);
  return {
    name: profile.name,
    image: imageURL,
  };
}
