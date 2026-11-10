import { INVITE_ONLY_NOTE, INVITE_ONLY_TITLE } from "../lib/invite-only";
import { Mascot } from "./mascot";
import { SubmitButton } from "./submit-button";

interface InviteOnlyProps {
  email: string;
  signOut: () => Promise<void>;
}

/**
 * In place of the hire form for a person Core's hire allowlist leaves out
 * and who has no Cuso yet: the waitlist site's hero, with sign out.
 */
export function InviteOnly({ email, signOut }: InviteOnlyProps) {
  return (
    <main className="hero">
      <div className="hero-copy">
        <h1>{INVITE_ONLY_TITLE}</h1>
        <p className="note">{INVITE_ONLY_NOTE}</p>
        <div className="account">
          <p className="note">Signed in as</p>
          <p className="account-name">{email}</p>
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
