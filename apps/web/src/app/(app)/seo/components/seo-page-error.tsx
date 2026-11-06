"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
  onRetry,
}: {
  resetHref: string;
  invalidFilters?: boolean;
  status?: number;
  owner?: SeoOwner;
  hasSelection?: boolean;
  onRetry?: () => void;
}) {
  const t = useTranslations("App.Seo");
  const router = useRouter();
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
