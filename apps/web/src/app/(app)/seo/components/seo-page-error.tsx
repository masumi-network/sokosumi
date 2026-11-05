"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { SeoEmpty } from "./seo-shared";

export function SeoPageError({
  resetHref,
  invalidFilters = false,
}: {
  resetHref: string;
  invalidFilters?: boolean;
}) {
  const t = useTranslations("App.Seo");
  const router = useRouter();
  return (
    <SeoEmpty
      title={t("errorTitle")}
      body={t(invalidFilters ? "invalidFilters" : "errorBody")}
    >
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="outline" onClick={() => router.refresh()}>
          {t("retry")}
        </Button>
        <Button asChild>
          <Link href={resetHref}>
            {t(invalidFilters ? "resetFilters" : "audits.all")}
          </Link>
        </Button>
      </div>
    </SeoEmpty>
  );
}
