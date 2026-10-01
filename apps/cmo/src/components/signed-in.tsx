interface SignedInProps {
  name: string;
  email: string;
  signOut: () => Promise<void>;
}

export function SignedIn({ name, email, signOut }: SignedInProps) {
  const hasName = name.trim().length > 0;

  return (
    <main>
      <h1>CMO.XYZ</h1>
      {/* A Magic Link sign-up leaves the Sokosumi account without a name. */}
      <p>Signed in as {hasName ? name : email}</p>
      {hasName && <p className="note">{email}</p>}
      <form action={signOut}>
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
