"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import {
  BarChart3,
  CalendarClock,
  ChevronDown,
  Download,
  MessageSquare,
  MoreHorizontal,
  PencilLine,
  Play,
  Plus,
  Settings2,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
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
import {
  SEGMENTED_TAB_TRIGGER_CLASS_NAME,
  SEGMENTED_TABS_LIST_CLASS_NAME,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
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
  // Phones show the agent first; pages and filters open on demand (always open from md up).
  const [filtersOpen, setFiltersOpen] = useState(
    Boolean(model.filters.from || model.filters.to),
  );
  // The tab bar scrolls sideways on a phone; keep the open tab in view.
  const tabBar = useRef<HTMLDivElement>(null);
  const activeTab = model.filters.tab;
  useEffect(() => {
    tabBar.current
      ?.querySelector<HTMLElement>(`[role="tab"][data-state="active"]`)
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeTab]);
  const dialogKey = `${model.viewerKey}:${model.dialog}:${model.filters.pageId ?? ""}:${model.filters.scopeId ?? ""}:${model.editingKeyword?.id ?? ""}:${model.keywordDraft?.keyword ?? ""}`;
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
  // Before the first check the Overview's start card carries "Run a check"; one copy is enough.
  const startCard =
    model.filters.tab === "overview" &&
    !model.data.observations.length &&
    !model.filters.from &&
    !model.filters.to &&
    model.data.availableActions.canEdit;
  // Next steps on the Overview cover an Audit without actions; an empty Actions tab only disagreed with them.
  const tabs = SEO_TABS.filter(
    (tab) =>
      tab !== "actions" ||
      model.data.actions.length > 0 ||
      model.filters.tab === "actions",
  );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Link
            href="/seo"
            className="text-muted-foreground text-sm underline underline-offset-4"
          >
            {t("audits.all")}
          </Link>
          {model.data.auditName ? (
            <h2 className="text-xl font-semibold">{model.data.auditName}</h2>
          ) : null}
          <p className="text-muted-foreground text-sm">
            {t("pages.count", { count: model.data.scope.pageIds.length })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {model.data.auditId && model.filters.tab !== "overview" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => model.openChat()}
            >
              <MessageSquare className="size-4" />
              {t("agent.ask")}
            </Button>
          ) : null}
          {model.data.availableActions.canRequestAnalysis && !startCard ? (
            <Button
              // The agent's next step is the one primary action, so this stays outline on every tab.
              variant="outline"
              size="sm"
              disabled={unavailable || !model.data.scope.pageIds.length}
              onClick={() => model.setDialog("analysis")}
            >
              <Play className="size-4" />
              {t("runAnalysis")}
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <MoreHorizontal className="size-4" />
                {/* On a phone the "…" icon alone keeps the header on one row. */}
                <span className="max-sm:sr-only">{t("manage")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {model.data.availableActions.canSyncMetrics ? (
                <DropdownMenuItem
                  disabled={unavailable}
                  onSelect={() => model.setDialog("statistics")}
                >
                  <BarChart3 className="size-4" />
                  {t("overview.manageConnections")}
                </DropdownMenuItem>
              ) : null}
              {model.data.availableActions.canEdit ? (
                <>
                  <DropdownMenuItem
                    disabled={unavailable}
                    onSelect={() => model.setDialog("import")}
                  >
                    <Download className="size-4" />
                    {t("importAudit")}
                  </DropdownMenuItem>
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
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="md:hidden"
        aria-expanded={filtersOpen}
        aria-controls="seo-scope-filters"
        onClick={() => setFiltersOpen((open) => !open)}
      >
        {t("scopeFilters")}
        {model.filters.channel ? (
          <span className="text-muted-foreground">
            {t(
              model.filters.channel === "organic"
                ? "statistics.channelOrganic"
                : "statistics.channelAll",
            )}
          </span>
        ) : null}
        <ChevronDown
          className={cn(
            "size-4 transition-transform",
            filtersOpen && "rotate-180",
          )}
          aria-hidden
        />
      </Button>
      <div
        id="seo-scope-filters"
        className={cn("space-y-3 md:block", filtersOpen ? "block" : "hidden")}
      >
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
        <div
          ref={tabBar}
          className="app-scrollbar w-fit max-w-full overflow-x-auto"
        >
          <TabsList className={cn(SEGMENTED_TABS_LIST_CLASS_NAME, "w-max")}>
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className={SEGMENTED_TAB_TRIGGER_CLASS_NAME}
              >
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
            <SeoStatisticsDialog
              key={dialogKey}
              model={model}
              source={model.statisticsSource}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
