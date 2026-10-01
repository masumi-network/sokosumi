import { apiKey } from "@better-auth/api-key";
import { i18n } from "@better-auth/i18n";
import {
  getOAuthProviderState,
  oauthProvider,
} from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { stripe } from "@better-auth/stripe";
import * as Sentry from "@sentry/node";
import { MemberRole } from "@sokosumi/database";
import {
  ENTERPRISE_SUBSCRIPTION_EXCLUSIVITY_MESSAGE,
  getCreditExpiryDate,
  grantSignupBonusCredits,
  hasConsumableEnterpriseContract,
} from "@sokosumi/database/helpers";
import { memberRepository } from "@sokosumi/database/repositories";
import {
  renderEmailCodeEmail,
  renderResetPasswordEmail,
  renderVerificationEmail,
} from "@sokosumi/email";
import { authTranslations } from "@sokosumi/masumi/auth";
import {
  betterAuthUserAdditionalFields,
  getEmailLocale,
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
  emailOTP,
  jwt,
  lastLoginMethod,
  oAuthProxy,
  openAPI,
} from "better-auth/plugins";
import Stripe from "stripe";
import { sendEmail } from "@/clients/email.client";
import { stripeClient } from "@/clients/stripe.client";
import { getBetterAuthProductionUrl } from "@/config/better-auth-production-url";
import { LIMITS, TIME } from "@/config/constants";
import {
  getBetterAuthPublicBaseUrl,
  getEnv,
  getWebAppBaseUrl,
} from "@/config/env";
import { deliverOrganizationCalendarInvalidationsNow } from "@/helpers/calendar-invalidation";
import {
  evaluateUserDeletion,
  throwIfUserDeletionBlocked,
} from "@/helpers/deletion-evaluate";
import {
  applyDesignMdMetadataGuardToUserCreate,
  applyDesignMdMetadataGuardToUserUpdate,
} from "@/helpers/design-md-metadata-auth";
import { deleteStripeCustomerBestEffort } from "@/helpers/stripe-customer-delete";
import { prepareTasksForUserDeletion } from "@/helpers/user-deletion-tasks";
import prisma from "@/lib/db/prisma";
import { captureExternalServiceError } from "@/lib/external-service-errors";
import { handleStripeAuthWebhookOnEvent } from "@/lib/stripe-auth-webhook-on-event";
import { resolveActiveOrganizationIdForSession } from "@/services/preferred-organization.service";
import { reconcileActiveStripeBackedSubscription } from "@/services/stripe-backed-subscription.service";
import {
  handleUserUpdateStripeEmailSync,
  prepareStripeEmailSyncForUserUpdate,
} from "@/services/stripe-user-email.service";
import { getBetterAuthSubscriptionPlans } from "@/services/subscription-catalog.service";
import { markOutOfCreditsTasksAsToppedUp } from "@/services/task-topup.service";
import { webhookService } from "@/services/webhook.service";
import { createAuthCaptchaPlugin } from "./auth-captcha.js";
import {
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAUTH_REFRESH_TOKEN_PREFIX,
  oauthRefreshTokenOptions,
} from "./auth-oauth-provider";
import { refuseOAuthProxyCompletionOutsidePreview } from "./auth-oauth-proxy";
import { createAuthOrganizationPlugin } from "./auth-organization";
import {
  oauthSignUpOptions,
  recordSignUpConversion,
} from "./auth-sign-up-conversion";
import { signUpEmailStatus } from "./auth-sign-up-email-status";
import { accountOptions, socialProviderOptions } from "./auth-social-providers";
import {
  resolveEmailCodeSignInNameBody,
  resolveSignUpNameBody,
  validateUpdatedUserName,
  validateUserNameLength,
} from "./auth-user-name";
import { anchorVerificationCallbackToWebApp } from "./verification-email-callback";

const ORGANIZATION_ENTERPRISE_CONTRACT_EXCLUSIVE =
  "ORGANIZATION_ENTERPRISE_CONTRACT_EXCLUSIVE";
const EMAIL_CODE_EXPIRES_IN_SECONDS = 10 * 60;

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

interface SignUpOAuthClient {
  clientId: string;
  name: string;
}

/**
 * The app a sign-up came from, when the request carries an OAuth request this
 * provider signed (Web's auth client adds `oauth_query`, and the provider's
 * hook verifies it before the endpoint runs). A disabled or unnamed client
 * gets Sokosumi's own email, and so does a failed lookup: naming the app is
 * not worth losing the email.
 */
async function getSignUpOAuthClient(): Promise<SignUpOAuthClient | undefined> {
  try {
    const query = (await getOAuthProviderState())?.query;
    const clientId = query
      ? new URLSearchParams(query).get("client_id")
      : undefined;
    if (!clientId) {
      return undefined;
    }
    const client = await prisma.oauthClient.findFirst({
      where: { clientId, disabled: false },
      select: { name: true },
    });
    return client?.name?.trim() ? { clientId, name: client.name } : undefined;
  } catch (error) {
    captureExternalServiceError(error, {
      label: "verification_email_client",
      sentry: { tags: { context: "verification_email_client" } },
    });
    return undefined;
  }
}

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

type StripeBackedLocalSubscription = NonNullable<
  Parameters<typeof reconcileActiveStripeBackedSubscription>[0]
>;

// Best-effort on purpose. The plugin logs and drops an error from this hook,
// so it never reaches Stripe, and moving it to onEvent would not help: a
// Stripe retry replays the plugin's update handler, which rewrites status,
// seats and periods from the event payload with no staleness check, so a
// retried older event can overwrite a newer state. A lost reconciliation is
// repaired by the next update event for the subscription, which can be the
// renewal a full billing period later; Sentry is the signal until then.
async function reconcileAfterSubscriptionUpdate({
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
  }
}

export const auth = betterAuth({
  appName: "Sokosumi",
  advanced: {
    database: {
      generateId: "uuid",
      joins: true,
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
  session: {
    cookieCache: {
      enabled: true,
      maxAge: env.BETTER_AUTH_SESSION_COOKIE_CACHE_MAX_AGE,
    },
    storeSessionInDatabase: true,
    // Better Auth defaults this to 24 hours, which lets a day-old session
    // register a passkey and so mint a new permanent login factor.
    freshAge: TIME.SESSION_FRESH_AGE,
  },
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  socialProviders: socialProviderOptions,
  account: accountOptions,
  databaseHooks: {
    account: {
      create: {
        after: async (account, _ctx) => {
          if (
            account.providerId === "google" ||
            account.providerId === "microsoft"
          ) {
            await prisma.user.updateMany({
              where: { id: account.userId, emailVerified: false },
              data: { emailVerified: true },
            });
          }

          waitUntil(
            webhookService
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
              }),
          );
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
          validateUserNameLength(user.firstName, user.lastName);
          const withName = {
            ...user,
            name: user.name?.trim() ?? "",
          };
          return {
            data: applyDesignMdMetadataGuardToUserCreate(withName),
          };
        },
        after: async (user, ctx) => {
          // Awaited: the OAuth provider's after hook in this same request
          // takes the sign-up's redirect through Web.
          await recordSignUpConversion(user.id, ctx).catch((error) => {
            Sentry.captureException(error, {
              tags: { context: "sign_up_conversion" },
              extra: { userId: user.id },
            });
          });
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
          waitUntil(
            webhookService.callUserUpdated(user).catch((error) => {
              Sentry.captureException(error, {
                tags: {
                  context: "user_updated_webhook",
                },
                extra: {
                  userId: user.id,
                },
              });
            }),
          );
          void handleUserUpdateStripeEmailSync(user);
        },
      },
    },
  },
  secret: env.BETTER_AUTH_SECRET,
  baseURL: betterAuthBaseUrl,
  basePath: "/auth",
  // The email code plugin also offers password reset, email verification and
  // email change by code. Sokosumi keeps links for those.
  disabledPaths: [
    "/email-otp/check-verification-otp",
    "/email-otp/verify-email",
    "/email-otp/request-password-reset",
    "/forget-password/email-otp",
    "/email-otp/reset-password",
    "/email-otp/request-email-change",
    "/email-otp/change-email",
  ],
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
        ? [
            "http://localhost:*",
            "https://localhost:*",
            "http://*.localhost:*",
            "https://*.localhost",
            "https://*.localhost:*",
          ]
        : []),
    ]),
  ),
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      refuseOAuthProxyCompletionOutsidePreview(ctx.path, env.VERCEL_ENV);

      switch (ctx.path) {
        case "/sign-up/email": {
          if (!ctx.body?.termsAccepted) {
            throw new APIError("BAD_REQUEST", {
              code: "TERMS_NOT_ACCEPTED",
            });
          }

          return { context: { body: resolveSignUpNameBody(ctx.body) } };
        }
        case "/email-otp/send-verification-otp": {
          // Codes only sign people in. Password resets and email
          // verification keep their links.
          if (ctx.body?.type !== "sign-in") {
            throw new APIError("BAD_REQUEST", {
              message: "Email codes only sign in",
            });
          }
          break;
        }
        case "/sign-in/email-otp": {
          return {
            context: { body: resolveEmailCodeSignInNameBody(ctx.body) },
          };
        }
        case "/update-user": {
          await validateUpdatedUserName(ctx);
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

      if (ctx.path === "/organization/leave") {
        const organizationId = ctx.body?.organizationId;
        if (typeof organizationId === "string") {
          await deliverOrganizationCalendarInvalidationsNow(
            organizationId,
            ctx.context.session?.user.id,
          );
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
    // A password reset is what someone does when they suspect their account is
    // compromised, so every existing session has to go with the old password.
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }, request) => {
      const email = await renderResetPasswordEmail({
        locale: getEmailLocale(request),
        name: user.name,
        resetLink: url,
      });

      waitUntil(
        sendEmail({
          to: user.email,
          tag: "reset-password",
          subject: email.subject,
          html: email.html,
        }).catch((error) => {
          captureExternalServiceError(error, {
            label: "reset_password_email",
            sentry: {
              tags: {
                context: "reset_password_email",
              },
            },
            extra: {
              userId: user.id,
            },
          });
        }),
      );
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }, request) => {
      const client = await getSignUpOAuthClient();
      const email = await renderVerificationEmail({
        locale: getEmailLocale(request),
        name: user.name,
        clientName: client?.name,
        verificationLink: anchorVerificationCallbackToWebApp(
          url,
          webAppBaseUrl,
          client?.clientId,
        ),
      });

      waitUntil(
        sendEmail({
          to: user.email,
          tag: "verification-email",
          subject: email.subject,
          html: email.html,
        }).catch((error) => {
          captureExternalServiceError(error, {
            label: "verification_email",
            sentry: {
              tags: {
                context: "verification_email",
              },
            },
            extra: {
              userId: user.id,
            },
          });
        }),
      );
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
        const evaluation = await evaluateUserDeletion(user.id, prisma);
        throwIfUserDeletionBlocked(user.id, evaluation);
        // Snapshot before the helper: it deletes the User row in the same
        // transaction as the payment/task sweep. afterDelete still best-effort
        // deletes the Stripe customer.
        const userCustomer = await prisma.user.findUnique({
          where: { id: user.id },
          select: { stripeCustomerId: true },
        });
        (user as { stripeCustomerId?: string | null }).stripeCustomerId =
          userCustomer?.stripeCustomerId ?? null;
        // This helper performs the User delete inside the same transaction as
        // its payment/task sweep. Better Auth's following adapter delete is a
        // deliberate not-found no-op; separating them reopens a charge race.
        await prepareTasksForUserDeletion(user.id, prisma);
      },
      afterDelete: async (user) => {
        waitUntil(
          deleteStripeCustomerBestEffort({
            stripeCustomerId: (user as { stripeCustomerId?: string | null })
              .stripeCustomerId,
            ownerType: "user",
            ownerId: user.id,
          }),
        );
      },
    },
    additionalFields: betterAuthUserAdditionalFields,
  },
  plugins: [
    createAuthCaptchaPlugin(env.TURNSTILE_SECRET_KEY),
    signUpEmailStatus(),
    // A code, not a link: it goes back into the tab that asked for it, so a
    // sign-in for another app keeps that app's state, and a mail scanner
    // that opens links cannot use it up.
    emailOTP({
      otpLength: 6,
      expiresIn: EMAIL_CODE_EXPIRES_IN_SECONDS,
      allowedAttempts: 5,
      // A resend repeats the code rather than replacing it, so whichever email
      // arrives first works. Reuse needs the code recoverable, so it is stored
      // encrypted with the auth secret instead of hashed.
      storeOTP: "encrypted",
      resendStrategy: "reuse",
      disableSignUp: false,
      sendVerificationOTP: async ({ email, otp }, ctx) => {
        const renderedEmail = await renderEmailCodeEmail({
          locale: getEmailLocale(ctx?.request, ctx?.headers),
          code: otp,
          expiresInMinutes: EMAIL_CODE_EXPIRES_IN_SECONDS / 60,
        });

        waitUntil(
          sendEmail({
            to: email,
            tag: "email-code",
            subject: renderedEmail.subject,
            html: renderedEmail.html,
          }).catch((error) => {
            captureExternalServiceError(error, {
              label: "email_code_email",
              sentry: {
                tags: {
                  context: "email_code_email",
                },
              },
              extra: {
                email,
              },
            });
          }),
        );
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
        // The plugin measures timeWindow in milliseconds; TIME is a seconds
        // table. The value is snapshotted onto each ApiKey row at creation.
        timeWindow: TIME.RATE_LIMIT_WINDOW * 1_000,
        maxRequests: LIMITS.API_KEY_MAX_REQUESTS_PER_MINUTE,
      },
      enableMetadata: true,
      // A key must authenticate a request, never become a session. The plugin
      // mints a synthetic session that looks freshly created, which is enough
      // for the passkey plugin to register a new passkey. A leaked key would
      // then buy permanent interactive access that revoking the key cannot
      // take back. Core reads keys through `verifyApiKey` in the bearer
      // middleware, so no first-party caller needs the session.
      enableSessionForAPIKeys: false,
    }),
    jwt({ disableSettingJwtHeader: true }),
    createAuthOrganizationPlugin(),
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
      // Where `prompt=create` lands, signed in or not, and where a social
      // sign-up no Web page has counted yet goes before the client. The page
      // reports back through `/oauth2/continue`.
      signup: oauthSignUpOptions(webAppBaseUrl),
      // The sign-in and sign-up pages name the requesting client before
      // anyone is signed in. Answered only for a request this provider signed.
      allowPublicClientPrelogin: true,
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
      ...oauthRefreshTokenOptions,
      idTokenExpiresIn: 72_000, // 20 hours (default: 3_6000)
      codeExpiresIn: 600, // 10 minutes (default: 600)
      prefix: {
        opaqueAccessToken: OAUTH_ACCESS_TOKEN_PREFIX,
        refreshToken: OAUTH_REFRESH_TOKEN_PREFIX,
        clientSecret: "soko_client_secret_",
      },
    }),
    oAuthProxy({
      productionURL: getBetterAuthProductionUrl(),
      // Without this the plugin compares the production URL to the request
      // URL. That was plain HTTP behind Vercel's TLS termination until
      // `withPublicScheme`, so production proxied its own sign-ins.
      currentURL: betterAuthBaseUrl,
      secret: env.OAUTH_PROXY_SECRET,
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
        // customer.subscription.created reconciles in onEvent instead, where
        // a failure reaches Stripe and is retried.
        onSubscriptionUpdate: reconcileAfterSubscriptionUpdate,
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
