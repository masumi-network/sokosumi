import { redirect } from "next/navigation";

import { SubmitButton } from "../../../components/submit-button";
import { chooseAdAccount, loadAdChoices } from "../../cmo-actions";

interface ChoosePageProps {
  searchParams: Promise<{ connection?: string; from?: string }>;
}

/** The login reaches several ad accounts: the founder picks the one for Cuso's ads. */
export default async function ChooseAdAccountPage({
  searchParams,
}: ChoosePageProps) {
  const { connection, from } = await searchParams;
  const back = from === "app" ? "/channels" : "/?step=connect";
  if (!connection) redirect(back);
  const accounts = await loadAdChoices(connection).catch(() => []);
  if (accounts.length === 0) redirect(back);

  async function choose(formData: FormData) {
    "use server";
    const id = formData.get("account");
    const chosen =
      typeof id === "string" && connection
        ? await chooseAdAccount(connection, id)
        : false;
    redirect(
      chosen ? back : `${back}${back.includes("?") ? "&" : "?"}ads=failed`,
    );
  }

  return (
    <main className="ads-choose">
      <h1>Which ad account?</h1>
      <p className="muted">
        Cuso's ads run in the one you pick. You can add another later.
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
