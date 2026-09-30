interface SignedOutProps {
  /** The `error` query Sokosumi sent back, if sign in did not finish. */
  error?: string;
  createAccount: () => Promise<void>;
  signIn: () => Promise<void>;
}

function errorMessage(error: string): string {
  return error === "access_denied"
    ? "You did not allow CMO. Nothing was shared."
    : "Sign in did not finish. Try again.";
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
