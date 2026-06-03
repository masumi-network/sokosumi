import { getEmailDomain } from "@/lib/utils";

/** Email domains allowed to use Hermes beta (sidebar, page, APIs). */
export const HERMES_BETA_EMAIL_DOMAINS = ["nmkr.io"] as const;

export const HERMES_BETA_ALLOWED_EMAILS = [
  "k.platz@house-of-communication.com",
  "y.bollinger@house-of-communication.com",
  "s.kuepers@house-of-communication.com",
  "m.starkova@house-of-communication.com",
] as const;

const HERMES_BETA_EMAIL_DOMAIN_SET = new Set<string>(HERMES_BETA_EMAIL_DOMAINS);
const HERMES_BETA_ALLOWED_EMAIL_SET = new Set<string>(
  HERMES_BETA_ALLOWED_EMAILS.map((allowedEmail) => allowedEmail.toLowerCase()),
);

export function isHermesBetaAccessEmail(
  email: string | null | undefined,
): boolean {
  if (!email) {
    return false;
  }

  if (HERMES_BETA_ALLOWED_EMAIL_SET.has(email.toLowerCase())) {
    return true;
  }

  const domain = getEmailDomain(email);
  return domain !== null && HERMES_BETA_EMAIL_DOMAIN_SET.has(domain);
}
