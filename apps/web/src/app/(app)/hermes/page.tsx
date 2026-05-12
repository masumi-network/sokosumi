import gravatarUrl from "gravatar-url";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import HermesExperience from "@/app/hermes/components/hermes-experience";
import { getSession } from "@/lib/auth/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Hermes.Metadata");
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function HermesPage() {
  const session = await getSession();
  const userName = session?.user.name ?? null;
  const userImageUrl = session?.user.image
    ? session.user.image
    : session?.user.email
      ? gravatarUrl(session.user.email, { size: 80, default: "404" })
      : null;

  return (
    <Suspense fallback={null}>
      <HermesExperience userName={userName} userImageUrl={userImageUrl} />
    </Suspense>
  );
}
