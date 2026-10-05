import { SIGN_UP_CONVERSION_IDENTIFIER_PREFIXES } from "@/lib/auth-sign-up-conversion";
import { CAPTCHA_PASS_IDENTIFIER_PREFIX } from "@/lib/auth-sign-up-email-status";
import prisma from "@/lib/db/prisma";

/** Rows Core writes to Better Auth's `verification` table and alone deletes. */
const CORE_VERIFICATION_PREFIXES = [
  CAPTCHA_PASS_IDENTIFIER_PREFIX,
  ...SIGN_UP_CONVERSION_IDENTIFIER_PREFIXES,
];

export interface PurgeExpiredVerificationsOptions {
  /** Overridable for tests; defaults to the call time. */
  now?: Date;
  /** Checked before the delete, so the sync deadline can skip it. */
  abortSignal?: AbortSignal;
}

/**
 * Housekeeping: delete Core's own verification rows past their expiry.
 *
 * - Captcha passes: every email status check issues one
 *   (`auth-sign-up-email-status`), and only consuming a pass deletes its row.
 *   A check that sends no code, such as the password path or an abandoned
 *   page, leaves the row behind.
 * - Sign-up conversions: a social sign-up writes a claim row and a redirect
 *   row (`auth-sign-up-conversion`). Only a Web page claiming it in time
 *   deletes them, so a sign-up nobody counts leaves both behind.
 *
 * Better Auth sweeps no expired verification rows on its own. Only Core's
 * rows: other expired verification rows, such as email codes, stay for Better
 * Auth, which may read one to say "expired" rather than "invalid". One
 * statement, since the rows are small and at most an hour accumulates.
 */
export async function purgeExpiredVerifications(
  options: PurgeExpiredVerificationsOptions = {},
): Promise<{ purged: number }> {
  if (options.abortSignal?.aborted) return { purged: 0 };
  const { count } = await prisma.verification.deleteMany({
    where: {
      OR: CORE_VERIFICATION_PREFIXES.map((prefix) => ({
        identifier: { startsWith: prefix },
      })),
      expiresAt: { lte: options.now ?? new Date() },
    },
  });
  return { purged: count };
}

export const expiredVerificationsPurgeService = { purgeExpiredVerifications };
