"use client";

import type {
  ProjectSeoAction,
  ProjectSeoCompetitor,
  ProjectSeoKeyword,
  ProjectSeoMetric,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
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
import {
  SEO_DEFAULT_STATISTICS_DAYS,
  type SeoStatisticsProvider,
  seoStatisticsPeriod,
} from "./seo-statistics-model";

const SEO_RUNNING_REFRESH_MS = 15_000;

// Old tab names in saved links open the tab that now holds their content.
const parseAsSeoTab = createParser<SeoTab>({
  parse: seoTab,
  serialize: (tab) => tab,
});

export type SeoDialog =
  | "page"
  | "scope"
  | "edit_scope"
  | "import"
  | "analysis"
  | "monitor"
  | "page_change"
  | "statistics"
  | "keyword"
  | "edit_keyword"
  | "competitor"
  | null;

export function useSeoWorkspace(initialData: ProjectSeoWorkspace) {
  const t = useTranslations("App.Seo");
  const { data: session } = useSession();
  const owner = seoWorkspaceOwner(initialData);
  const [chatOpen, setChatOpen] = useState(false);
  // A question another tab prepared; the chat shows it for the user to review and send.
  // send: the owner already chose this request ("Draft a fix"); otherwise it waits in the input.
  const [chatDraft, setChatDraft] = useState<{
    text: string;
    send: boolean;
  } | null>(null);
  const [filters, setFilters] = useQueryStates({
    tab: parseAsSeoTab.withDefault("agent"),
    pageId: parseAsString,
    scopeId: parseAsString,
    from: parseAsString,
    to: parseAsString,
    channel: parseAsStringLiteral(["all", "organic"]),
  });
  const query = new URLSearchParams();
  for (const key of ["pageId", "scopeId", "from", "to", "channel"] as const) {
    if (filters[key]) query.set(key, filters[key]);
  }
  const invalidDates = Boolean(
    filters.from && filters.to && filters.from > filters.to,
  );
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
  const result = useQuery<ProjectSeoWorkspace>({
    queryKey: key,
    retry: shouldRetrySeoLoad,
    queryFn: async ({ signal }) => {
      const response = await fetch(`${seoOwnerApiPath(owner)}?${query}`, {
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
    },
    initialData:
      !!session?.user.id &&
      query.toString() === initialQuery.current &&
      identity === initialIdentity
        ? initialData
        : undefined,
    // Server data seeded after a late session is not fresh enough to skip the read.
    initialDataUpdatedAt: 0,
    // Chat history waits for a read after mount; fresh server or cached data would skip it.
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
  const [keywordSearch, setKeywordSearch] = useState("");
  const [competitorSearch, setCompetitorSearch] = useState("");
  const [dialog, setDialogState] = useState<SeoDialog>(null);
  const [statisticsSource, setStatisticsSource] =
    useState<SeoStatisticsProvider>();
  const [keywordDraft, setKeywordDraft] = useState<{
    keyword: string;
    pageId: string | null;
  } | null>(null);
  function setDialog(value: SeoDialog) {
    setStatisticsSource(undefined);
    setKeywordDraft(null);
    setDialogState(value);
  }
  function openStatistics(source?: SeoStatisticsProvider) {
    setStatisticsSource(source);
    setDialogState("statistics");
  }
  const [editingKeyword, setEditingKeyword] =
    useState<ProjectSeoKeyword | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const backgroundRef = useRef<Promise<boolean> | null>(null);
  // One browser request keeps its key after an uncertain acknowledgement.
  const operationKeys = useRef(new Map<string, string>());
  // Chat turns already saved when this visit first loaded them, per viewer and Audit.
  // Kept here so switching tabs does not turn this visit's answers into history.
  const chatSeen = useRef<{ key: string; ids: Set<string> } | null>(null);
  function operationKey(input: string) {
    let value = operationKeys.current.get(input);
    if (!value) {
      value = crypto.randomUUID();
      operationKeys.current.set(input, value);
    }
    return value;
  }
  /**
   * A background command (agent upkeep) neither waits for nor blocks the user's
   * own command, keeps any open dialog, and reports only through its result.
   */
  async function execute(
    command: SeoCommand,
    success = t("saved"),
    background = false,
  ) {
    if (background) {
      // Skipped, not failed: the user's own command is running.
      if (pendingRef.current) return null;
      const run = (async () => {
        try {
          const response = await mutateSeo({ owner, command });
          if (response.ok) await refetchForViewer();
          return response.ok;
        } catch {
          return false;
        }
      })();
      backgroundRef.current = run;
      try {
        return await run;
      } finally {
        if (backgroundRef.current === run) backgroundRef.current = null;
      }
    }
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    try {
      // A user command lands after agent upkeep, so the user's result is the newest.
      await backgroundRef.current;
      const response = await mutateSeo({
        owner,
        command,
      });
      if (!response.ok) {
        toast.error(
          response.error.status === 409 ? t("conflict") : t("saveFailed"),
        );
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
  function openChat(draft?: string, send = false) {
    if (draft) setChatDraft({ text: draft, send });
    setChatOpen(true);
  }
  const data = result.data ?? initialData;
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
  /** Rerun the saved Search Console read for the current pages over the default rolling period. */
  function refreshSearchStatistics(
    saved: Pick<ProjectSeoMetric, "propertyId" | "channel">,
    background = false,
  ) {
    const period = seoStatisticsPeriod(SEO_DEFAULT_STATISTICS_DAYS);
    return execute(
      {
        kind: "sync_statistics",
        body: {
          provider: "search_console",
          propertyId: saved.propertyId,
          from: period.from,
          to: period.to,
          // The saved traffic channel, so the refreshed rows show in the same view.
          channel: saved.channel,
          ...(data.scope.id
            ? {
                scopeId: data.scope.id,
                expectedScopeVersion: data.scope.version,
              }
            : { pageIds: data.scope.pageIds }),
        },
      },
      t("statistics.synced"),
      background,
    );
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
        pageId:
          row.version > 0
            ? row.targetPageId
            : (data.pages.find((page) => page.url === row.pageUrl)?.id ?? null),
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
  return {
    chatSeen,
    data,
    viewerKey: identity,
    openChat,
    chatDraft,
    setChatDraft,
    chatOpen,
    setChatOpen,
    owner,
    filteredKeywords,
    filteredQueries,
    trackQuery,
    keywordDraft,
    refreshSearchStatistics,
    filteredCompetitors,
    toggleKeyword,
    openKeywordEdit,
    editingKeyword,
    toggleCompetitor,
    createActionTask,
    loadingScope: !result.data && !waitingForSession,
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
