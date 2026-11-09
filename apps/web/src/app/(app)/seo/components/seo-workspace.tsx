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
import { SeoAgentHome } from "./seo-agent-home";
import { SeoAnalysisDialog } from "./seo-analysis-dialog";
import { SeoChatPanel } from "./seo-chat-panel";
import { SeoCompetitors } from "./seo-competitors";
import { SeoEditDialog } from "./seo-edit-dialog";
import { SeoImportDialog } from "./seo-import-dialog";
import { SeoKeywords } from "./seo-keywords";
import { SeoHealth } from "./seo-overview";
import { SeoPageChangeDialog } from "./seo-page-change-dialog";
import { SeoPageError } from "./seo-page-error";
import {
  SeoScopeBar,
  seoScopeControls,
  useSeoDateFields,
} from "./seo-scope-bar";
import { SeoEmpty, SeoPageLink } from "./seo-shared";
import { SeoStatisticsDialog } from "./seo-statistics-dialog";
import { SeoTraffic } from "./seo-traffic";
import { useSeoWorkspace } from "./use-seo-workspace";

export function SeoWorkspace({
  workspace,
}: {
  workspace: ProjectSeoWorkspace;
}) {
  const t = useTranslations("App.Seo");
  const model = useSeoWorkspace(workspace);
  // Phones show the agent first; pages and filters open on demand (always open from md up).
  // With only the date filter left, its own button is enough and needs no fold.
  const controls = seoScopeControls(model);
  const foldFilters = controls.pages || controls.channel;
  const editScope = Boolean(
    model.data.scope.id && model.data.availableActions.canEdit,
  );
  const dateFields = useSeoDateFields({
    filters: model.filters,
    dates: controls.dates,
  });
  // An empty filter block would still add a gap under the header.
  const showFilters =
    foldFilters || controls.dates || dateFields.open || editScope;
  const [filtersOpen, setFiltersOpen] = useState(
    Boolean(model.filters.from || model.filters.to),
  );
  // The tab bar scrolls sideways on a phone; keep the open tab in view.
  const tabBar = useRef<HTMLDivElement>(null);
  const activeTab = model.filters.tab;
  useEffect(() => {
    const bar = tabBar.current;
    const tab = bar?.querySelector<HTMLElement>(
      `[role="tab"][data-state="active"]`,
    );
    if (!bar || !tab) return;
    // Scroll the bar only; scrolling the tab into view could move the page.
    const outer = bar.getBoundingClientRect();
    const inner = tab.getBoundingClientRect();
    if (inner.left < outer.left) bar.scrollLeft -= outer.left - inner.left;
    else if (inner.right > outer.right)
      bar.scrollLeft += inner.right - outer.right;
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
  // Next steps on the Agent tab cover an Audit without actions; an empty Actions tab only disagreed with them.
  const tabs = SEO_TABS.filter(
    (tab) =>
      tab !== "actions" ||
      model.data.actions.length > 0 ||
      model.filters.tab === "actions",
  );
  const scopePage =
    model.data.scope.pageIds.length === 1
      ? model.data.pages.find((page) => page.id === model.data.scope.pageIds[0])
      : undefined;
  return (
    // Phone buttons and fields are at least 40 px tall; the tab row keeps its 36 px bar.
    <div className="space-y-6 max-sm:[&_[data-slot=button]]:min-h-10 max-sm:[&_[data-slot=input]]:min-h-10 max-sm:[&_[data-slot=select-trigger]]:min-h-10">
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
          {/* One page in view: its URL says more than a count. */}
          {scopePage ? (
            <SeoPageLink url={scopePage.url} label={scopePage.label} />
          ) : (
            <p className="text-muted-foreground text-sm">
              {t("pages.count", { count: model.data.scope.pageIds.length })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {model.data.auditId && model.filters.tab !== "agent" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => model.openChat()}
              aria-label={t("agent.ask")}
            >
              <MessageSquare className="size-4" />
              {/* A short label on the phone keeps the three header buttons on one row. */}
              <span className="sm:hidden">{t("agent.askShort")}</span>
              <span className="max-sm:hidden">{t("agent.ask")}</span>
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* The trigger replaces the button's data-slot, so the phone height is set here. */}
              <Button
                variant="outline"
                size="sm"
                className="max-sm:min-h-10 max-sm:min-w-10"
              >
                <MoreHorizontal className="size-4" />
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
          // On a phone the tabs fill the row; a fifth tab still scrolls, without a scroll track.
          className="app-scrollbar w-fit max-w-full overflow-x-auto max-sm:w-full max-sm:[scrollbar-width:none]"
        >
          <TabsList
            className={cn(
              SEGMENTED_TABS_LIST_CLASS_NAME,
              // Phone triggers are taller than the default list; a fixed list height would clip their focus ring.
              "w-max max-sm:h-auto max-sm:min-w-full",
            )}
          >
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className={cn(
                  SEGMENTED_TAB_TRIGGER_CLASS_NAME,
                  "max-sm:min-h-9 max-sm:flex-1 max-sm:px-1.5",
                )}
              >
                {t(`tabs.${tab}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {/* Filters sit under the tabs, so the tab row stays put when a tab has none. */}
        {foldFilters ? (
          <Button
            variant="outline"
            size="sm"
            className="self-start md:hidden"
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
        ) : null}
        {showFilters ? (
          <div
            id="seo-scope-filters"
            className={cn(
              "space-y-3 md:block",
              filtersOpen || !foldFilters ? "block" : "hidden",
            )}
          >
            <SeoScopeBar model={model} dateFields={dateFields} />
            {editScope ? (
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
        ) : null}
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
            <TabsContent value="agent">
              <SeoAgentHome model={model} />
            </TabsContent>
            <TabsContent value="traffic">
              <SeoTraffic model={model} />
            </TabsContent>
            <TabsContent value="rankings" className="space-y-8">
              <SeoKeywords model={model} />
              <SeoCompetitors model={model} />
            </TabsContent>
            <TabsContent value="health">
              <SeoHealth model={model} />
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
