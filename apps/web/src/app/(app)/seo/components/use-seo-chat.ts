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

/** One record per viewer and Audit: the chat sheet and the Agent tab read the same one. */
const seoChatKey = (
  organizationId: string | null | undefined,
  userId: string | undefined,
  auditId: string | null | undefined,
) => ["seo-chat", organizationId, userId, auditId];
const seoChatEndpoint = (auditId: string | null | undefined) =>
  `/api/seo/audits/${encodeURIComponent(auditId ?? "")}/chat`;
/** A reply that is still in work is read again until it ends. */
const seoChatPoll = (history: SeoAuditChatHistory | undefined) =>
  (history?.turns ?? []).some((turn) => turn.status === "running")
    ? SEO_CHAT_POLL_MS
    : false;

/** One read of the conversation, for both readers of the record. */
async function readSeoChat(
  auditId: string | null | undefined,
  userId: string | undefined,
  organizationId: string | null | undefined,
  signal: AbortSignal,
): Promise<SeoAuditChatHistory> {
  const response = await fetch(seoChatEndpoint(auditId), {
    signal,
    headers: seoViewerHeaders(userId, organizationId),
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("Audit conversation unavailable");
  return response.json();
}

export function useSeoChat(model: SeoWorkspaceModel) {
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
  const key = seoChatKey(
    session?.session.activeOrganizationId,
    session?.user.id,
    auditId,
  );
  const endpoint = seoChatEndpoint(auditId);
  const history = useQuery<SeoAuditChatHistory>({
    queryKey: key,
    queryFn: async ({ signal }) => {
      if (!alive.current)
        throw new DOMException("SEO viewer changed", "AbortError");
      const data = await readSeoChat(
        auditId,
        session?.user.id,
        session?.session.activeOrganizationId,
        signal,
      );
      if (!alive.current)
        throw new DOMException("SEO viewer changed", "AbortError");
      return data;
    },
    enabled: model.chatOpen && !!auditId && !!session?.user.id,
    // The Agent tab reads the same record: the sheet still reads it new each time it opens.
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => seoChatPoll(query.state.data),
  });
  const turns = history.data?.turns ?? [];
  const busy = sending || turns.some((turn) => turn.status === "running");
  /**
   * Sends the typed question, or `prompt`. A typed question comes back to the
   * field when its send fails; a prompt does not.
   */
  async function send(prompt?: string) {
    const text = (prompt ?? question).trim();
    if (!auditId || !session?.user.id || !text || busy || sendingRef.current)
      return;
    // Only a restored question can pass the field's own limit. The reason
    // shows below until the reader shortens the text.
    if (text.length > SEO_CHAT_QUESTION_LIMIT) {
      setError(null);
      return;
    }
    sendingRef.current = true;
    setSending(true);
    setPending(text);
    // The last reply is no longer the news: this question is.
    setSentId(null);
    setError(null);
    // The typed question moves to the thread at once. A send that fails puts
    // it back, ahead of anything the reader typed in the meantime.
    if (prompt === undefined) setQuestion("");
    const restore = () => {
      if (prompt !== undefined) return;
      setQuestion((current) => (current.trim() ? `${text}\n${current}` : text));
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
    error:
      error ??
      (question.trim().length > SEO_CHAT_QUESTION_LIMIT
        ? t("chat.tooLong", { limit: SEO_CHAT_QUESTION_LIMIT })
        : null),
    busy,
    sending,
    pending,
    sentId,
    history,
    turns,
    send,
    sharing: history.data?.sharing ?? model.data.sharing ?? "personal",
    viewerId: session?.user.id,
  };
}
