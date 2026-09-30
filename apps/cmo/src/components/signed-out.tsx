interface SignedOutProps {
  /** The `error` query Sokosumi sent back, if sign in did not finish. */
  error?: string;
  createAccount: () => Promise<void>;
  signIn: () => Promise<void>;
}

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
    <main>
      <h1>CMO.XYZ</h1>
      <p>
        An AI agent that runs your marketing end to end. Social, content, ads,
        SEO and graphics in one system.
      </p>
      {error ? <p role="alert">{errorMessage(error)}</p> : null}
      <div className="actions">
        <form action={createAccount}>
          <button type="submit">Create account</button>
        </form>
        <form action={signIn}>
          <button type="submit">Sign in</button>
        </form>
      </div>
      <p className="note">CMO uses your Sokosumi account.</p>
    </main>
  );
}
