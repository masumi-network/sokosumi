import { getEmailDomain } from "@/lib/utils";

/**
 * Email domains allowed to use the Hermes beta (sidebar entry + page).
 * Everyone else gets a 404 on /personal-assistant and no nav item —
 * activation itself additionally stays behind the Core paid-plan gate.
 */
export const HERMES_BETA_EMAIL_DOMAINS = ["nmkr.io"] as const;

const HERMES_BETA_EMAIL_DOMAIN_SET = new Set<string>(HERMES_BETA_EMAIL_DOMAINS);

export function isHermesBetaAccessEmail(
  email: string | null | undefined,
): boolean {
  if (!email) {
    return false;
  }

  const domain = getEmailDomain(email);
  return domain !== null && HERMES_BETA_EMAIL_DOMAIN_SET.has(domain);
}
