"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import {
  Bot,
  CalendarClock,
  ChartLine,
  ChevronDown,
  Eye,
  HeartPulse,
  Info,
  ListChecks,
  ListOrdered,
  ListPlus,
  Loader2,
  type LucideIcon,
  MoreHorizontal,
  PencilLine,
  Play,
  Plus,
  RotateCw,
  Settings2,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import {
  seoClientReadNeedsPage,
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
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SEGMENTED_TAB_TRIGGER_CLASS_NAME,
  SEGMENTED_TABS_LIST_CLASS_NAME,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { seoIndexHref } from "../seo-href";
import { SeoActions } from "./seo-actions";
import { SeoAgentHome } from "./seo-agent-home";
import { SeoAnalysisDialog } from "./seo-analysis-dialog";
import { SeoAskButton } from "./seo-ask-button";
import { SeoChatPanel } from "./seo-chat-panel";
import { SeoEditDialog } from "./seo-edit-dialog";
import { SeoIndexStatus } from "./seo-index-status";
import { SeoHealth } from "./seo-overview";
import { SeoPageChangeDialog } from "./seo-page-change-dialog";
import { SeoPageError } from "./seo-page-error";
import { SeoRankings } from "./seo-rankings";
import { SeoRuns } from "./seo-runs";
import { seoRunDays } from "./seo-runs-model";
import {
  SeoDateFilterButton,
  SeoPagePicker,
  SeoScopeBar,
  seoScopeControls,
  useSeoDateFields,
} from "./seo-scope-bar";
import { seoRunAction, seoSetup } from "./seo-setup-model";
import { SeoEmpty, SeoPageLink } from "./seo-shared";
import { SeoStatisticsDialog } from "./seo-statistics-dialog";
import { SeoTraffic } from "./seo-traffic";
import { useSeoWorkspace } from "./use-seo-workspace";

/** A load faster than this shows no skeleton at all. */
const SKELETON_DELAY_MS = 150;
const SKELETON_ROWS = ["first", "second"] as const;

/** The notice that says checks are off; the header's run button points to it. */
const SEO_DISPATCH_PAUSED_ID = "seo-dispatch-paused";
const SEO_TAB_ICONS: Record<SeoTab, LucideIcon> = {
  agent: Bot,
  actions: ListChecks,
  traffic: ChartLine,
  rankings: ListOrdered,
  health: HeartPulse,
};

/** The picture of a tab. A phone has no room for it: five tabs fill the row. */
function TabIcon({ tab }: { tab: SeoTab }) {
  const Icon = SEO_TAB_ICONS[tab];
  return <Icon className="size-4 max-sm:hidden" />;
}

export function SeoWorkspace({
  workspace,
}: {
  workspace: ProjectSeoWorkspace;
}) {
  const t = useTranslations("App.Seo");
  const model = useSeoWorkspace(workspace);
  const setup = seoSetup(model.data, model.filters);
  // Phones show the agent first; pages and filters open on demand (always open from md up).
  // With only the date filter left, its own button is enough and needs no fold.
  const controls = seoScopeControls(model);
  // The page picker stands in the header line of every tab. An empty Traffic tab keeps it: statistics can
  // exist for one page while the view of all pages has none.
  const pagePicker = controls.pages;
  const foldFilters = controls.channel;
  const editScope = Boolean(
    model.data.scope.id && model.data.availableActions.canEdit,
  );
  const picked = seoRunDays(model.data, model.filters).picked;
  const dateFields = useSeoDateFields({
    filters: model.filters,
    dates: controls.dates,
    picked,
  });
  // An empty filter block would still add a gap under the header.
  // With a page picker the closed date filter stands beside it, in the header line. Without one it stays under
  // the tabs: one line more in the header of the dated tabs only would move the tab row from tab to tab.
  const showFilters =
    foldFilters ||
    (controls.dates && !pagePicker) ||
    dateFields.open ||
    editScope;
  const [filtersOpen, setFiltersOpen] = useState(
    Boolean(model.filters.from || model.filters.to) && !picked,
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
        resetHref={seoIndexHref(model.data.projectId ?? null)}
        status={loadStatus}
        owner={model.owner}
        hasSelection={Boolean(model.filters.pageId || model.filters.scopeId)}
        askPage={seoClientReadNeedsPage(model.owner, loadStatus)}
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
      Boolean(model.data.strategy?.actions.length) ||
      // The notes on promotion places stand on this tab, also when the audit has no action.
      Boolean(model.data.strategy?.placesNotes?.length) ||
      model.filters.tab === "actions",
  );
  const { canRequestAnalysis } = model.data.availableActions;
  // The filled button of every tab, until a result waits. The setup card is on the Agent tab only; there its own check step leads.
  const runAudit =
    model.filters.tab === "agent" && setup ? null : seoRunAction(model.data);
  // While the pages load or the dates are wrong, no dialog opens.
  const runReady = Boolean(runAudit?.ready) && !unavailable;
  const scopePage =
    model.data.scope.pageIds.length === 1
      ? model.data.pages.find((page) => page.id === model.data.scope.pageIds[0])
      : undefined;
  return (
    // Phone buttons and fields are at least 40 px tall; the tab row keeps its 36 px bar.
    // The space under the last row keeps it clear of the floating button.
    <div className="space-y-6 pb-16 [&_details[open]>:not(summary)]:content-rise max-sm:[&_[data-slot=button]]:min-h-10 max-sm:[&_[data-slot=dropdown-menu-trigger]]:min-h-10 max-sm:[&_[data-slot=input]]:min-h-10 max-sm:[&_[data-slot=select-trigger]]:min-h-10">
      {/* On a phone the actions sit on the title row and the URL has its own row, so the header is as tall on every tab. */}
      <div className="flex flex-wrap items-end justify-between gap-3 max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:items-center max-sm:gap-y-1">
        <div className="min-w-0 space-y-1 max-sm:contents max-sm:space-y-0">
          <Link
            href={seoIndexHref(model.data.projectId ?? null)}
            className="text-muted-foreground text-sm underline underline-offset-4 max-sm:col-span-2 max-sm:justify-self-start"
          >
            {t("audits.all")}
          </Link>
          {model.data.auditName ? (
            <h2 className="min-w-0 text-xl font-semibold break-words max-sm:col-start-1">
              {model.data.auditName}
            </h2>
          ) : null}
          {/* One page in view: its URL says more than a count. */}
          <div className="min-w-0 max-sm:col-span-2 max-sm:row-start-3">
            {pagePicker ? (
              // Both narrow the view, so they stand on one line.
              <div className="flex flex-wrap items-center gap-x-4">
                <SeoPagePicker model={model} />
                {controls.dates && !dateFields.open ? (
                  // Its fields open in the filter block under the tabs.
                  <SeoDateFilterButton
                    dateFields={dateFields}
                    onReveal={() => setFiltersOpen(true)}
                  />
                ) : null}
              </div>
            ) : null}
            {scopePage ? (
              <SeoPageLink url={scopePage.url} />
            ) : pagePicker ? null : (
              <p className="text-muted-foreground text-sm">
                {t("pages.count", { count: model.data.scope.pageIds.length })}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 max-sm:col-start-2 max-sm:row-start-2 max-sm:flex-nowrap">
          {runAudit ? (
            <Button
              size="sm"
              variant={runReady && runAudit.leads ? "primary" : "outline"}
              // Not the disabled attribute: that drops focus. The button's own text says a check runs;
              // the notice under the header says checks are off.
              aria-disabled={!runReady || undefined}
              aria-describedby={
                canRequestAnalysis || unavailable
                  ? undefined
                  : SEO_DISPATCH_PAUSED_ID
              }
              aria-label={t(runAudit.label)}
              className="aria-disabled:pointer-events-none aria-disabled:opacity-50 max-sm:min-w-10"
              onClick={() => {
                if (runReady) model.openAnalysis(runAudit.kind);
              }}
            >
              {runAudit.running ? (
                <Loader2 className="size-4 animate-spin motion-reduce:animate-pulse" />
              ) : (
                <Play className="size-4" />
              )}
              {/* On the phone a running check shows its spinner only; the label names it. The phone words say
                  what runs and are part of the label, so a voice command with the shown words finds the button. */}
              {runAudit.running ? null : (
                <span className="sm:hidden">
                  {t(
                    runAudit.kind === "audit_full"
                      ? "runAuditShort"
                      : "runCheckShort",
                  )}
                </span>
              )}
              <span className="max-sm:hidden">{t(runAudit.label)}</span>
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* The trigger shows only its icon, so one worded button stands in the header: the run. An
                  icon-only control is 40 px below md. */}
              <Button
                variant="outline"
                size="sm"
                title={t("manage")}
                className="max-md:min-h-10 max-md:min-w-10"
              >
                <MoreHorizontal className="size-4" />
                <span className="sr-only">{t("manage")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {model.data.availableActions.canSyncMetrics ? (
                <DropdownMenuItem
                  disabled={unavailable}
                  onSelect={() => model.setDialog("statistics")}
                >
                  <Settings2 className="size-4" />
                  {t("overview.manageConnections")}
                </DropdownMenuItem>
              ) : null}
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
                    <ListPlus className="size-4" />
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
      {/* One group of notices; it takes no room when none shows. */}
      <div className="space-y-2 empty:hidden">
        {!unavailable && model.data.history.limited ? (
          <p
            role="status"
            className="text-muted-foreground flex items-start gap-2 text-sm"
          >
            <Info className="mt-0.5 size-4 shrink-0" />
            {t("historyLimited", { limit: model.data.history.limit })}
          </p>
        ) : null}
        {/* During setup the card on the agent tab says this on its check step. */}
        {!unavailable &&
        model.data.availableActions.canEdit &&
        model.data.scope.pageIds.length > 0 &&
        !model.data.availableActions.canRequestAnalysis &&
        !(model.filters.tab === "agent" && setup) ? (
          <p
            id={SEO_DISPATCH_PAUSED_ID}
            className="text-muted-foreground flex items-start gap-2 text-sm"
          >
            <Info className="mt-0.5 size-4 shrink-0" />
            {t("dispatchPaused")}
          </p>
        ) : null}
        {!model.data.availableActions.canEdit ? (
          <p className="text-muted-foreground flex items-start gap-2 text-sm">
            <Eye className="mt-0.5 size-4 shrink-0" />
            {t("readOnly")}
          </p>
        ) : null}
      </div>
      {model.result.isError ? (
        <div role="alert" className="space-y-2">
          <p className="text-sm">{t("refreshFailed")}</p>
          <Button
            variant="outline"
            size="sm"
            loading={model.result.isFetching}
            onClick={() => {
              void model.result.refetch();
            }}
          >
            <RotateCw />
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
        <SeoRuns model={model} />
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
                  "gap-1.5 max-sm:min-h-9 max-sm:flex-1 max-sm:px-1.5",
                )}
              >
                <TabIcon tab={tab} />
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
                "size-4 transition-transform duration-150 ease-out motion-reduce:transition-none",
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
            <SeoScopeBar
              model={model}
              dateFields={dateFields}
              dateButton={!pagePicker}
            />
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
          ) : model.invalidDates ? (
            <p
              role="status"
              className="text-muted-foreground py-8 text-center text-sm"
            >
              {t("invalidDates")}
            </p>
          ) : (
            // The shape of a tab: a panel of white cards. The bones sit inside
            // the cards, because a bone on the panel has the panel's own colour.
            // The short fade keeps a fast load from flashing it.
            <div
              role="status"
              className={cn(HOLDER_CLASS, "content-in space-y-3")}
              style={{ animationDelay: `${SKELETON_DELAY_MS}ms` }}
            >
              <span className="sr-only">{t("loading")}</span>
              <Skeleton className="mx-2 mt-1 h-4 w-24" />
              <div className={cn(HOLDER_ITEM_CLASS, "space-y-3 p-4")}>
                <Skeleton className="h-6 w-48 max-w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
              {SKELETON_ROWS.map((row) => (
                <div
                  key={row}
                  className={cn(
                    HOLDER_ITEM_CLASS,
                    "flex items-center gap-3 p-4",
                  )}
                >
                  <Skeleton className="size-8 shrink-0 rounded-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ))}
            </div>
          )
        ) : (
          <>
            <TabsContent value="agent">
              <SeoAgentHome model={model} />
            </TabsContent>
            <TabsContent value="traffic">
              <SeoTraffic model={model} />
            </TabsContent>
            <TabsContent value="rankings" className="space-y-6">
              <SeoRankings model={model} />
            </TabsContent>
            <TabsContent value="health" className="space-y-6">
              <SeoIndexStatus model={model} />
              <SeoHealth model={model} />
            </TabsContent>
            <TabsContent value="actions">
              <SeoActions model={model} />
            </TabsContent>
          </>
        )}
      </Tabs>
      {model.data.auditId ? (
        <>
          <SeoAskButton model={model} />
          <SeoChatPanel model={model} />
        </>
      ) : null}
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
