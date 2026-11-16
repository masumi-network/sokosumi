import "server-only";

import { getTranslations } from "next-intl/server";
import type { getSession } from "@/lib/auth/auth.server";
import { userService } from "@/lib/services/user.service";
import {
  resolveAccountName,
  resolveOrganization,
} from "@/lib/utils/account-name";
import type { WorkspaceSwitchAccounts } from "./workspace-switch-dialog";

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

/** Names and logos for a switch prompt: the active workspace of the session, and the one to switch to. */
export async function loadWorkspaceSwitchAccounts(
  session: Session,
  targetOrganizationId: string | null,
): Promise<WorkspaceSwitchAccounts> {
  const activeOrganizationId = session.session.activeOrganizationId ?? null;
  const [members, tDetail, tOrganizationSwitcher] = await Promise.all([
    userService.getMyMembersWithOrganizations(),
    getTranslations("App.Tasks.Detail"),
    getTranslations("Components.OrganizationSwitcher"),
  ]);
  const personalAccount = tOrganizationSwitcher("personalAccount");
  const targetAccountName = resolveAccountName(
    targetOrganizationId,
    members,
    personalAccount,
  );
  return {
    currentAccountName: resolveAccountName(
      activeOrganizationId,
      members,
      personalAccount,
    ),
    currentOrganization: resolveOrganization(activeOrganizationId, members),
    sessionUser: session.user,
    targetOrganization: resolveOrganization(targetOrganizationId, members),
    targetOrganizationId,
    targetAccountName,
    // The text names an account, not a task, so the SEO prompt uses it too.
    successMessage: tDetail("switchedWorkspace", {
      account: targetAccountName,
    }),
  };
}
