import type { OAuthOptions, Scope } from "@better-auth/oauth-provider";
import type { z } from "zod";

import { recordUtmAttribution } from "@/helpers/utm-attribution";
import prisma from "@/lib/db/prisma";
import type { utmAttributionRequestSchema } from "@/schemas/user.schema";

/*
 * A social sign-up waits as a pending sign-up conversion until a Web page
 * counts it (GTM `sign_up` and UTM attribution, apps/web/TRACKING.md). Web's
 * `/auth/callback/signup` is that page outside an OAuth request. Inside one,
 * Core's OAuth provider answers the provider callback itself and never
 * reaches it, so `signup.shouldRedirect` sends the browser through Web's
 * sign-up hand-back, once. Claiming deletes the conversion row, so it counts
 * once; taking the redirect deletes its own row, so a claim that keeps
 * failing cannot send the browser round in a loop. Both rows live in Better
 * Auth's `verification` table, which needs no migration.
 */

/** The social providers whose sign-ups wait for a Web page to count them. */
export const SIGN_UP_CONVERSION_PROVIDERS = ["google", "microsoft"] as const;
export type SignUpConversionProvider =
  (typeof SIGN_UP_CONVERSION_PROVIDERS)[number];

/** A sign-up no Web page counted within this window is not counted. */
const SIGN_UP_CONVERSION_TTL_MS = 60 * 60 * 1000;

const SOCIAL_CALLBACK_PATHS = ["/callback/:id", "/callback/:id/oauth-proxy"];

interface AuthRequestContext {
  path?: string;
  params?: Record<string, string | undefined>;
}

/**
 * Every conversion row's identifier starts with one of these; the purge sync
 * deletes the rows no Web page claimed before they expired.
 */
export const SIGN_UP_CONVERSION_IDENTIFIER_PREFIXES = [
  "sign-up-conversion:",
  "sign-up-conversion-redirect:",
] as const;

function identifierFor(userId: string): string {
  return `${SIGN_UP_CONVERSION_IDENTIFIER_PREFIXES[0]}${userId}`;
}

function redirectIdentifierFor(userId: string): string {
  return `${SIGN_UP_CONVERSION_IDENTIFIER_PREFIXES[1]}${userId}`;
}

function isSignUpConversionProvider(
  value: string | undefined,
): value is SignUpConversionProvider {
  return SIGN_UP_CONVERSION_PROVIDERS.some((provider) => provider === value);
}

/**
 * Records a pending conversion for an account a social provider's callback
 * created. Credential and email code sign-ups are counted in place by the
 * page that submits them; native id token sign-ins have no Web page to count
 * them.
 */
export async function recordSignUpConversion(
  userId: string,
  ctx: AuthRequestContext | null | undefined,
): Promise<void> {
  const provider = ctx?.params?.id;
  if (
    !ctx?.path ||
    !SOCIAL_CALLBACK_PATHS.includes(ctx.path) ||
    !isSignUpConversionProvider(provider)
  ) {
    return;
  }
  const now = new Date();
  const row = {
    value: provider,
    expiresAt: new Date(now.getTime() + SIGN_UP_CONVERSION_TTL_MS),
    createdAt: now,
    updatedAt: now,
  };
  await prisma.verification.createMany({
    data: [
      { identifier: identifierFor(userId), ...row },
      { identifier: redirectIdentifierFor(userId), ...row },
    ],
  });
}

/**
 * Whether to send this user's authorization through Web's sign-up page:
 * true once per pending conversion, false ever after.
 */
export async function takeSignUpConversionRedirect(
  userId: string,
): Promise<boolean> {
  const { count } = await prisma.verification.deleteMany({
    where: {
      identifier: redirectIdentifierFor(userId),
      expiresAt: { gt: new Date() },
      value: { in: [...SIGN_UP_CONVERSION_PROVIDERS] },
    },
  });
  return count > 0;
}

/**
 * Core's OAuth provider `signup` options. `prompt=create` lands on Web's
 * sign-up page, and so does the first authorization for a user with a
 * pending sign-up conversion: the page counts it, then hands the request
 * back through `/oauth2/continue`. A failed lookup lets the authorization go
 * on uncounted rather than stopping the person.
 */
export function oauthSignUpOptions(
  webAppBaseUrl: string,
): NonNullable<OAuthOptions<Scope[]>["signup"]> {
  return {
    page: `${webAppBaseUrl}/signup`,
    shouldRedirect: ({ user }) =>
      takeSignUpConversionRedirect(user.id).catch(() => false),
  };
}

/**
 * The provider of the user's pending sign-up conversion, to the first caller
 * only. Later calls, and users with nothing pending, get `null`.
 */
export async function claimSignUpConversion(
  userId: string,
  utmAttribution?: z.infer<typeof utmAttributionRequestSchema>,
): Promise<SignUpConversionProvider | null> {
  return prisma.$transaction(async (tx) => {
    const pending = await tx.verification.findFirst({
      where: {
        identifier: identifierFor(userId),
        expiresAt: { gt: new Date() },
      },
      select: { id: true, value: true },
    });
    if (!pending || !isSignUpConversionProvider(pending.value)) {
      return null;
    }
    const { count } = await tx.verification.deleteMany({
      where: { id: pending.id, expiresAt: { gt: new Date() } },
    });
    if (count !== 1) {
      return null;
    }
    // Counted: a later authorization must not detour through Web's sign-up
    // page to count it again.
    await tx.verification.deleteMany({
      where: { identifier: redirectIdentifierFor(userId) },
    });
    if (utmAttribution) {
      await recordUtmAttribution(userId, utmAttribution, tx);
    }
    return pending.value;
  });
}
