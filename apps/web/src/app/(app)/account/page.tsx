import { getUserMetadata } from "@sokosumi/utils";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { toDesignMdProfileValue } from "@/lib/helpers/design-md-profile";
import { designMdService } from "@/lib/services/design-md.service";

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
  const userMetadata = getUserMetadata(session?.user.metadata);
  const designMdValue = toDesignMdProfileValue(
    userMetadata,
    designMdService.getDesignMdPreviewUrl,
  );

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl px-4">
        <AccountSettings
          accounts={accounts}
          designMdValue={designMdValue}
          notificationsOptIn={session?.user.notificationsOptIn ?? true}
          userLogo={session?.user.logo}
          userMetadata={session?.user.metadata}
          marketingOptIn={session?.user.marketingOptIn ?? false}
        />
      </div>
    </div>
  );
}
