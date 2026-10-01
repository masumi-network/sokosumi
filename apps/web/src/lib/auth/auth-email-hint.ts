const AUTH_EMAIL_HINT_KEY = "auth-email-hint";
const AUTH_EMAIL_HINT_NO_ACCOUNT_KEY = "auth-email-hint-no-account";

interface AuthEmailHintOptions {
  /** The page handing over the email has asked Core: it has no account. */
  noAccount?: boolean;
}

interface AuthEmailHintEntry {
  email: string;
  noAccount: boolean;
}

/** Carries an editable email between auth pages without putting it in a URL. */
export function rememberAuthEmailHint(
  email: string,
  { noAccount = false }: AuthEmailHintOptions = {},
): void {
  if (typeof window === "undefined") return;
  try {
    // An empty address must also replace any abandoned hint.
    window.sessionStorage.removeItem(AUTH_EMAIL_HINT_KEY);
    window.sessionStorage.removeItem(AUTH_EMAIL_HINT_NO_ACCOUNT_KEY);
    const trimmed = email.trim();
    if (trimmed) {
      window.sessionStorage.setItem(AUTH_EMAIL_HINT_KEY, trimmed);
      if (noAccount) {
        window.sessionStorage.setItem(AUTH_EMAIL_HINT_NO_ACCOUNT_KEY, "1");
      }
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
  options?: AuthEmailHintOptions,
): void {
  const staysInTab =
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey;
  rememberAuthEmailHint(staysInTab ? email : "", options);
}

/** Reads the hint once; discarded hints cannot appear on a later visit. */
export function takeAuthEmailHintEntry(): AuthEmailHintEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(AUTH_EMAIL_HINT_KEY);
    const noAccount =
      window.sessionStorage.getItem(AUTH_EMAIL_HINT_NO_ACCOUNT_KEY) === "1";
    window.sessionStorage.removeItem(AUTH_EMAIL_HINT_KEY);
    window.sessionStorage.removeItem(AUTH_EMAIL_HINT_NO_ACCOUNT_KEY);
    const email = value?.trim();
    return email ? { email, noAccount } : null;
  } catch {
    return null;
  }
}

/** The email part of `takeAuthEmailHintEntry`. */
export function takeAuthEmailHint(): string | null {
  return takeAuthEmailHintEntry()?.email ?? null;
}
