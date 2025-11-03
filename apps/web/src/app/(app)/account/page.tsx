import { headers } from "next/headers";

import { auth } from "@/lib/auth/auth";

import { AccountSettings } from "./components/account-settings";

export default async function Page() {
  const requestHeaders = await headers();
  const [accounts, session] = await Promise.all([
    auth.api.listUserAccounts({
      headers: requestHeaders,
    }),
    auth.api.getSession({
      headers: requestHeaders,
    }),
  ]);

  return (
    <div>
      <AccountSettings
        accounts={accounts}
        jobStatusNotificationsOptIn={
          session?.user.jobStatusNotificationsOptIn ?? true
        }
        marketingOptIn={session?.user.marketingOptIn ?? false}
      />
    </div>
  );
}
