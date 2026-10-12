import { Mascot } from "./mascot";
import { SubmitButton } from "./submit-button";

interface PendingInvitationsProps {
  /** Pending organization invitations, at least one. */
  count: number;
  /** Sokosumi's workspace gate, which lists them. */
  sokosumiSetupUrl: string;
  /** The account to use there, which may differ from Sokosumi's session. */
  email: string;
  signOut: () => Promise<void>;
}

/**
 * The workspace gate for a person with no workspace and pending invitations
 * (ADR 0051): they join on Sokosumi, since CMO cannot accept invitations yet.
 * Like Sokosumi's own gate, it offers no workspace of their own instead.
 */
export function PendingInvitations({
  count,
  sokosumiSetupUrl,
  email,
  signOut,
}: PendingInvitationsProps) {
  const one = count === 1;

  return (
    <main className="hero">
      <div className="hero-copy">
        <h1>
          {one ? "You have an invitation." : `You have ${count} invitations.`}
        </h1>
        <p className="lead">
          Accept {one ? "it" : "one"} on Sokosumi to use CMO with your team, or
          decline {one ? "it" : "them"}. Then come back here.
        </p>
        <form className="actions">
          {/* A new tab keeps CMO open for Check again. */}
          <a
            className="button"
            href={sokosumiSetupUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-describedby="pending-invitations-new-tab"
          >
            Open Sokosumi
          </a>
          <a className="button button-secondary" href="/">
            Check again
          </a>
          <SubmitButton
            className="button button-secondary"
            formAction={signOut}
          >
            Sign out
          </SubmitButton>
        </form>
        <p id="pending-invitations-new-tab" className="note">
          Sokosumi opens in a new tab. Use your account {email} there.
        </p>
      </div>
      <Mascot className="hero-mascot" />
    </main>
  );
}
