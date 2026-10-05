import { Mascot } from "./mascot";
import { SubmitButton } from "./submit-button";

interface SignedInProps {
  name: string;
  email: string;
  signOut: () => Promise<void>;
}

export function SignedIn({ name, email, signOut }: SignedInProps) {
  const hasName = name.trim().length > 0;

  return (
    <main className="hero">
      <div className="hero-copy">
        <h1>You are in.</h1>
        <div className="account">
          <p className="note">Signed in as</p>
          {/* An email-code sign-up from Sokosumi's sign-in page has no name. */}
          <p className="account-name">{hasName ? name : email}</p>
          {hasName && <p className="note">{email}</p>}
        </div>
        <form>
          <SubmitButton
            className="button button-secondary"
            formAction={signOut}
          >
            Sign out
          </SubmitButton>
        </form>
      </div>
      <Mascot className="hero-mascot" />
    </main>
  );
}
