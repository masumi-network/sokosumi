import { headers } from "next/headers";

import { auth } from "@/lib/auth/auth";

import { AccountSettings } from "./components/account-settings";

export default async function Page() {
  const accounts = await auth.api.listUserAccounts({
    headers: await headers(),
  });

  return (
    <div className="flex items-center justify-center gap-16 md:p-8">
      <AccountSettings accounts={accounts} />
    </div>
  );
}
