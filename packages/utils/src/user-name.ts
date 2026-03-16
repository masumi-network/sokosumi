export function getFallbackUserName(email: string): string {
  const normalizedEmail = email.trim();
  const [prefix] = normalizedEmail.split("@");
  const normalizedPrefix = prefix?.trim();

  return normalizedPrefix || normalizedEmail || "User";
}

export function getStoredUserName(
  name: null | string | undefined,
  email: string,
): string {
  const normalizedName = name?.trim();

  return normalizedName || getFallbackUserName(email);
}
