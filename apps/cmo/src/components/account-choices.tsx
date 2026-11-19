import type { SocialAccountChoice } from "@sokosumi/core-client";

import { AGENT_NAME } from "../lib/agent";
import { SubmitButton } from "./submit-button";

/**
 * A sign-in reaches several accounts (a person's LinkedIn Pages and their own
 * profile, or a login's Facebook Pages): the owner picks the one Cuso posts
 * as. Pages come first, the profile last.
 */
export function AccountChoices({
  choices,
  choose,
}: {
  choices: SocialAccountChoice[];
  /** Receives the picked account as the form's `account`. */
  choose: (formData: FormData) => Promise<void>;
}) {
  const ordered = [
    ...choices.filter((choice) => choice.kind === "page"),
    ...choices.filter((choice) => choice.kind === "profile"),
  ];
  return (
    <main className="ads-choose">
      <h1>Which account?</h1>
      <p className="muted">
        {AGENT_NAME} posts as the one you pick. You can change it later in
        Channels.
      </p>
      <ul className="list">
        {ordered.map((choice) => (
          <li key={choice.id} className="li">
            <span className="grow">
              <b>{choice.name}</b>
              <br />
              <span className="note">
                {choice.kind === "page"
                  ? "Company Page"
                  : "Your personal profile"}
              </span>
            </span>
            <form action={choose}>
              <input type="hidden" name="account" value={choice.id} />
              <SubmitButton className="button button-small">
                Use this one
              </SubmitButton>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
