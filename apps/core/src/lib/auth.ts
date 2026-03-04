import { apiKey } from "@better-auth/api-key";
import { i18n } from "@better-auth/i18n";
import { oauthProvider } from "@better-auth/oauth-provider";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { betterAuth } from "better-auth/minimal";
import { admin, jwt, openAPI, organization } from "better-auth/plugins";

import { LIMITS, TIME } from "@/config/constants";
import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";

const env = getEnv();
const authTranslations = {
  en: {
    USER_NOT_FOUND: "User not found",
    INVALID_EMAIL: "Invalid email",
    INVALID_PASSWORD: "Invalid password",
    INVALID_EMAIL_OR_PASSWORD: "Invalid email or password",
    EMAIL_NOT_VERIFIED: "Please verify your email address",
    PASSWORD_TOO_SHORT: "Password is too short",
    PASSWORD_TOO_LONG: "Password is too long",
    USER_ALREADY_EXISTS: "User already exists",
    SESSION_EXPIRED: "Session expired",
    UNAUTHORIZED: "Unauthorized",
  },
  de: {
    USER_NOT_FOUND: "Benutzer nicht gefunden",
    INVALID_EMAIL: "Ungültige E-Mail-Adresse",
    INVALID_PASSWORD: "Ungültiges Passwort",
    INVALID_EMAIL_OR_PASSWORD: "Ungültige E-Mail oder ungültiges Passwort",
    EMAIL_NOT_VERIFIED: "Bitte bestätige zuerst deine E-Mail-Adresse",
    PASSWORD_TOO_SHORT: "Das Passwort ist zu kurz",
    PASSWORD_TOO_LONG: "Das Passwort ist zu lang",
    USER_ALREADY_EXISTS: "Benutzer existiert bereits",
    SESSION_EXPIRED: "Sitzung abgelaufen",
    UNAUTHORIZED: "Nicht autorisiert",
  },
  es: {
    USER_NOT_FOUND: "Usuario no encontrado",
    INVALID_EMAIL: "Correo electrónico no válido",
    INVALID_PASSWORD: "Contraseña no válida",
    INVALID_EMAIL_OR_PASSWORD: "Correo electrónico o contraseña no válidos",
    EMAIL_NOT_VERIFIED: "Verifica tu correo electrónico",
    PASSWORD_TOO_SHORT: "La contraseña es demasiado corta",
    PASSWORD_TOO_LONG: "La contraseña es demasiado larga",
    USER_ALREADY_EXISTS: "El usuario ya existe",
    SESSION_EXPIRED: "La sesión ha expirado",
    UNAUTHORIZED: "No autorizado",
  },
} as const;

export const auth = betterAuth({
  advanced: {
    crossSubDomainCookies: {
      enabled: true,
    },
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: TIME.SESSION_COOKIE_CACHE_MAX_AGE,
    },
    storeSessionInDatabase: true,
  },
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  basePath: "/auth",
  rateLimit: {
    storage: "database",
  },
  trustedOrigins: [env.BETTER_AUTH_TRUSTED_ORIGIN],
  user: {
    emailAndPassword: {
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
  plugins: [
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
    }),
    jwt({ disableSettingJwtHeader: true }),
    organization({
      schema: {
        organization: {
          additionalFields: {
            stripeCustomerId: {
              type: "string",
              required: false,
              defaultValue: null,
              input: false,
            },
            invoiceEmail: {
              type: "string",
              required: false,
              defaultValue: null,
              input: false,
            },
          },
        },
      },
    }),
    oauthProvider({
      loginPage: `${env.BETTER_AUTH_TRUSTED_ORIGIN}/signin`,
      consentPage: `${env.BETTER_AUTH_TRUSTED_ORIGIN}/oauth/consent`,
      scopes: ["openid", "offline_access"],
      clientRegistrationDefaultScopes: ["openid", "offline_access"],
      accessTokenExpiresIn: 7_200, // 2 hours (default: 3_600)
      refreshTokenExpiresIn: 7_776_000, // 90 days (default: 2_592_000)
      idTokenExpiresIn: 72_000, // 20 hours (default: 3_6000)
      codeExpiresIn: 600, // 10 minutes (default: 600)
      prefix: {
        opaqueAccessToken: "soko_access_token_",
        refreshToken: "soko_refresh_token_",
        clientSecret: "soko_client_secret_",
      },
    }),
  ],
});
