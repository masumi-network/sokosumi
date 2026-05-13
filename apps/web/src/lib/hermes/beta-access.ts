import { getEmailDomain } from "@/lib/utils";

/** Primary email domain allowed to use Hermes beta (sidebar, page, APIs). */
export const HERMES_BETA_EMAIL_DOMAIN = "nmkr.io";

export function isHermesBetaAccessEmail(
  email: string | null | undefined,
): boolean {
  const domain = email ? getEmailDomain(email) : null;
  return domain === HERMES_BETA_EMAIL_DOMAIN;
}
