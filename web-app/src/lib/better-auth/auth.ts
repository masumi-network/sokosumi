import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import {
  admin,
  multiSession,
  organization,
  twoFactor,
} from "better-auth/plugins";
import { passkey } from "better-auth/plugins/passkey";
import { getTranslations } from "next-intl/server";

import { envConfig, envSecrets } from "@/config/env.config";
import prisma from "@/lib/db/prisma";
import { reactChangeEmailVerificationEmail } from "@/lib/email/change-email";
import { resend } from "@/lib/email/resend";
import { reactResetPasswordEmail } from "@/lib/email/reset-password";
import { reactVerificationEmail } from "@/lib/email/verification";

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;

const fromEmail = envConfig.NOREPLY_EMAIL ?? "no-reply@resend.dev";

export const auth = betterAuth({
  session: {
    expiresIn: envConfig.BETTER_AUTH_SESSION_EXPIRES_IN,
    updateAge: envConfig.BETTER_AUTH_SESSION_UPDATE_AGE,
    freshAge: envConfig.BETTER_AUTH_SESSION_FRESH_AGE,
    cookieCache: {
      enabled: true,
      maxAge: envConfig.BETTER_AUTH_SESSION_COOKIE_CACHE_MAX_AGE,
    },
  },
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      const t = await getTranslations("Auth.Email.Verification");

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
  },
  emailAndPassword: {
    enabled: true,
    maxPasswordLength: envConfig.PASSWORD_MAX_LENGTH,
    minPasswordLength: envConfig.PASSWORD_MIN_LENGTH,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      const t = await getTranslations("Auth.Email.ResetPassword");

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
  user: {
    changeEmail: {
      enabled: true,
      sendChangeEmailVerification: async ({ user, url }) => {
        const t = await getTranslations("Auth.Email.ChangeEmail");

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
  socialProviders: {
    google: {
      clientId: envConfig.GOOGLE_CLIENT_ID,
      clientSecret: envSecrets.GOOGLE_CLIENT_SECRET,
    },
    microsoft: {
      clientId: envConfig.MICROSOFT_CLIENT_ID,
      clientSecret: envSecrets.MICROSOFT_CLIENT_SECRET,
    },
    apple: {
      clientId: envConfig.APPLE_CLIENT_ID,
      clientSecret: envSecrets.APPLE_CLIENT_SECRET,
    },
    linkedin: {
      clientId: envConfig.LINKEDIN_CLIENT_ID,
      clientSecret: envSecrets.LINKEDIN_CLIENT_SECRET,
    },
  },
  plugins: [
    organization(),
    twoFactor({
      otpOptions: {
        async sendOTP({ user, otp }) {
          await resend.emails.send({
            from: fromEmail,
            to: user.email,
            subject: "Your OTP",
            html: `Your OTP is ${otp}`,
          });
        },
      },
    }),
    passkey(),
    admin(),
    multiSession(),
    nextCookies(),
  ],
});
