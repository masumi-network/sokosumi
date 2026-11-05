"use client";

import { Check, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { SeoEmpty, SeoPageLink, SeoSection, SeoState } from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function SeoPages({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <SeoSection
        title={t("pages.title")}
        actions={
          model.data.availableActions.canEdit ? (
            <Button size="sm" onClick={() => model.setDialog("page")}>
              <Plus className="size-4" />
              {t("addPage")}
            </Button>
          ) : null
        }
      >
        {model.data.pages.length ? (
          <ul className="space-y-2">
            {model.data.pages.map((page) => (
              <li
                key={page.id}
                className={`${HOLDER_ITEM_CLASS} space-y-3 p-4`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <h3 className="text-sm font-medium break-words">
                      {page.label || page.url}
                    </h3>
                    <SeoPageLink url={page.url} />
                  </div>
                  <SeoState>{t(page.relationship)}</SeoState>
                </div>
                {page.relatedToPageId ? (
                  <p className="text-muted-foreground text-sm">
                    {t("relatedTo")}:{" "}
                    {model.data.pages.find(
                      (candidate) => candidate.id === page.relatedToPageId,
                    )?.label ?? t("page")}
                  </p>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void model.setFilters({ pageId: page.id, scopeId: null });
                  }}
                >
                  {model.filters.pageId === page.id ? (
                    <Check className="size-4" />
                  ) : null}
                  {t("pages.choose")}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <SeoEmpty title={t("noPages")} description={t("noPagesBody")} />
        )}
      </SeoSection>
      <SeoSection
        title={t("pages.groups")}
        actions={
          model.data.availableActions.canEdit && model.data.pages.length ? (
            <Button size="sm" onClick={() => model.setDialog("scope")}>
              <Plus className="size-4" />
              {t("createScope")}
            </Button>
          ) : null
        }
      >
        {model.data.scopes.length ? (
          <ul className="space-y-2">
            {model.data.scopes.map((scope) => (
              <li
                className={`${HOLDER_ITEM_CLASS} space-y-3 p-4`}
                key={scope.id}
              >
                <div>
                  <h3 className="text-sm font-medium">{scope.name}</h3>
                  <p className="text-muted-foreground text-sm">
                    {t("pages.count", { count: scope.pageIds.length })} ·{" "}
                    {t("pages.version", { version: scope.version })}
                  </p>
                </div>
                <ul className="space-y-1 text-sm">
                  {scope.pageIds.map((id) => {
                    const page = model.data.pages.find(
                      (candidate) => candidate.id === id,
                    );
                    return page ? (
                      <li key={id}>
                        <SeoPageLink url={page.url} label={page.label} />
                      </li>
                    ) : null;
                  })}
                </ul>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void model.setFilters({ scopeId: scope.id, pageId: null });
                  }}
                >
                  {model.filters.scopeId === scope.id ? (
                    <Check className="size-4" />
                  ) : null}
                  {t("pages.choose")}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <SeoEmpty description={t("pages.emptyGroups")} />
        )}
      </SeoSection>
    </div>
  );
}
