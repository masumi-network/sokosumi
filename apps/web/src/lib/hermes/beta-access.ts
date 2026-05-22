import { getEmailDomain } from "@/lib/utils";

/** Email domains allowed to use Hermes beta (sidebar, page, APIs). */
export const HERMES_BETA_EMAIL_DOMAINS = [
  "nmkr.io",
  "house-of-communication.com",
] as const;

const HERMES_BETA_EMAIL_DOMAIN_SET = new Set<string>(HERMES_BETA_EMAIL_DOMAINS);

export function isHermesBetaAccessEmail(
  email: string | null | undefined,
): boolean {
  const domain = email ? getEmailDomain(email) : null;
  return domain !== null && HERMES_BETA_EMAIL_DOMAIN_SET.has(domain);
}
