"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import {
  CalendarClock,
  Download,
  MessageSquare,
  MoreHorizontal,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
  Settings2,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  seoLoadErrorStatus,
  seoLoadRecovery,
} from "@/app/seo/seo-load-error-model";
import { SEO_TABS, type SeoTab } from "@/app/seo/seo-query";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SeoActions } from "./seo-actions";
import { SeoAnalysisDialog } from "./seo-analysis-dialog";
import { SeoChatPanel } from "./seo-chat-panel";
import { SeoCompetitors } from "./seo-competitors";
import { SeoEditDialog } from "./seo-edit-dialog";
import { SeoImportDialog } from "./seo-import-dialog";
import { SeoKeywords } from "./seo-keywords";
import { SeoOverview } from "./seo-overview";
import { SeoPageChangeDialog } from "./seo-page-change-dialog";
import { SeoPageError } from "./seo-page-error";
import { SeoPages } from "./seo-pages";
import { SeoScopeBar } from "./seo-scope-bar";
import { SeoEmpty } from "./seo-shared";
import { SeoStatisticsDialog } from "./seo-statistics-dialog";
import { useSeoWorkspace } from "./use-seo-workspace";

export function SeoWorkspace({
  workspace,
}: {
  workspace: ProjectSeoWorkspace;
}) {
  const t = useTranslations("App.Seo");
  const model = useSeoWorkspace(workspace);
  const dialogKey = `${model.viewerKey}:${model.dialog}:${model.filters.pageId ?? ""}:${model.filters.scopeId ?? ""}:${model.editingKeyword?.id ?? ""}`;
  const editDialog =
    model.dialog === "page" ||
    model.dialog === "scope" ||
    model.dialog === "edit_scope" ||
    model.dialog === "keyword" ||
    model.dialog === "edit_keyword" ||
    model.dialog === "competitor";
  const unavailable = model.loadingScope || model.invalidDates;
  const loadStatus = seoLoadErrorStatus(model.result.error);
  if (
    model.result.isError &&
    (model.loadingScope || seoLoadRecovery({ status: loadStatus }).contextual)
  )
    return (
      <SeoPageError
        resetHref="/seo"
        status={loadStatus}
        owner={model.owner}
        hasSelection={Boolean(model.filters.pageId || model.filters.scopeId)}
        onRetry={() => {
          void model.result.refetch();
        }}
      />
    );
  if (model.waitingForContext)
    return (
      <p
        role="status"
        className="py-8 text-center text-muted-foreground text-sm"
      >
        {t("loading")}
      </p>
    );
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href="/seo"
          className="text-muted-foreground text-sm underline underline-offset-4"
        >
          {t("audits.all")}
        </Link>
        {model.data.auditName ? (
          <h2 className="text-xl font-semibold">{model.data.auditName}</h2>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {t("pages.count", { count: model.data.scope.pageIds.length })}
        </p>
        <div className="flex flex-wrap gap-2">
          {model.data.auditId ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void model.openChat();
              }}
            >
              <MessageSquare className="size-4" />
              {t("chat.title")}
            </Button>
          ) : null}
          {model.data.availableActions.canEdit &&
          (model.data.observations.length > 0 ||
            model.filters.tab !== "overview") ? (
            <Button
              variant="outline"
              size="sm"
              disabled={unavailable}
              onClick={() => model.setDialog("import")}
            >
              <Download className="size-4" />
              {t("importAudit")}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            aria-label={t("refresh")}
            title={t("refresh")}
            disabled={model.result.isFetching || model.invalidDates}
            onClick={() => {
              void model.result.refetch();
            }}
          >
            <RefreshCw className="size-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <MoreHorizontal className="size-4" />
                {t("manage")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {model.data.availableActions.canEdit ? (
                <>
                  <DropdownMenuItem
                    disabled={unavailable}
                    onSelect={() => model.setDialog("page")}
                  >
                    <Plus className="size-4" />
                    {t("addPage")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={unavailable || !model.data.pages.length}
                    onSelect={() => model.setDialog("scope")}
                  >
                    <Settings2 className="size-4" />
                    {t("createScope")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={unavailable || !model.data.scope.pageIds.length}
                    onSelect={() => model.setDialog("page_change")}
                  >
                    <PencilLine className="size-4" />
                    {t("pageChange.title")}
                  </DropdownMenuItem>
                </>
              ) : null}
              {model.data.availableActions.canCreateMonitor === true ? (
                <DropdownMenuItem
                  disabled={unavailable || !model.data.scope.pageIds.length}
                  onSelect={() => model.setDialog("monitor")}
                >
                  <CalendarClock className="size-4" />
                  {t("monitor.create")}
                </DropdownMenuItem>
              ) : null}
              {model.data.auditId ? (
                <DropdownMenuItem onSelect={model.openChat}>
                  <MessageSquare className="size-4" />
                  {t("chat.title")}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          {model.data.availableActions.canRequestAnalysis &&
          (model.data.observations.length > 0 ||
            model.filters.tab !== "overview") ? (
            <Button
              size="sm"
              disabled={unavailable || !model.data.scope.pageIds.length}
              onClick={() => model.setDialog("analysis")}
            >
              <Play className="size-4" />
              {t("runAnalysis")}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="space-y-3">
        <SeoScopeBar model={model} />
        {model.data.scope.id && model.data.availableActions.canEdit ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={unavailable}
            onClick={() => model.setDialog("edit_scope")}
          >
            <Settings2 className="size-4" />
            {t("editScope")}
          </Button>
        ) : null}
      </div>
      {!unavailable && model.data.history.limited ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("historyLimited", { limit: model.data.history.limit })}
        </p>
      ) : null}
      {!unavailable &&
      model.data.availableActions.canEdit &&
      model.data.scope.pageIds.length > 0 &&
      !model.data.availableActions.canRequestAnalysis ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("dispatchPaused")}
        </p>
      ) : null}
      {!model.data.availableActions.canEdit ? (
        <p className="text-muted-foreground text-sm">{t("readOnly")}</p>
      ) : null}
      {model.result.isError ? (
        <div role="alert" className="space-y-2">
          <p className="text-sm">{t("refreshFailed")}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void model.result.refetch();
            }}
          >
            {t("retry")}
          </Button>
        </div>
      ) : null}
      <Tabs
        value={model.filters.tab}
        onValueChange={(tab) => {
          void model.setFilters({ tab: tab as SeoTab });
        }}
        className="gap-4"
      >
        <div className="overflow-x-auto">
          <TabsList>
            {SEO_TABS.map((tab) => (
              <TabsTrigger key={tab} value={tab}>
                {t(`tabs.${tab}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {unavailable ? (
          model.result.isError ? (
            <SeoEmpty title={t("errorTitle")} body={t("errorBody")} />
          ) : (
            <p
              role="status"
              className="text-muted-foreground py-8 text-center text-sm"
            >
              {model.invalidDates ? t("invalidDates") : t("loading")}
            </p>
          )
        ) : (
          <>
            <TabsContent value="overview">
              <SeoOverview model={model} />
            </TabsContent>
            <TabsContent value="keywords">
              <SeoKeywords model={model} />
            </TabsContent>
            <TabsContent value="competitors">
              <SeoCompetitors model={model} />
            </TabsContent>
            <TabsContent value="pages">
              <SeoPages model={model} />
            </TabsContent>
            <TabsContent value="actions">
              <SeoActions model={model} />
            </TabsContent>
          </>
        )}
      </Tabs>
      {model.data.auditId ? <SeoChatPanel model={model} /> : null}
      {!unavailable ? (
        <>
          {editDialog ? <SeoEditDialog key={dialogKey} model={model} /> : null}
          {model.dialog === "analysis" || model.dialog === "monitor" ? (
            <SeoAnalysisDialog
              key={dialogKey}
              model={model}
              monitor={model.dialog === "monitor"}
            />
          ) : null}
          {model.dialog === "import" ? (
            <SeoImportDialog key={dialogKey} model={model} />
          ) : null}
          {model.dialog === "page_change" ? (
            <SeoPageChangeDialog key={dialogKey} model={model} />
          ) : null}
          {model.dialog === "statistics" ? (
            <SeoStatisticsDialog key={dialogKey} model={model} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
