export default function SignedOutPage() {
  return (
    <main>
      <h1>CMO.XYZ</h1>
      <p>
        An AI agent that runs your marketing end to end. Social, content, ads,
        SEO and graphics in one system.
      </p>
      {/* Inert until Sign in with Sokosumi lands (SOK-1226). */}
      <button type="button" disabled>
        Sign in with Sokosumi
      </button>
      <p className="note">Sign in opens soon.</p>
    </main>
  );
}
