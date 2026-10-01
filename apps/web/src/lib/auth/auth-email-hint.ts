const AUTH_EMAIL_HINT_KEY = "auth-email-hint";

/**
 * Carries the email a person typed on sign-in or sign-up over to the other
 * page, which prefills it and leaves it editable. It travels in the tab's
 * session storage rather than the `email` query parameter: that parameter
 * locks the field (it is how an invitation pins its address), and an address
 * in a URL ends up in logs and history.
 */
export function rememberAuthEmailHint(email: string): void {
  const trimmed = email.trim();
  if (!trimmed || typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(AUTH_EMAIL_HINT_KEY, trimmed);
  } catch {
    // private mode / quota — the other page just opens with an empty field
  }
}

/** Reads the hint once; the next visit to either page starts empty again. */
export function takeAuthEmailHint(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const value = window.sessionStorage.getItem(AUTH_EMAIL_HINT_KEY);
    window.sessionStorage.removeItem(AUTH_EMAIL_HINT_KEY);
    return value?.trim() || null;
  } catch {
    return null;
  }
}
