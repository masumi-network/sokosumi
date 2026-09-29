interface SignedInProps {
  name: string;
  email: string;
  signOut: () => Promise<void>;
}

export function SignedIn({ name, email, signOut }: SignedInProps) {
  return (
    <main>
      <h1>CMO.XYZ</h1>
      <p>Signed in as {name}</p>
      <p className="note">{email}</p>
      <form action={signOut}>
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
