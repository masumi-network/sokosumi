import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { getTranslations } from "next-intl/server";

import { getEnvPublicConfig, getEnvSecrets } from "@/config/env.config";
import {
  convertCreditsToCents,
  createCreditTransaction,
  prisma,
} from "@/lib/db";
import { reactChangeEmailVerificationEmail } from "@/lib/email/change-email";
import { resend } from "@/lib/email/resend";
import { reactResetPasswordEmail } from "@/lib/email/reset-password";
import { reactVerificationEmail } from "@/lib/email/verification";

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;

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
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          try {
            const cents = convertCreditsToCents(
              getEnvSecrets().FREE_CREDITS_ON_SIGNUP,
            );
            await createCreditTransaction(user.id, cents);
          } catch (error) {
            console.error(
              `Error creating credit transaction for user ${user.id} with error: ${error}`,
            );
          }
        },
      },
    },
  },
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
  },
  rateLimit: {
    storage: "database",
  },
  plugins: [nextCookies()],
});
