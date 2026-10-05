import { CAPTCHA_PASS_IDENTIFIER_PREFIX } from "@/lib/auth-sign-up-email-status";
import prisma from "@/lib/db/prisma";

export interface PurgeExpiredCaptchaPassesOptions {
  /** Overridable for tests; defaults to the call time. */
  now?: Date;
  /** Checked before the delete, so the sync deadline can skip it. */
  abortSignal?: AbortSignal;
}

/**
 * Housekeeping: delete captcha passes past their expiry.
 *
 * Every email status check issues one (`auth-sign-up-email-status`), and only
 * consuming a pass deletes its row. A check that sends no code, such as the
 * password path or an abandoned page, leaves the row behind, and Better Auth
 * sweeps no expired verification rows on its own.
 *
 * Only pass rows: other expired verification rows, such as email codes, stay
 * for Better Auth, which may read one to say "expired" rather than "invalid".
 * One statement, since the rows are small and at most an hour accumulates.
 */
export async function purgeExpiredCaptchaPasses(
  options: PurgeExpiredCaptchaPassesOptions = {},
): Promise<{ purged: number }> {
  if (options.abortSignal?.aborted) return { purged: 0 };
  const { count } = await prisma.verification.deleteMany({
    where: {
      identifier: { startsWith: CAPTCHA_PASS_IDENTIFIER_PREFIX },
      expiresAt: { lte: options.now ?? new Date() },
    },
  });
  return { purged: count };
}

export const captchaPassPurgeService = { purgeExpiredCaptchaPasses };
