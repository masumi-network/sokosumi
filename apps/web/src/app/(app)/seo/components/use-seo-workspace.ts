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
import { useLatestRef } from "@/hooks/effects/use-latest-ref";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { mutateSeo } from "@/lib/actions/seo/action";
import { type SeoCommand, seoReviewIdentity } from "@/lib/actions/seo/types";
import { useSession } from "@/lib/auth/auth.client";
import {
  seoOwnerApiPath,
  seoViewerHeaders,
  seoWorkspaceOwner,
} from "@/lib/seo/owner";
import { seoSearchConsoleWarning } from "@/lib/seo/search-console-warning";
import { canSetBriefPage, type SeoSetupGoalChoice } from "./seo-brief-model";
import { type SeoAnalysisKind, seoKeywordTargetPageId } from "./seo-form-model";
import { seoCheckBlocking, seoSetup } from "./seo-setup-model";
import { type SeoStatisticsProvider } from "./seo-statistics-model";
import { SEO_SEARCH_TYPES, SEO_TRAFFIC_CHANNELS } from "./seo-traffic-model";
import { useSeoAutopilot } from "./use-seo-autopilot";
import { useSeoBrief, useSeoGoalSuggestion } from "./use-seo-brief";
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
  | "brief"
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
  // The search type and the channel are Traffic controls: every other tab reads web search in every
  // channel, and leaving Traffic clears both. A channel kept there hid organic Search Console data.
  const filters =
    urlFilters.tab === "traffic"
      ? urlFilters
      : { ...urlFilters, searchType: null, channel: null };
  const setFilters: typeof setUrlFilters = (values, options) =>
    setUrlFilters(
      typeof values !== "function" && values?.tab && values.tab !== "traffic"
        ? { ...values, searchType: null, channel: null }
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
  const viewerId = useLatestRef(session?.user.id);
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
    !data.runs?.length &&
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
        setupWorkspace.runs?.length ||
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
  const setupScopeKey = JSON.stringify([
    setupIdentity,
    session?.session.id,
    data.scope.id,
    data.scope.version,
    data.scope.pageIds,
  ]);
  const [reviewGoal, setReviewGoal] = useState<
    (SeoSetupGoalChoice & { scopeKey: string }) | null
  >(null);
  // Returning to an earlier page selection must not restore consent from a closed review.
  if (reviewGoal && reviewGoal.scopeKey !== setupScopeKey) {
    setReviewGoal(null);
    if (dialog === "analysis") setDialogState(null);
  }
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
    setReviewGoal(null);
    setDialogState(value);
  }
  /** Opens the schedule form on the run button's check: the full audit where these pages allow one. */
  function openMonitor() {
    setDialog("monitor");
  }
  /** Opens the check form on one check type; the form falls back to a page check where that type cannot run. */
  function openAnalysis(kind: SeoAnalysisKind, choice?: SeoSetupGoalChoice) {
    if (requireGoogleSetup() || checkInFlight()) return;
    setReviewGoal(choice ? { ...choice, scopeKey: setupScopeKey } : null);
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
  const sessionKey = JSON.stringify([setupIdentity, session?.session.id]);
  const activeSessionKey = useRef<string | null>(sessionKey);
  const unconfirmed = useRef<{
    toastId: string;
    key: string;
    command: SeoCommand;
    success: string;
  } | null>(null);
  useEffect(() => {
    activeSessionKey.current = sessionKey;
    return () => {
      activeSessionKey.current = null;
      if (unconfirmed.current) toast.dismiss?.(unconfirmed.current.toastId);
      unconfirmed.current = null;
    };
  }, [sessionKey]);
  async function execute(
    command: SeoCommand,
    success = t("saved"),
    handleRefusal?: (kind: string | undefined) => boolean,
  ) {
    if (pendingRef.current || activeSessionKey.current !== sessionKey)
      return false;
    const key = seoLaunchKey(command);
    const previous = unconfirmed.current;
    function offerReplay(attempt: NonNullable<typeof unconfirmed.current>) {
      toast.error(t("analysis.unconfirmed"), {
        id: attempt.toastId,
        closeButton: true,
        duration: Infinity,
        action: {
          label: t("analysis.retryPrevious"),
          onClick: () => {
            // The toast can outlive the form. Its refusal must never offer consent on another form.
            if (unconfirmed.current === attempt)
              void execute(attempt.command, attempt.success);
          },
        },
      });
    }
    if (key && previous) {
      if (previous.key !== key) {
        offerReplay(previous);
        return false;
      }
      command = previous.command;
      success = previous.success;
    }
    const checkedLaunch =
      command.kind === "monitor_run_now" ||
      (command.kind === "request_analysis" &&
        command.body.kind === "audit_full") ||
      (command.kind === "create_monitor" &&
        command.body.analysis.kind === "audit_full");
    function rememberLaunch() {
      if (!key || !checkedLaunch) return false;
      const attempt = {
        toastId: previous?.toastId ?? crypto.randomUUID(),
        key,
        command,
        success,
      };
      unconfirmed.current = attempt;
      offerReplay(attempt);
      return true;
    }
    let received = false;
    pendingRef.current = true;
    setPending(true);
    try {
      const response = await mutateSeo({
        owner,
        command,
        ...(seoReviewIdentity(command) && session?.user.id
          ? {
              briefViewer: {
                userId: session.user.id,
                sessionId: session.session.id,
                organizationId: session.session.activeOrganizationId ?? null,
              },
            }
          : {}),
      });
      received = true;
      if (activeSessionKey.current !== sessionKey) return false;
      if (
        !response.ok &&
        ((response.error.status ?? 0) >= 500 ||
          (!response.error.status &&
            response.error.code === CommonErrorCode.INTERNAL_SERVER_ERROR)) &&
        rememberLaunch()
      )
        return false;
      if (key && unconfirmed.current?.key === key) {
        toast.dismiss?.(unconfirmed.current.toastId);
        unconfirmed.current = null;
      }
      if (!response.ok) {
        if (handleRefusal?.(response.error.kind)) return false;
        const reason = seoSearchConsoleWarning(response.error.kind);
        if (reason) {
          toast.error(t(`analysis.coverage.${reason}`));
          return false;
        }
        toast.error(
          response.error.kind === CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE
            ? t("notEnoughCredits")
            : response.error.status === 409
              ? t("conflict")
              : t("saveFailed"),
        );
        // A conflict means this view is stale: read the current revision so the next try can land.
        if (response.error.status === 409) {
          if (
            command.kind === "request_analysis" &&
            (command.body.sharedBrief || command.body.setupGoal)
          )
            await brief.reload();
          await refetchForViewer();
        }
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
      if (
        command.kind === "record_page_change" ||
        command.kind === "sync_statistics" ||
        command.kind === "import_audit" ||
        (command.kind === "request_analysis" && command.body.setupGoal)
      )
        await brief.invalidate();
      toast.success(success);
      setDialog(null);
      await refetchForViewer();
      return true;
    } catch {
      if (activeSessionKey.current !== sessionKey) return false;
      if (!received && rememberLaunch()) return false;
      toast.error(t("saveFailed"));
      return false;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  // A row that names the strategy actions (Agent tab, Competitors list) leads to their group. The group opens in
  // full and takes the focus once.
  const [shownStrategy, setShownStrategy] = useState(false);
  function showStrategy() {
    setShownStrategy(true);
    void setFilters({ tab: "actions" });
  }
  // The lead of the Agent tab opens its action on the Actions tab, in the list with the other actions.
  const [shownAction, setShownAction] = useState<string | null>(null);
  function showAction(key: string) {
    setShownAction(key);
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
  function acknowledgeReview(action: ProjectSeoAction) {
    const review = action.followUpReview;
    const page = data.pages.find((p) => p.url === action.pageUrl);
    if (!review || !page) return;
    return execute({
      kind: "acknowledge_review",
      body: {
        pageId: page.id,
        view: {
          scopeId: data.scope.id ?? undefined,
          pageId: !data.scope.id && filters.pageId ? page.id : undefined,
          from: data.scope.from ?? undefined,
          to: data.scope.to ?? undefined,
        },
        actionId: action.id,
        kind: review.kind,
        period: review.period,
        baselineObservationId: review.baselineObservationId,
        observationId: review.observationId,
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
  const setupGoalPageId =
    setup?.check === "next" &&
    !hasPreviousCheck &&
    !data.analyses.length &&
    filters.tab === "agent"
      ? data.scope.pageIds[0]
      : undefined;
  const [advancedScope, setAdvancedScope] = useState<string | null>(null);
  const setupGoalAdvanced =
    Boolean(setupGoalPageId) && advancedScope === setupScopeKey;
  if (advancedScope !== null && !setupGoalAdvanced) setAdvancedScope(null);
  function setSetupGoalAdvanced(open: boolean) {
    setAdvancedScope(open && setupGoalPageId ? setupScopeKey : null);
  }
  const brief = useSeoBrief(
    owner,
    session?.user.id,
    session?.session.activeOrganizationId ?? null,
    setupGoalAdvanced ||
      dialog === "brief" ||
      dialog === "analysis" ||
      filters.tab === "actions" ||
      (filters.tab === "agent" && data.actions.length > 0),
  );
  const setupGoalSuggestion = useSeoGoalSuggestion(
    owner,
    session?.user.id,
    session?.session.activeOrganizationId ?? null,
    setupGoalAdvanced &&
      setupGoalPageId &&
      brief.data &&
      Number.isInteger(brief.data.revision) &&
      canSetBriefPage(brief.data.pages, setupGoalPageId) &&
      !brief.data.pages.some(
        (page) => page.pageId === setupGoalPageId && page.action,
      )
      ? setupGoalPageId
      : undefined,
  );
  const statisticsSync = useSeoAutopilot({
    data,
    refreshBrief: brief.invalidate,
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
    brief,
    setupGoalAdvanced,
    setSetupGoalAdvanced,
    setupGoalPageId,
    setupGoalSuggestion,
    setupScopeKey,
    reviewGoal: reviewGoal?.scopeKey === setupScopeKey ? reviewGoal : null,
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
    shownStrategy,
    setShownStrategy,
    showStrategy,
    shownAction,
    setShownAction,
    showAction,
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
    acknowledgeReview,
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

/** A manual Run uses the frozen schedule revision. Other launches use their Core idempotency key. */
function seoLaunchKey(command: SeoCommand) {
  if (command.kind === "request_analysis") return command.body.idempotencyKey;
  if (command.kind === "create_monitor") return command.body.operationId;
  if (command.kind === "monitor_run_now")
    return `run:${command.monitorId}:${command.expectedRevision}`;
  return null;
}
