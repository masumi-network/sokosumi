import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import gravatarUrl from "gravatar-url";

import { getSession } from "@/lib/auth/utils";

import ChatInterface from "./components/chat-interface";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Coworkers.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function CoworkersPage() {
  const t = await getTranslations("App.Coworkers");
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
    <div className="w-full space-y-12 px-2">
      <div className="space-y-2">
        <h1 className="text-2xl font-light md:text-3xl">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>
      <ChatInterface userImageUrl={userImageUrl} userName={session.user.name ?? undefined} />
    </div>
  );
}
