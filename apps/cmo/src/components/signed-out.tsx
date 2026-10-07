import { CMO_SIGN_IN_ERROR } from "../lib/sign-in-errors";
import { Mascot } from "./mascot";
import { SubmitButton } from "./submit-button";

interface SignedOutProps {
  /** The `error` query Sokosumi or CMO sent back, if sign in did not finish. */
  error?: string;
  createAccount: () => Promise<void>;
  signIn: () => Promise<void>;
}

/** What the agent runs, from the style guide's launch scope. */
const SCOPE = [
  "Social media",
  "Content",
  "Google and Meta ads",
  "SEO",
  "Images and graphics",
];

/**
 * The sign-in state cookie is gone or replaced: over ten minutes, another
 * browser, Back, or a second Sign in (another tab, the link again), since
 * the browser keeps one state cookie.
 */
const STATE_EXPIRED =
  "That sign in expired or was started again somewhere else. Press Sign in again.";

const ERROR_MESSAGES = new Map([
  ["access_denied", "You did not allow CMO. Nothing was shared."],
  ["state_mismatch", STATE_EXPIRED],
  ["state_invalid", STATE_EXPIRED],
  ["state_not_found", STATE_EXPIRED],
  [
    CMO_SIGN_IN_ERROR.unavailable,
    "Sokosumi is not reachable right now. Try again in a minute.",
  ],
  [CMO_SIGN_IN_ERROR.signedOut, "You were signed out. Sign in again."],
]);

function errorMessage(error: string): string {
  return ERROR_MESSAGES.get(error) ?? "Sign in did not finish. Try again.";
}

export function SignedOut({ error, createAccount, signIn }: SignedOutProps) {
  return (
    <main className="hero">
      <div className="hero-copy">
        <p className="eyebrow">AI marketing agent</p>
        <h1>Put your marketing on autopilot.</h1>
        <p className="lead">
          CMO.XYZ runs your marketing end to end, in one system. Not a chatbot
          you prompt. Not a stack of separate tools.
        </p>
        <ul className="scope">
          {SCOPE.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        {error ? <p role="alert">{errorMessage(error)}</p> : null}
        {/* One form, so pressing either button disables both. */}
        <form className="actions">
          <SubmitButton className="button" formAction={createAccount}>
            Create account
          </SubmitButton>
          <SubmitButton className="button button-secondary" formAction={signIn}>
            Sign in
          </SubmitButton>
        </form>
        <p className="note">
          CMO uses your <a href="https://sokosumi.com">Sokosumi</a> account.
        </p>
      </div>
      <Mascot className="hero-mascot" />
    </main>
  );
}
