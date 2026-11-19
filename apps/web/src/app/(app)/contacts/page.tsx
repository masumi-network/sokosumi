import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { loadWorkspaceSwitchAccounts } from "@/app/components/user-avatar/workspace-switch-accounts";
import { WorkspaceSwitchDialog } from "@/app/components/user-avatar/workspace-switch-dialog";
import { getSession } from "@/lib/auth/auth.server";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { userService } from "@/lib/services/user.service";
import { contactsSyncState } from "@/lib/soko-bot/connect-prompt";
import { ContactLinkWorkspaceProvider } from "./components/contact-link-workspace";
import { ContactsWorkspace } from "./components/contacts-workspace";

// Workspace-scoped and authenticated: nothing here is shareable shell.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Contacts.Metadata");
  return { title: t("title"), description: t("description") };
}

/** Whether contacts can sync yet: they arrive only through a Soko Bot. */
async function syncState() {
  try {
    const bot = await sokoBotService.getMine();
    if (!bot) return contactsSyncState(null, []);
    const { configured, integrations } =
      await sokoBotService.listIntegrations();
    return configured ? contactsSyncState(bot, integrations) : null;
  } catch {
    return null;
  }
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{
    contact?: string | string[];
    workspace?: string | string[];
  }>;
}) {
  await connection();
  const [params, session, available] = await Promise.all([
    searchParams,
    getSession(),
    userService.getMyWorkspaces(),
  ]);
  if (!session || !available) return notFound();
  const activeOrganizationId = session.session.activeOrganizationId ?? null;
  if (params.contact && params.workspace !== undefined) {
    const target = available.workspaces.find(
      (workspace) => workspace.id === params.workspace,
    );
    if (!target || typeof params.contact !== "string") return notFound();
    if (target.organizationId !== activeOrganizationId) {
      const [accounts, t] = await Promise.all([
        loadWorkspaceSwitchAccounts(session, target.organizationId),
        getTranslations("App.Contacts.workspaceSwitch"),
      ]);
      return (
        <WorkspaceSwitchDialog
          {...accounts}
          title={t("title")}
          description={t("description", {
            account: accounts.targetAccountName,
          })}
          stayHref="/contacts"
          stayBack={false}
          errorContext="contact_workspace_switch_dialog"
        />
      );
    }
  }
  const active = available.workspaces.find(
    (workspace) => workspace.organizationId === activeOrganizationId,
  );
  if (!active) return notFound();
  return (
    <ContactLinkWorkspaceProvider workspaceId={active.id}>
      <ContactsWorkspace sync={await syncState()} />
    </ContactLinkWorkspaceProvider>
  );
}
