/** Letters and digits only, lower case: "Cal.com" and "cal com" match. */
export function squash(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** A host without "www.", lower case: one site whatever the address says. */
export function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

/** Trimmed text, or null for anything that is not a non-empty string. */
export function nonEmptyText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
