import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";
import { getTranslations } from "next-intl/server";

import { getEnvPublicConfig } from "@/config/env.public";
import { getEnvSecrets } from "@/config/env.secrets";
import { MemberRole } from "@/lib/db";
import { prisma } from "@/lib/db/repositories";
import { reactChangeEmailVerificationEmail } from "@/lib/email/change-email";
import { reactInviteUserEmail } from "@/lib/email/invitation";
import { resend } from "@/lib/email/resend";
import { reactResetPasswordEmail } from "@/lib/email/reset-password";
import { reactVerificationEmail } from "@/lib/email/verification";

export type Session = typeof auth.$Infer.Session;
export type SessionUser = typeof auth.$Infer.Session.user;

const fromEmail = getEnvSecrets().RESEND_FROM_EMAIL;

export const auth = betterAuth({
  session: {
    expiresIn: getEnvSecrets().BETTER_AUTH_SESSION_EXPIRES_IN,
    updateAge: getEnvSecrets().BETTER_AUTH_SESSION_UPDATE_AGE,
    freshAge: getEnvSecrets().BETTER_AUTH_SESSION_FRESH_AGE,
    cookieCache: {
      enabled: true,
      maxAge: getEnvSecrets().BETTER_AUTH_SESSION_COOKIE_CACHE_MAX_AGE,
    },
  },
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  trustedOrigins: (_) => {
    const origins = [...getEnvSecrets().BETTER_AUTH_TRUSTED_ORIGINS];
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

      await resend.emails.send({
        from: fromEmail,
        to: user.email,
        subject: t("subject"),
        react: reactResetPasswordEmail({
          name: user.name,
          resetLink: url,
        }),
      });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      const t = await getTranslations("Library.Auth.Email.Verification");

      await resend.emails.send({
        from: fromEmail,
        to: user.email,
        subject: t("subject"),
        react: reactVerificationEmail({
          name: user.name,
          verificationLink: url,
        }),
      });
    },
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
  },
  user: {
    changeEmail: {
      enabled: true,
      sendChangeEmailVerification: async ({ user, url }) => {
        const t = await getTranslations("Library.Auth.Email.ChangeEmail");

        await resend.emails.send({
          from: fromEmail,
          to: user.email,
          subject: t("subject"),
          react: reactChangeEmailVerificationEmail({
            name: user.name,
            changeEmailLink: url,
          }),
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
      },
      marketingOptIn: {
        type: "boolean",
        required: false,
      },
    },
  },
  rateLimit: {
    storage: "database",
  },
  plugins: [
    organization({
      async sendInvitationEmail(data) {
        const inviteLink = `${getEnvSecrets().BETTER_AUTH_URL}/accept-invitation/${data.id}`;
        const t = await getTranslations("Library.Auth.Email.InviteUserEmail");

        await resend.emails.send({
          from: fromEmail,
          to: data.email,
          subject: t("subject"),
          react: reactInviteUserEmail({
            organizationName: data.organization.name,
            invitorUsername: data.inviter.user.name,
            inviteLink,
          }),
        });
      },
      async invitationLimit({ member }) {
        return member.role === MemberRole.ADMIN ? 100 : 0;
      },
      cancelPendingInvitationsOnReInvite: true,
    }),
    nextCookies(),
  ],
});
