"use client";

import { RotateCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { seoLoadRecovery } from "@/app/seo/seo-load-error-model";
import { Button } from "@/components/ui/button";
import type { SeoOwner } from "@/lib/seo/owner";
import { SeoEmpty } from "./seo-shared";

export function SeoPageError({
  resetHref,
  invalidFilters = false,
  status,
  owner,
  hasSelection = false,
  askPage = false,
  onRetry,
}: {
  resetHref: string;
  invalidFilters?: boolean;
  status?: number;
  owner?: SeoOwner;
  hasSelection?: boolean;
  /** Load the page again: only the page can find the Audit's workspace and ask to switch. */
  askPage?: boolean;
  onRetry?: () => void;
}) {
  const t = useTranslations("App.Seo");
  const router = useRouter();
  useEffect(() => {
    if (askPage) router.refresh();
  }, [askPage, router]);
  const model = seoLoadRecovery({
    status,
    invalidFilters,
    owner,
    hasSelection,
  });
  return (
    <div role="alert">
      <SeoEmpty title={t(model.titleKey)} body={t(model.bodyKey)}>
        <div className="flex flex-wrap justify-center gap-2">
          {model.canRetry ? (
            <Button
              variant="outline"
              onClick={onRetry ?? (() => router.refresh())}
            >
              <RotateCw />
              {t("retry")}
            </Button>
          ) : null}
          {model.allPagesHref ? (
            <Button variant="outline" asChild>
              <Link href={model.allPagesHref}>{t("openAllPages")}</Link>
            </Button>
          ) : null}
          <Button asChild>
            <Link href={resetHref}>
              {t(invalidFilters ? "resetFilters" : "audits.all")}
            </Link>
          </Button>
        </div>
      </SeoEmpty>
    </div>
  );
}
