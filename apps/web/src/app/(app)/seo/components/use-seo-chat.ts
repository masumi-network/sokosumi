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

export function useSeoChat(model: SeoWorkspaceModel) {
  const t = useTranslations("App.Seo");
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
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
        headers: seoViewerHeaders(session?.user.id),
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
    enabled: model.chatOpen && !!auditId && !!session?.user.id,
    refetchOnWindowFocus: false,
    refetchInterval: (query) =>
      query.state.data?.turns.some((turn) => turn.status === "running")
        ? SEO_CHAT_POLL_MS
        : false,
  });
  const turns = history.data?.turns ?? [];
  const busy = sending || turns.some((turn) => turn.status === "running");
  async function send() {
    const text = question.trim();
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
    setError(null);
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
          ...seoViewerHeaders(session?.user.id),
        },
        signal: requestController.signal,
        body: JSON.stringify({ question: text, idempotencyKey, scope }),
      });
      if (!alive.current) return;
      if (response.status === 429) {
        setError(t("chat.dailyLimit"));
        return;
      }
      if (!response.ok) throw new Error("Audit reply unavailable");
      const turn: SeoAuditChatTurn = await response.json();
      if (!alive.current) return;
      queryClient.setQueryData<SeoAuditChatHistory>(key, (previous) => ({
        turns: [
          ...(previous?.turns ?? []).filter((item) => item.id !== turn.id),
          turn,
        ],
      }));
      // An acknowledged turn consumes this attempt. An uncertain response keeps it for safe replay.
      pendingAttempt.current = null;
      if (turn.status === "failed") setError(t("chat.failed"));
      else setQuestion("");
      await history.refetch();
    } catch {
      if (!alive.current) return;
      setError(t("chat.failed"));
      await history.refetch();
    } finally {
      sendingRef.current = false;
      if (controller.current === requestController) controller.current = null;
      if (alive.current) setSending(false);
    }
  }
  return { question, setQuestion, error, busy, sending, history, turns, send };
}
