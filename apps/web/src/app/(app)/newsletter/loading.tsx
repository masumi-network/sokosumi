import { getTranslations } from "next-intl/server";

import { Skeleton } from "@/components/ui/skeleton";

export default async function NewsletterLoading() {
  const t = await getTranslations("App.Newsletter");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 py-6" aria-busy="true">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </header>
      <div className="space-y-2" aria-hidden>
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    </div>
  );
}
