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

import {
  BETTER_AUTH_SESSION_COOKIE_CACHE_MAX_AGE,
  BETTER_AUTH_SESSION_EXPIRES_IN,
  BETTER_AUTH_SESSION_FRESH_AGE,
  BETTER_AUTH_SESSION_UPDATE_AGE,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/constants";

import prisma from "../db/prisma";
import { reactChangeEmailVerificationEmail } from "../email/change-email";
import { resend } from "../email/resend";
import { reactResetPasswordEmail } from "../email/reset-password";
import { reactVerificationEmail } from "../email/verification";

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;

const fromEmail = process.env.NOREPLY_EMAIL ?? "no-reply@resend.dev";

export const auth = betterAuth({
  session: {
    expiresIn: BETTER_AUTH_SESSION_EXPIRES_IN,
    updateAge: BETTER_AUTH_SESSION_UPDATE_AGE,
    freshAge: BETTER_AUTH_SESSION_FRESH_AGE,
    cookieCache: {
      enabled: true,
      maxAge: BETTER_AUTH_SESSION_COOKIE_CACHE_MAX_AGE,
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
    maxPasswordLength: PASSWORD_MAX_LENGTH,
    minPasswordLength: PASSWORD_MIN_LENGTH,
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
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
    microsoft: {
      clientId: process.env.MICROSOFT_CLIENT_ID ?? "",
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? "",
    },
    apple: {
      clientId: process.env.APPLE_CLIENT_ID ?? "",
      clientSecret: process.env.APPLE_CLIENT_SECRET ?? "",
    },
    linkedin: {
      clientId: process.env.LINKEDIN_CLIENT_ID ?? "",
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET ?? "",
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
