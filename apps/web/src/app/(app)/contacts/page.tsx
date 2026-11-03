import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { contactsSyncState } from "@/lib/soko-bot/connect-prompt";
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

export default async function ContactsPage() {
  await connection();
  return <ContactsWorkspace sync={await syncState()} />;
}
