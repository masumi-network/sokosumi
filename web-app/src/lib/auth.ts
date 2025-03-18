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

import prisma from "./db/prisma";
import { resend } from "./email/resend";
import { reactResetPasswordEmail } from "./email/reset-password";
import { reactVerificationEmail } from "./email/verification";

const fromEmail = process.env.NOREPLY_EMAIL || "no-reply@resend.dev";

export const auth = betterAuth({
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
          username: user.email,
          verificationLink: url,
        }),
      });
    },
    sendOnSignUp: true,
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      console.log("sendResetPassword", user, url);
      const t = await getTranslations("Auth.Email.ResetPassword");

      await resend.emails.send({
        from: fromEmail,
        to: user.email,
        subject: t("subject"),
        react: reactResetPasswordEmail({
          username: user.email,
          resetLink: url,
        }),
      });
    },
  },
  rateLimit: {
    storage: "database",
  },
  socialProviders: {
    // google: {
    //   clientId: process.env.GOOGLE_CLIENT_ID || "<google-client-id>",
    //   clientSecret:
    //     process.env.GOOGLE_CLIENT_SECRET || "<google-client-secret>",
    // },
    // microsoft: {
    //   clientId: process.env.MICROSOFT_CLIENT_ID || "<microsoft-client-id>",
    //   clientSecret:
    //     process.env.MICROSOFT_CLIENT_SECRET || "<microsoft-client-secret>",
    // },
    // apple: {
    //   clientId: process.env.APPLE_CLIENT_ID || "<apple-client-id>",
    //   clientSecret: process.env.APPLE_CLIENT_SECRET || "<apple-client-secret>",
    // },
    // linkedin: {
    //   clientId: process.env.LINKEDIN_CLIENT_ID || "<linkedin-client-id>",
    //   clientSecret:
    //     process.env.LINKEDIN_CLIENT_SECRET || "<linkedin-client-secret>",
    // },
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
