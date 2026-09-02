import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { YouPageSkeleton } from "./components/you-loading-view";
import { YouPageContent } from "./components/you-page-content";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.You.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function YouPage() {
  await connection();

  return (
    <Suspense fallback={<YouPageSkeleton />}>
      <YouPageContent />
    </Suspense>
  );
}
