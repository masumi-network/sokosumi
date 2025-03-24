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

import { envServer } from "@/config/env.config";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/constants";

import prisma from "../db/prisma";
import { resend } from "../email/resend";
import { reactResetPasswordEmail } from "../email/reset-password";
import { reactVerificationEmail } from "../email/verification";

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;

const fromEmail = envServer.NOREPLY_EMAIL ?? "no-reply@resend.dev";

export const auth = betterAuth({
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
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
  rateLimit: {
    storage: "database",
  },
  socialProviders: {
    google: {
      clientId: envServer.GOOGLE_CLIENT_ID ?? "",
      clientSecret: envServer.GOOGLE_CLIENT_SECRET ?? "",
    },
    microsoft: {
      clientId: envServer.MICROSOFT_CLIENT_ID ?? "",
      clientSecret: envServer.MICROSOFT_CLIENT_SECRET ?? "",
    },
    apple: {
      clientId: envServer.APPLE_CLIENT_ID ?? "",
      clientSecret: envServer.APPLE_CLIENT_SECRET ?? "",
    },
    linkedin: {
      clientId: envServer.LINKEDIN_CLIENT_ID ?? "",
      clientSecret: envServer.LINKEDIN_CLIENT_SECRET ?? "",
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
