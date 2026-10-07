const AUTH_EMAIL_HINT_KEY = "auth-email-hint";
const AUTH_EMAIL_HINT_SIGN_UP_KEY = "auth-email-hint-sign-up";
const AUTH_EMAIL_HINT_SIGN_IN_KEY = "auth-email-hint-sign-in";

/** Sign-in found no account for the email, so sign-up can skip its email step. */
interface SignUpHandover {
  /** When sign-in emailed the code; `null` when the send failed. */
  codeSentAt: number | null;
}

/** Sign-up found an account for the email, so sign-in can skip its email step. */
type SignInHandover =
  | {
      method: "code";
      /** When sign-up emailed the code; `null` when the send failed. */
      codeSentAt: number | null;
    }
  | { method: "password" };

interface AuthEmailHintOptions {
  signUp?: SignUpHandover;
  signIn?: SignInHandover;
}

type ClickModifiers = Pick<
  MouseEvent,
  "defaultPrevented" | "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
>;

function clearAuthEmailHint(): void {
  window.sessionStorage.removeItem(AUTH_EMAIL_HINT_KEY);
  window.sessionStorage.removeItem(AUTH_EMAIL_HINT_SIGN_UP_KEY);
  window.sessionStorage.removeItem(AUTH_EMAIL_HINT_SIGN_IN_KEY);
}

/** A stored send time, or `null` when no code went out. */
function parseCodeSentAt(value: string): number | null {
  const codeSentAt = Number(value);
  return Number.isFinite(codeSentAt) && codeSentAt > 0 ? codeSentAt : null;
}

/** Carries an editable email between auth pages without putting it in a URL. */
export function rememberAuthEmailHint(
  email: string,
  { signUp, signIn }: AuthEmailHintOptions = {},
): void {
  if (typeof window === "undefined") return;
  try {
    // An empty address must also replace any abandoned hint.
    clearAuthEmailHint();
    const trimmed = email.trim();
    if (trimmed) {
      window.sessionStorage.setItem(AUTH_EMAIL_HINT_KEY, trimmed);
      if (signUp) {
        window.sessionStorage.setItem(
          AUTH_EMAIL_HINT_SIGN_UP_KEY,
          String(signUp.codeSentAt ?? ""),
        );
      }
      if (signIn) {
        window.sessionStorage.setItem(
          AUTH_EMAIL_HINT_SIGN_IN_KEY,
          signIn.method === "password"
            ? signIn.method
            : String(signIn.codeSentAt ?? ""),
        );
      }
    }
  } catch {
    // Blocked storage / quota: navigation still works without a prefill.
  }
}

/** A plain click: the link opens in this tab, where the hint is read. */
export function isSameTabClick(event: ClickModifiers): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

/** Clear old hints even when a modified click navigates in another tab. */
export function rememberAuthEmailHintOnClick(
  event: ClickModifiers,
  email: string,
): void {
  rememberAuthEmailHint(isSameTabClick(event) ? email : "");
}

/** Reads the hint once; discarded hints cannot appear on a later visit. */
export function takeAuthEmailHint(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(AUTH_EMAIL_HINT_KEY);
    clearAuthEmailHint();
    return value?.trim() || null;
  } catch {
    return null;
  }
}

/** Takes the hint only when sign-in handed it to sign-up; a plain one stays. */
export function takeSignUpHandover():
  | (SignUpHandover & { email: string })
  | null {
  if (typeof window === "undefined") return null;
  try {
    const sentAt = window.sessionStorage.getItem(AUTH_EMAIL_HINT_SIGN_UP_KEY);
    if (sentAt === null) return null;
    const email = takeAuthEmailHint();
    if (!email) return null;
    return { email, codeSentAt: parseCodeSentAt(sentAt) };
  } catch {
    return null;
  }
}

/** Takes the hint only when sign-up handed it to sign-in; a plain one stays. */
export function takeSignInHandover():
  | (SignInHandover & { email: string })
  | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(AUTH_EMAIL_HINT_SIGN_IN_KEY);
    if (value === null) return null;
    const email = takeAuthEmailHint();
    if (!email) return null;
    return value === "password"
      ? { email, method: "password" }
      : { email, method: "code", codeSentAt: parseCodeSentAt(value) };
  } catch {
    return null;
  }
}
