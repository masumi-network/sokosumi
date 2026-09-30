const SIGN_IN_EMAIL_HINT_KEY = "auth-sign-in-email-hint";

/**
 * Carries the email a person typed on sign-up over to the sign-in form, which
 * prefills it and leaves it editable. It travels in the tab's session storage
 * rather than the `email` query parameter: that parameter locks the field (it
 * is how an invitation pins its address), and an address in a URL ends up in
 * logs and history.
 */
export function rememberSignInEmailHint(email: string): void {
  const trimmed = email.trim();
  if (!trimmed || typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(SIGN_IN_EMAIL_HINT_KEY, trimmed);
  } catch {
    // private mode / quota — sign-in just opens with an empty field
  }
}

/** Reads the hint once; the next visit to sign-in starts empty again. */
export function takeSignInEmailHint(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const value = window.sessionStorage.getItem(SIGN_IN_EMAIL_HINT_KEY);
    window.sessionStorage.removeItem(SIGN_IN_EMAIL_HINT_KEY);
    return value?.trim() || null;
  } catch {
    return null;
  }
}
