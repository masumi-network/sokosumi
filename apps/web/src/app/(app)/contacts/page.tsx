import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { ContactsWorkspace } from "./components/contacts-workspace";

// Workspace-scoped and authenticated: nothing here is shareable shell.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Contacts.Metadata");
  return { title: t("title"), description: t("description") };
}

/** Which mail and calendar connections the empty state can offer. */
async function connectOffers() {
  try {
    return (await sokoBotService.getConnectPromptState())?.offers ?? null;
  } catch {
    return null;
  }
}

export default async function ContactsPage() {
  await connection();
  return <ContactsWorkspace connectOffers={await connectOffers()} />;
}
