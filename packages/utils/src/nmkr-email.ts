const NMKR_EMAIL_DOMAIN = "nmkr.io";

export function isNmkrEmail(email: string | null | undefined): boolean {
  if (!email || /\s/.test(email)) {
    return false;
  }

  const [localPart, domain, ...remainingParts] = email.split("@");
  if (!localPart || remainingParts.length > 0) {
    return false;
  }

  return domain?.toLowerCase() === NMKR_EMAIL_DOMAIN;
}
