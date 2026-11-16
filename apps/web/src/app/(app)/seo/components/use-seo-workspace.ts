"use client";

import type {
  ProjectSeoAction,
  ProjectSeoCompetitor,
  ProjectSeoKeyword,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  createParser,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from "nuqs";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  SeoWorkspaceLoadError,
  seoLoadErrorStatus,
  seoLoadRecovery,
  shouldRetrySeoLoad,
} from "@/app/seo/seo-load-error-model";
import { type SeoTab, seoTab } from "@/app/seo/seo-query";
import { mutateSeo } from "@/lib/actions/seo/action";
import type { SeoCommand } from "@/lib/actions/seo/types";
import { useSession } from "@/lib/auth/auth.client";
import {
  seoOwnerApiPath,
  seoViewerHeaders,
  seoWorkspaceOwner,
} from "@/lib/seo/owner";
import { type SeoAnalysisKind, seoKeywordTargetPageId } from "./seo-form-model";
import { seoCheckBlocking, seoSetup } from "./seo-setup-model";
import { type SeoStatisticsProvider } from "./seo-statistics-model";
import { SEO_SEARCH_TYPES, SEO_TRAFFIC_CHANNELS } from "./seo-traffic-model";
import { useSeoAutopilot } from "./use-seo-autopilot";
import { useSeoConnectionStatus } from "./use-seo-connection";

/** The form of a day in the period filter, as Core reads it. */
const SEO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real day of the calendar in the form of the filter: "2026-02-30" has the form and is no day. */
function seoFilterDayValid(day: string) {
  const date = new Date(`${day}T00:00:00Z`);
  return (
    SEO_DAY.test(day) &&
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === day
  );
}

const SEO_RUNNING_REFRESH_MS = 15_000;
/** The filters that choose the time the page shows, not what it shows. */
const DATE_PARAMS = ["from", "to"];

/**
 * Two workspace reads of one selection: the same viewer, owner, page, scope and channel. Only their dates differ.
 * The last part of a key is the read's query string.
 */
export function seoSameSelection(
  left: readonly unknown[],
  right: readonly unknown[],
) {
  const selection = (key: readonly unknown[]) => {
    const query = new URLSearchParams(String(key.at(-1) ?? ""));
    for (const name of DATE_PARAMS) query.delete(name);
    return JSON.stringify([...key.slice(0, -1), query.toString()]);
  };
  return selection(left) === selection(right);
}

// Old tab names in saved links open the tab that now holds their content.
const parseAsSeoTab = createParser<SeoTab>({
  parse: seoTab,
  serialize: (tab) => tab,
});

export type SeoDialog =
  | "page"
  | "scope"
  | "edit_scope"
  | "analysis"
  | "monitor"
  | "page_change"
  | "statistics"
  | "keyword"
  | "edit_keyword"
  | "competitor"
  | "improve"
  | null;

export function useSeoWorkspace(initialData: ProjectSeoWorkspace) {
  const t = useTranslations("App.Seo");
  const { data: session } = useSession();
  const owner = seoWorkspaceOwner(initialData);
  const [chatOpen, setChatOpen] = useState(false);
  // A question another tab prepared; the chat shows it for the user to review and send.
  const [chatDraft, setChatDraft] = useState<string | null>(null);
  const [urlFilters, setUrlFilters] = useQueryStates({
    tab: parseAsSeoTab.withDefault("agent"),
    pageId: parseAsString,
    scopeId: parseAsString,
    from: parseAsString,
    to: parseAsString,
    channel: parseAsStringLiteral(SEO_TRAFFIC_CHANNELS),
    searchType: parseAsStringLiteral(SEO_SEARCH_TYPES),
  });
  // The search type is a Traffic control: every other tab reads web search, and leaving Traffic clears it.
  const filters =
    urlFilters.tab === "traffic"
      ? urlFilters
      : { ...urlFilters, searchType: null };
  const setFilters: typeof setUrlFilters = (values, options) =>
    setUrlFilters(
      typeof values !== "function" && values?.tab && values.tab !== "traffic"
        ? { ...values, searchType: null }
        : values,
      options,
    );
  const query = new URLSearchParams();
  for (const key of [
    "pageId",
    "scopeId",
    "from",
    "to",
    "channel",
    "searchType",
  ] as const) {
    if (filters[key]) query.set(key, filters[key]);
  }
  // A day in another form, or an end before the start: Core refuses both, so the page reads nothing and says why.
  const invalidDates =
    [filters.from, filters.to].some((day) => day && !seoFilterDayValid(day)) ||
    Boolean(filters.from && filters.to && filters.from > filters.to);
  const initialQuery = useRef(query.toString());
  const identity = JSON.stringify([
    session?.session.activeOrganizationId,
    session?.user.id,
  ]);
  // The server rendered for the first viewer this page sees; the session can arrive after the first render.
  const [initialIdentity, setInitialIdentity] = useState(
    session ? identity : null,
  );
  if (initialIdentity === null && session) setInitialIdentity(identity);
  const waitingForSession =
    initialIdentity === null && query.toString() === initialQuery.current;
  // A read without the viewer is refused (409); after a save, the read waits for the session.
  const viewerId = useRef(session?.user.id);
  useEffect(() => {
    viewerId.current = session?.user.id;
  });
  async function refetchForViewer() {
    if (viewerId.current) await result.refetch();
  }
  const key = [
    "seo-workspace",
    session?.session.activeOrganizationId,
    session?.user.id,
    owner.kind,
    owner.id,
    query.toString(),
  ];
  async function readWorkspace(search: string, signal: AbortSignal) {
    const response = await fetch(`${seoOwnerApiPath(owner)}?${search}`, {
      signal,
      credentials: "same-origin",
      cache: "no-store",
      headers: seoViewerHeaders(
        session?.user.id,
        session?.session.activeOrganizationId,
      ),
    });
    if (!response.ok) throw new SeoWorkspaceLoadError(response.status);
    return response.json();
  }
  const result = useQuery<ProjectSeoWorkspace>({
    queryKey: key,
    retry: shouldRetrySeoLoad,
    queryFn: ({ signal }) => readWorkspace(query.toString(), signal),
    initialData:
      !!session?.user.id &&
      query.toString() === initialQuery.current &&
      identity === initialIdentity
        ? initialData
        : undefined,
    // Server data seeded after a late session is not fresh enough to skip the read.
    initialDataUpdatedAt: 0,
    // Another day of the same selection keeps the page in view while it loads: no jump back to the first
    // read and forward again. Another page, scope or channel reads afresh.
    // Dates that cannot be read show no old read under them.
    placeholderData: (previous, previousQuery) =>
      !invalidDates &&
      previousQuery &&
      seoSameSelection(previousQuery.queryKey, key)
        ? previous
        : undefined,
    // Always read once after mount; fresh server or cached data would skip it.
    refetchOnMount: "always",
    enabled: !invalidDates && !!session?.user.id,
    refetchOnWindowFocus: false,
    refetchInterval: (state) =>
      !seoLoadRecovery({ status: seoLoadErrorStatus(state.state.error) })
        .contextual &&
      state.state.data?.analyses.some(
        (analysis) =>
          analysis.status === "requested" || analysis.status === "running",
      )
        ? SEO_RUNNING_REFRESH_MS
        : false,
  });
  const data = result.data ?? initialData;
  const google = useSeoConnectionStatus("search_console").status;
  const setupIdentity = JSON.stringify([identity, owner.kind, owner.id]);
  const [googleSkippedFor, setGoogleSkippedFor] = useState<string | null>(null);
  const accountChosen =
    google.data?.status === "connected" || googleSkippedFor === setupIdentity;
  // A page/date filter can hide a previous check. Reuse the whole-Audit cache before deciding it is first-run.
  const needsSetupChoice =
    data.availableActions.canEdit && !seoCheckBlocking(data, new Date());
  const needsSetupHistory =
    needsSetupChoice &&
    Boolean(query.toString()) &&
    !accountChosen &&
    !data.observations.length &&
    !data.analyses.some((check) => check.status === "completed");
  const setupHistory = useQuery<ProjectSeoWorkspace>({
    queryKey: [...key.slice(0, -1), ""],
    queryFn: ({ signal }) => readWorkspace("", signal),
    enabled: needsSetupHistory && !invalidDates && Boolean(session?.user.id),
    retry: shouldRetrySeoLoad,
    refetchOnWindowFocus: false,
  });
  const setupWorkspace = needsSetupHistory ? setupHistory.data : data;
  const hasPreviousCheck = Boolean(
    setupWorkspace &&
      (setupWorkspace.observations.length ||
        setupWorkspace.analyses.some((check) => check.status === "completed")),
  );
  const googleReady = hasPreviousCheck || accountChosen;
  const setup = seoSetup(data, filters, googleReady);
  // Filtered views cannot bypass the first-run choice. Already completed checks need no new consent.
  const waitingForGoogle =
    needsSetupChoice &&
    !googleReady &&
    (!setupWorkspace ||
      seoSetup(setupWorkspace, undefined, googleReady)?.connection === "next");
  function skipGoogleSetup() {
    setGoogleSkippedFor(setupIdentity);
  }
  function requireGoogleSetup() {
    if (!waitingForGoogle) return false;
    if (!setupWorkspace) return true;
    void setFilters({
      tab: "agent",
      from: null,
      to: null,
      pageId: null,
      scopeId: null,
      channel: null,
    });
    return true;
  }
  const [keywordSearch, setKeywordSearch] = useState("");
  const [competitorSearch, setCompetitorSearch] = useState("");
  const [dialog, setDialogState] = useState<SeoDialog>(null);
  const [statisticsSource, setStatisticsSource] =
    useState<SeoStatisticsProvider>();
  const [keywordDraft, setKeywordDraft] = useState<{
    keyword: string;
    pageId: string | null;
  } | null>(null);
  const [analysisKind, setAnalysisKind] = useState<SeoAnalysisKind | null>(
    null,
  );
  /**
   * One check at a time. Every way to the check form goes through here, so a press while a check runs opens
   * nothing and says why: the buttons, the steps of the Agent tab and the replies in the chat.
   */
  function checkInFlight() {
    if (!seoCheckBlocking(data, new Date())) return false;
    toast.info(t("analysis.alreadyRunning"));
    return true;
  }
  function setDialog(value: SeoDialog) {
    if (value === "analysis" && (requireGoogleSetup() || checkInFlight()))
      return;
    setStatisticsSource(undefined);
    setKeywordDraft(null);
    setAnalysisKind(null);
    setDialogState(value);
  }
  /** Opens the schedule form on the run button's check: the full audit where these pages allow one. */
  function openMonitor() {
    setDialog("monitor");
  }
  /** Opens the check form on one check type; the form falls back to a page check where that type cannot run. */
  function openAnalysis(kind: SeoAnalysisKind) {
    if (requireGoogleSetup() || checkInFlight()) return;
    setAnalysisKind(kind);
    setDialogState("analysis");
  }
  function openStatistics(source?: SeoStatisticsProvider) {
    setStatisticsSource(source);
    setDialogState("statistics");
  }
  const [editingKeyword, setEditingKeyword] =
    useState<ProjectSeoKeyword | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  // One browser request keeps its key after an uncertain acknowledgement.
  const operationKeys = useRef(new Map<string, string>());
  function operationKey(input: string) {
    let value = operationKeys.current.get(input);
    if (!value) {
      value = crypto.randomUUID();
      operationKeys.current.set(input, value);
    }
    return value;
  }
  async function execute(command: SeoCommand, success = t("saved")) {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    try {
      const response = await mutateSeo({
        owner,
        command,
      });
      if (!response.ok) {
        toast.error(
          response.error.kind === CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE
            ? t("notEnoughCredits")
            : response.error.status === 409
              ? t("conflict")
              : t("saveFailed"),
        );
        // A conflict means this view is stale: read the current revision so the next try can land.
        if (response.error.status === 409) await refetchForViewer();
        return false;
      }
      if (
        command.kind === "request_analysis" ||
        command.kind === "create_monitor"
      ) {
        for (const [key, value] of operationKeys.current)
          if (
            value ===
            (command.kind === "request_analysis"
              ? command.body.idempotencyKey
              : command.body.operationId)
          )
            operationKeys.current.delete(key);
      }
      toast.success(success);
      setDialog(null);
      await refetchForViewer();
      return true;
    } catch {
      toast.error(t("saveFailed"));
      return false;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  // The action an Agent row leads to. Its card takes the focus once.
  const [shownAction, setShownAction] = useState<string | null>(null);
  function showAction(action: { observationId: string; id: string }) {
    setShownAction(seoActionKey(action));
    void setFilters({ tab: "actions" });
  }
  // A row that names the strategy actions (Agent tab, Competitors list) leads to their group. The group opens in
  // full and takes the focus once.
  const [shownStrategy, setShownStrategy] = useState(false);
  function showStrategy() {
    setShownStrategy(true);
    void setFilters({ tab: "actions" });
  }
  function openChat(draft?: string) {
    if (draft) setChatDraft(draft);
    setChatOpen(true);
  }
  const filteredKeywords = data.keywords.filter((row) =>
    row.keyword.toLocaleLowerCase().includes(keywordSearch.toLocaleLowerCase()),
  );
  const filteredQueries = (data.searchQueries?.rows ?? []).filter((row) =>
    row.query.toLocaleLowerCase().includes(keywordSearch.toLocaleLowerCase()),
  );
  /** Saving a measured query as a tracked keyword still needs a chosen Market. */
  function trackQuery(row: { query: string; pageUrl: string }) {
    setDialog("keyword");
    setKeywordDraft({
      keyword: row.query,
      pageId: data.pages.find((page) => page.url === row.pageUrl)?.id ?? null,
    });
  }
  const filteredCompetitors = data.competitors.filter((row) =>
    row.url.toLocaleLowerCase().includes(competitorSearch.toLocaleLowerCase()),
  );
  function toggleKeyword(row: ProjectSeoKeyword) {
    return execute({
      kind: "save_keyword",
      body: {
        keyword: row.keyword,
        countryCode: row.countryCode,
        languageCode: row.languageCode,
        pageId: seoKeywordTargetPageId(row, data.pages),
        priority: row.priority,
        saved: !row.saved,
        ...(row.version > 0 ? { expectedVersion: row.version } : {}),
      },
    });
  }
  function openKeywordEdit(row: ProjectSeoKeyword) {
    setEditingKeyword(row);
    setDialog("edit_keyword");
  }
  function toggleCompetitor(row: ProjectSeoCompetitor) {
    return execute({
      kind: "save_competitor",
      body: {
        url: row.url,
        confirmed: !row.confirmed,
        ...(row.version > 0 ? { expectedVersion: row.version } : {}),
      },
    });
  }
  function createActionTask(action: ProjectSeoAction) {
    return execute({
      kind: "create_action_task",
      body: {
        observationId: action.observationId,
        actionId: action.id,
        idempotencyKey: operationKey(
          `action:${action.observationId}:${action.id}`,
        ),
      },
    });
  }
  const statisticsSync = useSeoAutopilot({
    data,
    viewerKey: identity,
    enabled:
      Boolean(session?.user.id) &&
      Boolean(result.data) &&
      !invalidDates &&
      data.scope.pageIds.length > 0 &&
      data.availableActions.canSyncMetrics,
    channel: filters.channel,
    searchType: filters.searchType,
  });
  return {
    data,
    statisticsSync,
    setup,
    waitingForGoogle,
    googleConnected: google.data?.status === "connected",
    setupHistoryError:
      needsSetupHistory && setupHistory.isError && !setupHistory.data,
    retrySetupHistory: () => setupHistory.refetch(),
    skipGoogleSetup,
    viewerKey: identity,
    openChat,
    shownAction,
    setShownAction,
    showAction,
    shownStrategy,
    setShownStrategy,
    showStrategy,
    chatDraft,
    setChatDraft,
    chatOpen,
    setChatOpen,
    owner,
    filteredKeywords,
    filteredQueries,
    trackQuery,
    keywordDraft,
    analysisKind,
    openAnalysis,
    openMonitor,
    checkInFlight,
    filteredCompetitors,
    toggleKeyword,
    openKeywordEdit,
    editingKeyword,
    toggleCompetitor,
    createActionTask,
    loadingScope: !result.data && !waitingForSession,
    /** The page shows the read of other dates while the read of the picked ones loads. */
    updating: result.isPlaceholderData,
    waitingForSession,
    waitingForContext:
      !result.data && initialIdentity !== null && identity !== initialIdentity,
    filters,
    setFilters,
    result,
    invalidDates,
    dialog,
    setDialog,
    statisticsSource,
    openStatistics,
    pending,
    execute,
    operationKey,
    keywordSearch,
    setKeywordSearch,
    competitorSearch,
    setCompetitorSearch,
  };
}

export type SeoWorkspaceModel = ReturnType<typeof useSeoWorkspace>;

/** One action of one check; action ids repeat across checks. */
export function seoActionKey(action: { observationId: string; id: string }) {
  return `${action.observationId}:${action.id}`;
}
