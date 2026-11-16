import { INVITE_ONLY_NOTE, INVITE_ONLY_TITLE } from "../lib/invite-only";
import { Mascot } from "./mascot";
import { SubmitButton } from "./submit-button";

interface SignedInProps {
  name: string;
  email: string;
  signOut: () => Promise<void>;
  /** The invite-only page: the hire form for a person Core's hire allowlist leaves out. */
  inviteOnly?: boolean;
}

export function SignedIn({ name, email, signOut, inviteOnly }: SignedInProps) {
  const hasName = name.trim().length > 0;

  return (
    <main className="hero">
      <div className="hero-copy">
        <h1>{inviteOnly ? INVITE_ONLY_TITLE : "You are in."}</h1>
        {inviteOnly && <p className="note">{INVITE_ONLY_NOTE}</p>}
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
