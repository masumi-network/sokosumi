"use client";

import type { SeoAuditBrief } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { SeoBriefOutcomes } from "./seo-brief-outcomes";
import { SeoPageLink, seoSiteUrl } from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function SeoBriefSummary({
  model,
  edit,
  setupGoal,
  onShareChange,
}: {
  model: SeoWorkspaceModel;
  edit: () => void;
  setupGoal?: { pageId: string; revision: number } | null;
  onShareChange?: () => void;
}) {
  const t = useTranslations("App.Seo");
  const brief = model.brief?.data;
  const pageGoals = (brief?.pages ?? []).flatMap((goal) => {
    if (
      !model.data.scope.pageIds.includes(goal.pageId) ||
      (!goal.role && !goal.action)
    )
      return [];
    const page = model.data.pages.find((p) => p.id === goal.pageId);
    return page ? [{ page, goal }] : [];
  });
  return (
    <section className="space-y-1 border-t pt-3" aria-label={t("brief.title")}>
      <h3 className="text-sm font-medium">{t("brief.title")}</h3>
      {brief?.revision ? (
        <>
          {brief.objective && (
            <p className="text-sm">
              {t("brief.objective")}: {t(`brief.objectives.${brief.objective}`)}
            </p>
          )}
          {brief.outcome && (
            <p className="text-sm break-words">{brief.outcome}</p>
          )}
        </>
      ) : (
        <p className="text-muted-foreground text-sm">
          {model.brief?.error
            ? t("brief.readFailed")
            : brief
              ? t("brief.empty")
              : t("loading")}
        </p>
      )}
      {model.data.availableActions.canEdit && (
        <Button
          type="button"
          size="sm"
          variant="link"
          className="h-auto px-0"
          onClick={edit}
        >
          {brief?.revision ? t("brief.edit") : t("brief.add")}
        </Button>
      )}
      {!!pageGoals.length && brief && (
        <fieldset
          key={`${brief.revision}:${model.setupScopeKey}:${model.setupGoalPageId ?? ""}`}
          className="mt-3 space-y-2"
        >
          <legend className="text-sm font-medium">{t("brief.share")}</legend>
          <p id="seo-goal-share-help" className="text-muted-foreground text-sm">
            {t("brief.shareHelp")}
          </p>
          <input
            type="hidden"
            name="sharedBriefRevision"
            value={brief.revision}
          />
          {pageGoals.map(({ page, goal }) => (
            <div key={page.id} className="flex items-start gap-2">
              <Checkbox
                name="sharedGoalPage"
                value={page.id}
                id={`seo-goal-${page.id}`}
                defaultChecked={
                  setupGoal?.pageId === page.id &&
                  setupGoal.revision === brief.revision
                }
                onCheckedChange={onShareChange}
                aria-describedby="seo-goal-share-help"
              />
              <Label
                htmlFor={`seo-goal-${page.id}`}
                className="grid min-w-0 gap-1"
              >
                <span className="break-all">{page.url}</span>
                <span className="text-muted-foreground text-sm font-normal">
                  {[
                    goal.role && t(`brief.roles.${goal.role}`),
                    goal.action &&
                      t(`brief.actions.${goal.action.replaceAll(" ", "_")}`),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </Label>
            </div>
          ))}
        </fieldset>
      )}
    </section>
  );
}

export function SeoBriefPagePriority({
  model,
  pageId,
}: {
  model: SeoWorkspaceModel;
  pageId?: string;
}) {
  const t = useTranslations("App.Seo.brief");
  const brief = model.brief?.data;
  const priority = brief?.priorities?.find((item) =>
    pageId
      ? item.pageId === pageId
      : model.data.scope.pageIds.includes(item.pageId) &&
        (!model.filters?.pageId || model.filters.pageId === item.pageId),
  );
  const page = model.data.pages.find((item) => item.id === priority?.pageId);
  if (!priority || !page) return null;
  return (
    <section
      aria-label={t("priority")}
      className={cn("space-y-2 text-sm", !pageId && HOLDER_CLASS)}
    >
      <h3 className={cn("font-semibold", !pageId && "px-2 pt-1")}>
        {t("priority")}
      </h3>
      <div className={cn("space-y-2", !pageId && [HOLDER_ITEM_CLASS, "p-3"])}>
        {!pageId && (
          <SeoPageLink
            url={page.url}
            label={page.label}
            site={seoSiteUrl(model.data)}
          />
        )}
        <div className="space-y-1">
          <h4 className="font-medium">{t("nextStep")}</h4>
          <p className="break-words">{priority.nextStep}</p>
        </div>
        {!!priority.why.length && (
          <div className="space-y-1">
            <h4 className="text-muted-foreground font-medium">{t("why")}</h4>
            <ul className="text-muted-foreground list-disc space-y-1 ps-5">
              {priority.why.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        )}
        {pageId && brief && (brief.audience || brief.constraints) && (
          <dl className="space-y-2 border-t pt-2">
            {(["audience", "constraints"] as const).map((field) =>
              brief[field] ? (
                <div key={field}>
                  <dt className="text-muted-foreground font-medium">
                    {t(field)}
                  </dt>
                  <dd className="whitespace-pre-wrap break-words">
                    {brief[field]}
                  </dd>
                </div>
              ) : null,
            )}
          </dl>
        )}
      </div>
    </section>
  );
}

export function SeoBriefFollowUp({
  followUp,
}: {
  followUp: SeoAuditBrief["followUps"][number];
}) {
  const t = useTranslations("App.Seo.brief");
  const format = useFormatter();
  return (
    <section className="space-y-1.5 text-sm">
      <h3 className="font-medium">{t("followUp")}</h3>
      <p>{t(`followUps.${followUp.status}`)}</p>
      {followUp.changedAt && (
        <p className="text-muted-foreground">
          {t("recordedChange", {
            date: format.dateTime(new Date(followUp.changedAt), {
              dateStyle: "medium",
            }),
          })}
        </p>
      )}
      {followUp.lastCrawlAt && (
        <p className="text-muted-foreground">
          {t("lastCrawl", {
            date: format.dateTime(new Date(followUp.lastCrawlAt), {
              dateStyle: "medium",
            }),
          })}
        </p>
      )}
      {followUp.indexReview && followUp.indexReview !== "unknown" && (
        <p>{t(`indexReview.${followUp.indexReview}`)}</p>
      )}
      <SeoBriefOutcomes followUp={followUp} />
    </section>
  );
}
