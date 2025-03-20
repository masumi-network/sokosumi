import { PrismaClient } from "@prisma/client";
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

import { resend } from "./email/resend";
import { reactResetPasswordEmail } from "./email/reset-password";

const prisma = new PrismaClient();

const fromEmail = process.env.BETTER_AUTH_EMAIL || "no-reply@masumi.network";

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailVerification: {
    async sendVerificationEmail({ user, url }) {
      const res = await resend.emails.send({
        from: fromEmail,
        to: user.email,
        subject: "Verify your email address",
        html: `<a href="${url}">Verify your email address</a>`,
      });
      console.log(res, user.email);
    },
    // sendOnSignUp: true,
  },
  emailAndPassword: {
    enabled: true,
    // requireEmailVerification: true,
    async sendResetPassword({ user, url }) {
      await resend.emails.send({
        from: fromEmail,
        to: user.email,
        subject: "Reset your password",
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
