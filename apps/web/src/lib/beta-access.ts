import { isNmkrEmail } from "@sokosumi/utils";

/**
 * Email domains allowed to use beta features.
 */
export function isBetaAccessEmail(email: string | null | undefined): boolean {
  return isNmkrEmail(email);
}

/**
 * Beta access for Soko Bot. Signup does not require email verification and
 * signs the user straight in, so a whitelisted domain alone proves nothing:
 * anyone can register `someone@nmkr.io` without holding that mailbox. The
 * verified flag is what makes the domain check mean something.
 */
export function hasSokoBotBetaAccess(
  user: { email?: string | null; emailVerified?: boolean | null } | null,
): boolean {
  if (!user?.emailVerified) return false;
  return isBetaAccessEmail(user.email);
}
