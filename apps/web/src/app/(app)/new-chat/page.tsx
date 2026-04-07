import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Chat.Metadata");

  return {
    title: `${t("title")} (experimental)`,
    description: t("description"),
  };
}

/**
 * Chat UI is rendered by the layout so a single ChatInterface stays mounted
 * across /new-chat, /new-chat/[bucketSlug], and conversation routes.
 */
export default function NewChatPage() {
  return null;
}
