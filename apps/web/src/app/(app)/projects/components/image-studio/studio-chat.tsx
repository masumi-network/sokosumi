"use client";

import { useEveAgent } from "eve/react";
import { AlertTriangle, Loader2, SendHorizonal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { bindImageStudioSession } from "@/lib/actions/image-studio/action";
import { cn } from "@/lib/utils";

import type { StudioAsset, StudioLabels } from "./types";

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
  selectedAsset,
}: {
  labels: StudioLabels;
  /** Fires when the agent settles a turn, so the page can look for results. */
  onActivity: () => void;
  projectId: string;
  resumeSessionId: string | null;
  /**
   * What the person is looking at. Sent with every turn so "make this warmer"
   * has a referent — without it the agent had no way to know which version
   * "this" meant, and would have to guess or ask.
   */
  selectedAsset: StudioAsset | null;
}) {
  const draftKey = `sokosumi:image-studio:draft:${projectId}`;
  const [draft, setDraft] = useState("");
  const [tokenError, setTokenError] = useState(false);
  const [bindWarning, setBindWarning] = useState(false);
  const boundSessionRef = useRef<string | null>(resumeSessionId);
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Read the current selection inside callbacks without making them depend on
  // it; the hook's options are captured when its store is created.
  const selectedAssetRef = useRef<StudioAsset | null>(selectedAsset);
  selectedAssetRef.current = selectedAsset;

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

  /**
   * Persist the session binding, retrying until it sticks.
   *
   * The binding is what makes a conversation resumable and project-scoped, so
   * losing it to one failed request leaves a working chat that nobody can get
   * back to. The session is only recorded as bound once Core has confirmed it.
   */
  const bindSession = useCallback(
    async (eveSessionId: string, attempt = 0): Promise<void> => {
      try {
        await bindImageStudioSession({
          projectId,
          eveSessionId,
          title: null,
        });
        boundSessionRef.current = eveSessionId;
        setBindWarning(false);
      } catch {
        if (attempt >= 3) {
          setBindWarning(true);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
        await bindSession(eveSessionId, attempt + 1);
      }
    },
    [projectId],
  );

  const agent = useEveAgent({
    agent: "image-studio",
    auth: { bearer: fetchToken },
    ...(resumeSessionId
      ? {
          initialSession: { sessionId: resumeSessionId, streamIndex: 0 },
          resume: true,
        }
      : {}),
    // Attach the current selection to every turn without threading it through
    // each call site. It is ephemeral per-turn context, not session history.
    prepareSend: (input) => {
      const asset = selectedAssetRef.current;
      return asset
        ? {
            ...input,
            clientContext: {
              selectedVersionId: asset.id,
              selectedVersionNumber: asset.version,
              selectedVersionPrompt: asset.prompt,
              note: "The person is looking at this version. Treat 'this', 'it', and 'the image' as referring to it.",
            },
          }
        : input;
    },
    onSessionChange: (session) => {
      if (!session || boundSessionRef.current === session.sessionId) return;
      void bindSession(session.sessionId);
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
    try {
      await agent.send(message, isBusy ? { turnPolicy: "steer" } : undefined);
      // Cleared only once the send was accepted. Clearing first meant a
      // failed send — an expired session, no model credit — took the message
      // with it and left nothing to retry.
      handleDraftChange("");
    } catch {
      // `agent.error` renders below; the draft is still in the composer.
    }
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
            className="text-foreground text-sm leading-relaxed"
            key={message.id}
          >
            <p className="text-muted-foreground mb-1 text-xs font-medium">
              {message.role === "user" ? labels.you : labels.studio}
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
            {labels.thinking}
          </p>
        ) : null}
      </div>

      {agent.error ? (
        <div
          className="border-border text-muted-foreground border-t px-4 py-3 text-sm"
          role="alert"
        >
          <p className="text-foreground flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            {labels.assistantError}
          </p>
          <p className="mt-1 break-words">{agent.error.message}</p>
          <p className="mt-1">{labels.assistantErrorHint}</p>
        </div>
      ) : null}

      {bindWarning ? (
        <p
          className="border-border text-muted-foreground border-t px-4 py-2 text-xs"
          role="status"
        >
          {labels.bindWarning}
        </p>
      ) : null}

      <form
        className="border-border flex items-end gap-2 border-t p-3"
        onSubmit={handleSubmit}
      >
        <Textarea
          aria-label={labels.promptPlaceholder}
          className={cn("max-h-40 min-h-11 resize-none")}
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
