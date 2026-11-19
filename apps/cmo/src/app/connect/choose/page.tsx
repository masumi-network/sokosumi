import { redirect } from "next/navigation";

import { AccountChoices } from "../../../components/account-choices";
import {
  chooseChannelAccount,
  finalizeChannel,
  waitingChannelSignIn,
} from "../../cmo-actions";

/** Back where the connection started: Channels in the app, or the Launch step. */
function returnAddress(
  project: string,
  from: string | null,
  failure?: string,
): string {
  const params = new URLSearchParams({ step: "connect" });
  if (from) params.set("from", from);
  if (failure) params.set("connect", failure);
  params.set("project", project);
  return `/?${params}`;
}

/**
 * The sign-in reaches several accounts (the person's LinkedIn Pages and their
 * own profile, or a login's Facebook Pages): the owner picks the one Cuso
 * posts as.
 */
export default async function ChooseChannelAccountPage() {
  const waiting = await waitingChannelSignIn();
  if (!waiting) redirect("/");
  const back = returnAddress(waiting.project, waiting.from);
  const failedBack = returnAddress(waiting.project, waiting.from, "failed");
  // Asking again without a pick lists the accounts and connects nothing.
  const listed = await finalizeChannel(waiting.project, waiting.signIn).catch(
    () => null,
  );
  if (listed?.state !== "choose") {
    redirect(listed?.state === "connected" ? back : failedBack);
  }
  async function choose(formData: FormData) {
    "use server";
    const id = formData.get("account");
    const result =
      typeof id === "string" ? await chooseChannelAccount(id) : null;
    redirect(result?.state === "connected" ? back : failedBack);
  }

  return <AccountChoices choices={listed.choices} choose={choose} />;
}
