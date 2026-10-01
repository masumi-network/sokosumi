import { Mascot } from "./mascot";

interface SignedOutProps {
  /** The `error` query Sokosumi sent back, if sign in did not finish. */
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

function errorMessage(error: string): string {
  if (error === "access_denied") {
    return "You did not allow CMO. Nothing was shared.";
  }
  // The sign-in state is gone: over ten minutes, another browser, or Back.
  if (error === "state_mismatch") {
    return "That sign in took too long. Press Sign in again.";
  }
  return "Sign in did not finish. Try again.";
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
        <div className="actions">
          <form action={createAccount}>
            <button className="button" type="submit">
              Create account
            </button>
          </form>
          <form action={signIn}>
            <button className="button button-secondary" type="submit">
              Sign in
            </button>
          </form>
        </div>
        <p className="note">CMO uses your Sokosumi account.</p>
      </div>
      <Mascot className="hero-mascot" />
    </main>
  );
}
