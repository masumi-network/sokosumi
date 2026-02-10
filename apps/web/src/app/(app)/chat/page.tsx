import gravatarUrl from "gravatar-url";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import DefaultErrorBoundary from "@/components/default-error-boundary";
import { getSession } from "@/lib/auth/utils";

import { ChatErrorFallback } from "./components/chat-error-fallback";
import ChatInterface from "./components/chat-interface";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Chat.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function ChatPage() {
  const session = await getSession();

  if (!session) {
    return null;
  }

  const userImageUrl =
    session.user.image ??
    gravatarUrl(session.user.email, {
      size: 80,
      default: "404",
    });

  return (
    <div className="flex h-full w-full flex-1 flex-col px-2">
      <DefaultErrorBoundary fallback={<ChatErrorFallback />}>
        <ChatInterface
          userImageUrl={userImageUrl}
          userName={session.user.name ?? undefined}
        />
      </DefaultErrorBoundary>
    </div>
  );
}
