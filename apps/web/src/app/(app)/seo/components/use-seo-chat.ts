"use client";

import type {
  SeoAuditChatHistory,
  SeoAuditChatTurn,
} from "@sokosumi/core-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useLayoutEffect, useRef, useState } from "react";
import { useSession } from "@/lib/auth/auth.client";
import { seoViewerHeaders } from "@/lib/seo/owner";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

const SEO_CHAT_POLL_MS = 2_000;
export const SEO_CHAT_QUESTION_LIMIT = 4_000;

export function useSeoChat(model: SeoWorkspaceModel, active = model.chatOpen) {
  const t = useTranslations("App.Seo");
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  // The question in flight. The thread shows it before Core answers.
  const [pending, setPending] = useState<string | null>(null);
  // The turn this panel sent last. Only its reply is announced.
  const [sentId, setSentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const alive = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const pendingAttempt = useRef<{ fingerprint: string; key: string } | null>(
    null,
  );
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
      pendingAttempt.current = null;
    };
  }, []);
  const auditId = model.data.auditId;
  const key = [
    "seo-chat",
    session?.session.activeOrganizationId,
    session?.user.id,
    auditId,
  ];
  const endpoint = `/api/seo/audits/${encodeURIComponent(auditId ?? "")}/chat`;
  const history = useQuery<SeoAuditChatHistory>({
    queryKey: key,
    queryFn: async ({ signal }) => {
      if (!alive.current)
        throw new DOMException("SEO viewer changed", "AbortError");
      const response = await fetch(endpoint, {
        signal,
        headers: seoViewerHeaders(
          session?.user.id,
          session?.session.activeOrganizationId,
        ),
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!alive.current)
        throw new DOMException("SEO viewer changed", "AbortError");
      if (!response.ok) throw new Error("Audit conversation unavailable");
      const data: SeoAuditChatHistory = await response.json();
      if (!alive.current)
        throw new DOMException("SEO viewer changed", "AbortError");
      return data;
    },
    enabled: active && !!auditId && !!session?.user.id,
    refetchOnWindowFocus: false,
    refetchInterval: (query) =>
      query.state.data?.turns.some((turn) => turn.status === "running")
        ? SEO_CHAT_POLL_MS
        : false,
  });
  const turns = history.data?.turns ?? [];
  // The first successful read in any panel fixes which turns came before this visit.
  // Kept on the workspace model, so tabs and the sheet agree.
  const identity = JSON.stringify(key);
  function remember(saved: SeoAuditChatTurn[]) {
    if (model.chatSeen.current?.key === identity) return;
    model.chatSeen.current = {
      key: identity,
      ids: new Set(
        saved
          .filter((turn) => turn.status !== "running")
          .map((turn) => turn.id),
      ),
    };
  }
  if (history.isSuccess) remember(turns);
  const seen =
    model.chatSeen.current?.key === identity
      ? model.chatSeen.current.ids
      : null;
  const busy = sending || turns.some((turn) => turn.status === "running");
  async function send(prompt?: string) {
    const text = (prompt ?? question).trim();
    if (
      !auditId ||
      !session?.user.id ||
      !text ||
      text.length > SEO_CHAT_QUESTION_LIMIT ||
      busy ||
      sendingRef.current
    )
      return;
    sendingRef.current = true;
    setSending(true);
    setPending(text);
    // The last reply is no longer the news: this question is.
    setSentId(null);
    setError(null);
    // The typed question moves to the thread at once. A send that fails puts
    // it back, ahead of anything the reader typed in the meantime.
    const typed = prompt === undefined;
    if (typed) setQuestion("");
    const restore = () => {
      if (!typed) return;
      setQuestion((current) => {
        if (!current.trim()) return text;
        const both = `${text}\n${current}`;
        return both.length > SEO_CHAT_QUESTION_LIMIT ? current : both;
      });
    };
    const scope = Object.fromEntries(
      Object.entries(model.filters).filter(
        ([name, value]) => name !== "tab" && value !== null,
      ),
    );
    const fingerprint = JSON.stringify([auditId, scope, text]);
    if (pendingAttempt.current?.fingerprint !== fingerprint)
      pendingAttempt.current = { fingerprint, key: crypto.randomUUID() };
    const idempotencyKey = pendingAttempt.current.key;
    const requestController = new AbortController();
    controller.current = requestController;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...seoViewerHeaders(
            session?.user.id,
            session?.session.activeOrganizationId,
          ),
        },
        signal: requestController.signal,
        body: JSON.stringify({ question: text, idempotencyKey, scope }),
      });
      if (!alive.current) return;
      if (response.status === 429) {
        setError(t("chat.dailyLimit"));
        restore();
        return;
      }
      if (!response.ok) throw new Error("Audit reply unavailable");
      const turn: SeoAuditChatTurn = await response.json();
      if (!alive.current) return;
      // Before the new turn enters the cache: a send ahead of the first read keeps its answer in view.
      remember(queryClient.getQueryData<SeoAuditChatHistory>(key)?.turns ?? []);
      queryClient.setQueryData<SeoAuditChatHistory>(key, (previous) => ({
        sharing: previous?.sharing ?? model.data.sharing ?? "personal",
        turns: [
          ...(previous?.turns ?? []).filter((item) => item.id !== turn.id),
          turn,
        ],
      }));
      // An acknowledged turn consumes this attempt. An uncertain response keeps it for safe replay.
      pendingAttempt.current = null;
      // The turn carries the question from here on.
      setPending(null);
      setSentId(turn.id);
      if (turn.status === "failed") {
        setError(t("chat.failed"));
        restore();
      }
      await history.refetch();
    } catch {
      if (!alive.current) return;
      setError(t("chat.failed"));
      restore();
      await history.refetch();
    } finally {
      sendingRef.current = false;
      if (controller.current === requestController) controller.current = null;
      if (alive.current) {
        setSending(false);
        setPending(null);
      }
    }
  }
  return {
    question,
    setQuestion,
    error,
    busy,
    sending,
    pending,
    sentId,
    history,
    turns,
    send,
    /** Turns saved before this visit, or null until history first loads. */
    seen,
    sharing: history.data?.sharing ?? model.data.sharing ?? "personal",
    viewerId: session?.user.id,
  };
}
