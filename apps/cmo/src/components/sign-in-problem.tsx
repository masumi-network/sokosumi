import { CMO_SIGN_IN_ERROR } from "../lib/sign-in-errors";
import { Mascot } from "./mascot";
import { SubmitButton } from "./submit-button";

interface SignInProblemProps {
  /** The `error` query Sokosumi or CMO sent back when sign in did not finish. */
  error: string;
  signIn: () => Promise<void>;
  /** The website typed before sign in, kept for the retry. */
  website?: string | undefined;
}

/**
 * The sign-in state cookie is gone or replaced: over ten minutes, another
 * browser, Back, or a second Sign in (another tab, the link again), since
 * the browser keeps one state cookie.
 */
const STATE_EXPIRED =
  "That sign in expired or was started again somewhere else. Try again.";

const ERROR_MESSAGES = new Map([
  ["access_denied", "You did not allow CMO. Nothing was shared."],
  ["state_mismatch", STATE_EXPIRED],
  ["state_invalid", STATE_EXPIRED],
  ["state_not_found", STATE_EXPIRED],
  [
    CMO_SIGN_IN_ERROR.unavailable,
    "Sokosumi is not reachable right now. Try again in a minute.",
  ],
  [
    CMO_SIGN_IN_ERROR.signedOut,
    "Your session ended. Sign in to pick up where you left off.",
  ],
]);

function errorMessage(error: string): string {
  return ERROR_MESSAGES.get(error) ?? "Sign in did not finish. Try again.";
}

/** Why sign in stopped, and one way back in. */
export function SignInProblem({ error, signIn, website }: SignInProblemProps) {
  // An ended session is not a failed sign in: it only asks to sign in again.
  const signedOut = error === CMO_SIGN_IN_ERROR.signedOut;
  return (
    <main className="hero">
      <div className="hero-copy">
        <h1>
          {signedOut ? "You were signed out." : "Sign in did not finish."}
        </h1>
        <p role="alert">{errorMessage(error)}</p>
        {website ? (
          <p className="muted">I kept {website}. You won't type it again.</p>
        ) : null}
        <form className="actions">
          <SubmitButton className="button" formAction={signIn}>
            {signedOut ? "Sign in" : "Try again"}
          </SubmitButton>
        </form>
      </div>
      <Mascot className="hero-mascot" />
    </main>
  );
}
