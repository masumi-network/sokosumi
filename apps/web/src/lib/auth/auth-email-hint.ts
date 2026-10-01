const AUTH_EMAIL_HINT_KEY = "auth-email-hint";

/** Carries an editable email between auth pages without putting it in a URL. */
export function rememberAuthEmailHint(email: string): void {
  if (typeof window === "undefined") return;
  try {
    // An empty address must also replace any abandoned hint.
    window.sessionStorage.removeItem(AUTH_EMAIL_HINT_KEY);
    const trimmed = email.trim();
    if (trimmed) {
      window.sessionStorage.setItem(AUTH_EMAIL_HINT_KEY, trimmed);
    }
  } catch {
    // Blocked storage / quota: navigation still works without a prefill.
  }
}

/** Clear old hints even when a modified click navigates in another tab. */
export function rememberAuthEmailHintOnClick(
  event: Pick<
    MouseEvent,
    | "defaultPrevented"
    | "button"
    | "metaKey"
    | "ctrlKey"
    | "shiftKey"
    | "altKey"
  >,
  email: string,
): void {
  const staysInTab =
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey;
  rememberAuthEmailHint(staysInTab ? email : "");
}

/** Reads the hint once; discarded hints cannot appear on a later visit. */
export function takeAuthEmailHint(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(AUTH_EMAIL_HINT_KEY);
    window.sessionStorage.removeItem(AUTH_EMAIL_HINT_KEY);
    return value?.trim() || null;
  } catch {
    return null;
  }
}
