import { Mascot } from "./mascot";
import { SubmitButton } from "./submit-button";

/** The home page's `error` after a choice that did not create a workspace. */
export const WORKSPACE_FAILED_ERROR = "workspace_failed";

interface WorkspaceGateProps {
  /** The last choice did not create a workspace. */
  failed: boolean;
  createPersonalWorkspace: () => Promise<void>;
  signOut: () => Promise<void>;
}

/**
 * CMO's workspace gate (ADR 0051): a signed-in person with no workspace
 * chooses one before using CMO. Leaving is Sign out or a choice.
 */
export function WorkspaceGate({
  failed,
  createPersonalWorkspace,
  signOut,
}: WorkspaceGateProps) {
  return (
    <main className="hero">
      <div className="hero-copy">
        <h1>Where will you use CMO?</h1>
        {failed ? <p role="alert">That did not work. Try again.</p> : null}
        {/* One form, so pressing any button disables all of them. */}
        <form className="choices">
          <SubmitButton className="choice" formAction={createPersonalWorkspace}>
            <span className="choice-title">Just me</span>
            <span className="choice-detail">
              A personal workspace for you alone.
            </span>
          </SubmitButton>
          {/* Still focusable, so screen readers reach "Coming soon". */}
          <button className="choice" type="button" aria-disabled="true">
            <span className="choice-title">My organization</span>
            <span className="choice-detail">
              A shared workspace for your team. Coming soon.
            </span>
          </button>
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
