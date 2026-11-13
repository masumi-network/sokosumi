import prisma from "@/lib/db/prisma";

/**
 * Whether the email Core holds for this person, or its `@domain`, is on an
 * allowlist parsed by Core's env (`CMO_HIRE_ALLOWLIST` and the like). With
 * `requireVerifiedEmail` only a verified address counts: anyone can register
 * an unverified one at a listed domain.
 */
export async function isOnEmailAllowlist(
  userId: string,
  allowlist: readonly string[],
  options: { requireVerifiedEmail?: boolean } = {},
): Promise<boolean> {
  if (allowlist.length === 0) return false;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerified: true },
  });
  if (options.requireVerifiedEmail && user?.emailVerified !== true) {
    return false;
  }
  const email = user?.email.trim().toLowerCase();
  if (!email) return false;
  const domain = email.slice(email.lastIndexOf("@"));
  return allowlist.some((entry) => entry === email || entry === domain);
}
