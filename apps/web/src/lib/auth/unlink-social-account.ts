import type { Account } from "@sokosumi/utils";

export function unlinkSocialAccountInput(account: Pick<Account, "id">) {
  return { accountId: account.id };
}
