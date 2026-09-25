"use client";

import { useEveAgent } from "eve/react";
import { Loader2, SendHorizonal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { bindImageStudioSession } from "@/lib/actions/image-studio/action";
import { cn } from "@/lib/utils";

import type { StudioLabels } from "./types";

/**
 * The conversation, running on the eve agent mounted at
 * `/eve/image-studio/v1/*`.
 *
 * Authentication is a short-lived token this component fetches. `auth.bearer`
 * is a function, so eve re-resolves it before every request and every stream
 * reconnect — which is also how a revoked membership stops the conversation:
 * the mint route asks Core whether this session can still see the project.
 *
 * The draft is component state, backed by `sessionStorage` per session. A
 * generation finishing elsewhere on the page re-renders the parent, and this
 * component keeps both its transcript and the half-typed message.
 */
export function StudioChat({
  labels,
  onActivity,
  projectId,
  resumeSessionId,
}: {
  labels: StudioLabels;
  /** Fires when the agent settles a turn, so the page can look for results. */
  onActivity: () => void;
  projectId: string;
  resumeSessionId: string | null;
}) {
  const draftKey = `sokosumi:image-studio:draft:${projectId}`;
  const [draft, setDraft] = useState("");
  const [tokenError, setTokenError] = useState(false);
  const boundSessionRef = useRef<string | null>(resumeSessionId);
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Restore the draft once, on mount. Storage can throw in a private window
  // or with site data blocked, so the composer must work without it.
  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(draftKey);
      if (saved) setDraft(saved);
    } catch {
      // No draft restore; nothing else depends on it.
    }
  }, [draftKey]);

  const fetchToken = useCallback(async () => {
    const response = await fetch(
      `/api/projects/${projectId}/image-studio/agent-token`,
      { method: "POST", credentials: "same-origin" },
    );
    if (!response.ok) {
      setTokenError(true);
      throw new Error("studio token unavailable");
    }
    setTokenError(false);
    const body = (await response.json()) as { token: string };
    return body.token;
  }, [projectId]);

  const agent = useEveAgent({
    agent: "image-studio",
    auth: { bearer: fetchToken },
    ...(resumeSessionId
      ? {
          initialSession: { sessionId: resumeSessionId, streamIndex: 0 },
          resume: true,
        }
      : {}),
    onSessionChange: (session) => {
      // Bind the conversation to the project the first time eve names it, so
      // a reload can resume it and so nothing else can claim that session id.
      if (!session || boundSessionRef.current === session.sessionId) return;
      boundSessionRef.current = session.sessionId;
      void bindImageStudioSession({
        projectId,
        eveSessionId: session.sessionId,
        title: null,
      }).catch(() => {
        // The conversation still works; it just will not be listed until the
        // next successful bind.
      });
    },
    onFinish: () => onActivity(),
  });

  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isResuming = agent.status === "resuming";

  // Following a growing transcript is DOM synchronization.
  useEffect(() => {
    const node = transcriptRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [agent.data.messages.length]);

  function handleDraftChange(value: string) {
    setDraft(value);
    try {
      window.sessionStorage.setItem(draftKey, value);
    } catch {
      // Draft persistence is a convenience, never a requirement.
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (message.length === 0 || isResuming) return;
    handleDraftChange("");
    await agent.send(message, isBusy ? { turnPolicy: "steer" } : undefined);
  }

  if (tokenError) {
    return (
      <section
        aria-label={labels.chatTitle}
        className="border-border bg-card-background rounded-xl border p-4"
      >
        <h2 className="text-sm font-medium">{labels.chatTitle}</h2>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          {labels.chatUnavailable}
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label={labels.chatTitle}
      className="border-border bg-card-background flex min-h-0 flex-col rounded-xl border"
    >
      <h2 className="border-border border-b px-4 py-3 text-sm font-medium">
        {labels.chatTitle}
      </h2>

      <div
        aria-live="polite"
        className="min-h-48 flex-1 space-y-4 overflow-y-auto px-4 py-4"
        ref={transcriptRef}
      >
        {agent.data.messages.length === 0 ? (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {labels.emptyBody}
          </p>
        ) : null}
        {agent.data.messages.map((message) => (
          <article
            className={cn(
              "text-sm leading-relaxed",
              message.role === "user" ? "text-foreground" : "text-foreground",
            )}
            key={message.id}
          >
            <p className="text-muted-foreground mb-1 text-xs font-medium">
              {message.role === "user" ? "You" : "Studio"}
            </p>
            {message.parts.map((part, index) =>
              part.type === "text" ? (
                <p className="whitespace-pre-wrap" key={index}>
                  {part.text}
                </p>
              ) : part.type === "dynamic-tool" ? (
                <p className="text-muted-foreground text-xs italic" key={index}>
                  {part.toolName}
                </p>
              ) : null,
            )}
          </article>
        ))}
        {isBusy ? (
          <p className="text-muted-foreground flex items-center gap-2 text-xs">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            {labels.generating}
          </p>
        ) : null}
      </div>

      <form
        className="border-border flex items-end gap-2 border-t p-3"
        onSubmit={handleSubmit}
      >
        <Textarea
          aria-label={labels.promptPlaceholder}
          className="max-h-40 min-h-11 resize-none"
          disabled={isResuming}
          onChange={(event) => handleDraftChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              void handleSubmit(event);
            }
          }}
          placeholder={labels.promptPlaceholder}
          value={draft}
        />
        <Button
          aria-label={labels.send}
          disabled={isResuming || draft.trim().length === 0}
          size="icon"
          type="submit"
        >
          <SendHorizonal aria-hidden />
        </Button>
      </form>
    </section>
  );
}
