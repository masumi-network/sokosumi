import { redirect } from "next/navigation";

import { SubmitButton } from "../../../components/submit-button";
import { AGENT_NAME } from "../../../lib/agent";
import { connectDonePath } from "../../../lib/connect-window";
import { chooseAdAccount, loadAdChoices } from "../../cmo-actions";

interface ChoosePageProps {
  searchParams: Promise<{
    connection?: string;
    from?: string;
    /** The Project the ad connection started from. */
    project?: string;
  }>;
}

/** The login reaches several ad accounts: the founder picks the one for Cuso's ads. */
export default async function ChooseAdAccountPage({
  searchParams,
}: ChoosePageProps) {
  const { connection, from, project } = await searchParams;
  const popup = from === "popup";
  const inApp = from === "app";
  const params = new URLSearchParams(
    inApp ? {} : { step: "connect", from: "onboarding" },
  );
  if (project) params.set("project", project);
  const back = (inApp ? "/channels" : "/") + (params.size ? `?${params}` : "");
  // Launch's popup ends on the page that tells Launch, which polls.
  const failed = popup
    ? connectDonePath("failed")
    : `${back}${back.includes("?") ? "&" : "?"}ads=failed`;
  const done = popup ? connectDonePath("connected") : back;
  if (!connection || !project) redirect(popup ? failed : back);
  const accounts = await loadAdChoices(project, connection).catch(() => []);
  if (accounts.length === 0) redirect(popup ? failed : back);

  async function choose(formData: FormData) {
    "use server";
    const id = formData.get("account");
    const chosen =
      typeof id === "string" && connection && project
        ? await chooseAdAccount(project, connection, id)
        : false;
    redirect(chosen ? done : failed);
  }

  return (
    <main className="ads-choose">
      <h1>Which ad account?</h1>
      <p className="muted">
        {AGENT_NAME}'s ads run in the one you pick. You can add another later.
      </p>
      <ul className="list">
        {accounts.map((account) => (
          <li key={account.externalAccountId} className="li">
            <span className="grow">
              <b>{account.name}</b>
              <br />
              <span className="note num">
                {account.externalAccountId} · {account.currency}
              </span>
            </span>
            <form action={choose}>
              <input
                type="hidden"
                name="account"
                value={account.externalAccountId}
              />
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
