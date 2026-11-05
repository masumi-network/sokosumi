"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import {
  SeoEmpty,
  SeoPageLink,
  SeoSection,
  SeoSource,
  SeoState,
} from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

const SEO_OVERVIEW_ACTION_LIMIT = 3;

export function SeoActions({
  model,
  compact = false,
}: {
  model: SeoWorkspaceModel;
  compact?: boolean;
}) {
  const t = useTranslations("App.Seo");
  const actions = compact
    ? model.data.actions
        .filter((action) => action.status === "recommended")
        .slice(0, SEO_OVERVIEW_ACTION_LIMIT)
    : model.data.actions;
  return (
    <SeoSection title={t(compact ? "overview.priority" : "actions.title")}>
      <p className="text-muted-foreground px-2 pb-2 text-sm">
        {t("actions.help")}
      </p>
      {actions.length ? (
        <div className={compact ? "grid gap-2 xl:grid-cols-3" : "space-y-2"}>
          {actions.map((action) => (
            <article
              key={`${action.observationId}:${action.id}`}
              className={cn(HOLDER_ITEM_CLASS, "min-w-0 space-y-4 p-4")}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="text-sm font-semibold">{action.title}</h3>
                <SeoState>{t(`actions.${action.status}`)}</SeoState>
              </div>
              <SeoPageLink url={action.pageUrl} />
              <p className="text-muted-foreground text-sm whitespace-pre-wrap break-words">
                {action.why}
              </p>
              <dl className="text-sm">
                <dt className="font-medium">{t("actions.effect")}</dt>
                <dd className="text-muted-foreground mt-1 whitespace-pre-wrap break-words">
                  {action.expectedEffect}
                </dd>
              </dl>
              <p className="text-muted-foreground text-xs">
                {t("actions.effort")}: {t(`priority.${action.effort}`)}
              </p>
              {action.edit ? (
                <details className="text-sm">
                  <summary className="cursor-pointer font-medium">
                    {t("actions.after")}
                  </summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-muted-foreground mb-1 text-xs">
                        {t("actions.before")}
                      </p>
                      <pre className="bg-quinary overflow-x-auto rounded-md p-3 text-xs whitespace-pre-wrap break-words">
                        {action.edit.before ?? t("actions.noBefore")}
                      </pre>
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-1 text-xs">
                        {t("actions.after")}
                      </p>
                      <pre className="bg-quinary overflow-x-auto rounded-md p-3 text-xs whitespace-pre-wrap break-words">
                        {action.edit.after}
                      </pre>
                    </div>
                  </div>
                </details>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SeoSource
                  observationId={action.observationId}
                  workspace={model.data}
                />
                {action.taskId ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/tasks/${encodeURIComponent(action.taskId)}`}>
                      {t("openTask")}
                    </Link>
                  </Button>
                ) : model.data.availableActions.canEdit ? (
                  <Button
                    size="sm"
                    variant="outline"
                    loading={model.pending}
                    onClick={() => {
                      void model.createActionTask(action);
                    }}
                  >
                    {t("actions.createTask")}
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <SeoEmpty title={t("actions.empty")} body={t("actions.emptyBody")} />
      )}
    </SeoSection>
  );
}
