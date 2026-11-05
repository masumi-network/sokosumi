"use client";

import type {
  ProjectSeoAction,
  ProjectSeoCompetitor,
  ProjectSeoKeyword,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ensureSokoBotDirectRoomAction } from "@/app/chat/actions";
import { SEO_TABS } from "@/app/seo/seo-query";
import { mutateProjectSeo } from "@/lib/actions/seo/action";
import type { SeoCommand } from "@/lib/actions/seo/types";
import { useSession } from "@/lib/auth/auth.client";

const SEO_RUNNING_REFRESH_MS = 15_000;

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
  | "competitor"
  | null;

export function useSeoWorkspace(
  initialData: ProjectSeoWorkspace,
  sokoBotId: string | null = null,
) {
  const t = useTranslations("App.Seo");
  const { data: session } = useSession();
  const router = useRouter();
  const [openingChat, setOpeningChat] = useState(false);
  const openingChatRef = useRef(false);
  const [filters, setFilters] = useQueryStates({
    tab: parseAsStringLiteral(SEO_TABS).withDefault("overview"),
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
  const initialIdentity = useRef(identity);
  const key = [
    "seo-workspace",
    session?.session.activeOrganizationId,
    session?.user.id,
    initialData.projectId,
    query.toString(),
  ];
  const result = useQuery<ProjectSeoWorkspace>({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/projects/${initialData.projectId}/seo?${query}`,
        { signal, credentials: "same-origin", cache: "no-store" },
      );
      if (!response.ok) throw new Error("SEO workspace unavailable");
      return response.json();
    },
    initialData:
      query.toString() === initialQuery.current &&
      identity === initialIdentity.current
        ? initialData
        : undefined,
    enabled: !invalidDates,
    refetchOnWindowFocus: false,
    refetchInterval: (state) =>
      state.state.data?.analyses.some(
        (analysis) =>
          analysis.status === "requested" || analysis.status === "running",
      )
        ? SEO_RUNNING_REFRESH_MS
        : false,
  });
  const [keywordSearch, setKeywordSearch] = useState("");
  const [competitorSearch, setCompetitorSearch] = useState("");
  const [dialog, setDialog] = useState<SeoDialog>(null);
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
      const response = await mutateProjectSeo({
        projectId: initialData.projectId,
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
      await result.refetch();
      return true;
    } catch {
      toast.error(t("saveFailed"));
      return false;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  async function openChat() {
    if (!sokoBotId || openingChatRef.current) return;
    openingChatRef.current = true;
    setOpeningChat(true);
    try {
      const result = await ensureSokoBotDirectRoomAction(sokoBotId);
      if (!result.ok || !result.value) {
        toast.error(t("openChatFailed"));
        return;
      }
      router.push(`/chat/rooms/${encodeURIComponent(result.value.id)}`);
    } catch {
      toast.error(t("openChatFailed"));
    } finally {
      openingChatRef.current = false;
      setOpeningChat(false);
    }
  }
  const data = result.data ?? initialData;
  const filteredKeywords = data.keywords.filter((row) =>
    row.keyword.toLocaleLowerCase().includes(keywordSearch.toLocaleLowerCase()),
  );
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
        pageId: data.pages.find((page) => page.url === row.pageUrl)?.id ?? null,
        priority: row.priority,
        saved: !row.saved,
        ...(row.version > 0 ? { expectedVersion: row.version } : {}),
      },
    });
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
    data,
    openChat,
    openingChat,
    filteredKeywords,
    filteredCompetitors,
    toggleKeyword,
    toggleCompetitor,
    createActionTask,
    loadingScope: !result.data,
    filters,
    setFilters,
    result,
    invalidDates,
    dialog,
    setDialog,
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
