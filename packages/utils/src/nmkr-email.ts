const NMKR_EMAIL_DOMAIN = "nmkr.io";

export function isNmkrEmail(email: string | null | undefined): boolean {
  if (!email) {
    return false;
  }

  const domain = email.trim().split("@").at(-1)?.toLowerCase();
  return domain === NMKR_EMAIL_DOMAIN;
}
