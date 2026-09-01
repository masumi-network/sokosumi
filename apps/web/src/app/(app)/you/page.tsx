import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import DefaultLoading from "@/components/default-loading";

import { YouPageContent } from "./components/you-page-content";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.You.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

function YouPageFallback() {
  return (
    <div className="flex min-h-full items-center justify-center p-8">
      <DefaultLoading />
    </div>
  );
}

export default async function YouPage() {
  await connection();

  return (
    <Suspense fallback={<YouPageFallback />}>
      <YouPageContent />
    </Suspense>
  );
}
