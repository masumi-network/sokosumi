import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Chat.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

/**
 * Chat UI is rendered by the layout so a single ChatInterface stays mounted
 * across /chat, /chat/[bucketSlug], and /chat/[bucketSlug]/conversation/[id].
 */
export default function ChatPage() {
  return null;
}
