"use client";

import { useEveAgent } from "eve/react";
import { AlertTriangle, Loader2, SendHorizonal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
/** Failures that will not fix themselves, so the composer is replaced. */
const PERMANENT_TOKEN_CODES = new Set([
  "not_configured",
  "unauthorized",
  "not_found",
]);

/**
 * Whether a failed token mint is worth retrying.
 *
 * Keyed on the code the mint route states, not on a status number or a
 * `Retry-After` header. Keying off the header meant a 500, a 502, a 429 and
 * the route's own "Core did not answer" all hid the chat until the page was
 * reloaded. The status fallback exists only for a response with no body.
 */
export function classifyTokenFailure(
  status: number,
  code: string | undefined,
): "unavailable" | "transient" {
  const permanent = code
    ? PERMANENT_TOKEN_CODES.has(code)
    : status === 401 || status === 403 || status === 404;
  return permanent ? "unavailable" : "transient";
}

/**
 * The header this client names its creation with, so a retry of one intent
 * lands on the conversation the first attempt created.
 *
 * eve's own name for this is `operationId` in the create body, but the
 * frontend store builds that body itself from a fixed set of fields, so a
 * header is the carrier a React caller has. The agent folds the two together.
 */
const INTENT_HEADER = "x-sokosumi-studio-intent";

/**
 * A name for "this first message", stable across every retry of it.
 *
 * Without one, a create whose response never arrives leaves the browser with
 * no session id at all, and the next attempt starts a second conversation
 * saying the same thing. It is stored rather than held in memory so a reload
 * mid-attempt is still the same attempt, and it is dropped the moment a
 * session exists, because from then on the session id is the identity.
 */
function intentStorageKey(projectId: string): string {
  return `sokosumi:image-studio:intent:${projectId}`;
}

function newIntentId(): string {
  try {
    return window.crypto.randomUUID();
  } catch {
    // Insecure context or no WebCrypto: still unique enough to dedupe one
    // person's retries of one message, which is all this has to do.
    return `intent-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

/** The session id an agent error names, when it names one. */
export function recoverableSessionId(error: unknown): string | null {
  const body = (error as { body?: unknown } | null)?.body;
  if (typeof body !== "string") return null;
  try {
    const parsed = JSON.parse(body) as { sessionId?: unknown };
    return typeof parsed.sessionId === "string" && parsed.sessionId.length > 0
      ? parsed.sessionId
      : null;
  } catch {
    return null;
  }
}

/**
 * The conversation, and the one thing about it that can change identity.
 *
 * A create can answer with the id of a conversation whose first message may
 * already have been delivered — the agent says so rather than guessing, and
 * carries the id. Re-keying the conversation on that id is the recovery: the
 * transcript is replayed, so the person sees whether their message got through
 * instead of sending it into a second conversation to find out.
 */
export function StudioChat({
  labels,
  onActivity,
  projectId,
  resumeSessionId,
  selectedAsset,
}: {
  labels: StudioLabels;
  onActivity: () => void;
  projectId: string;
  resumeSessionId: string | null;
  selectedAsset: StudioAsset | null;
}) {
  const [recoveredSessionId, setRecoveredSessionId] = useState<string | null>(
    null,
  );
  const sessionId = recoveredSessionId ?? resumeSessionId;
  return (
    <StudioConversation
      key={sessionId ?? "new"}
      labels={labels}
      onActivity={onActivity}
      onRecoverSession={setRecoveredSessionId}
      projectId={projectId}
      resumeSessionId={sessionId}
      selectedAsset={selectedAsset}
    />
  );
}

function StudioConversation({
  labels,
  onActivity,
  onRecoverSession,
  projectId,
  resumeSessionId,
  selectedAsset,
}: {
  labels: StudioLabels;
  /** Fires when the agent settles a turn, so the page can look for results. */
  onActivity: () => void;
  /**
   * Attach to a conversation the agent named rather than this mount's. Used
   * once, when a creation answers that it will not guess whether the first
   * message got through.
   */
  onRecoverSession: (sessionId: string) => void;
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
  /**
   * The name this client has given its first message, while it still has no
   * session id to identify the conversation by. Read fresh on every request
   * through the `headers` resolver, so it needs no rerender to take effect.
   */
  const intentRef = useRef<string | null>(null);
  /**
   * `null` while the token works. `"unavailable"` is permanent for this page
   * load (the feature is not configured, or this session cannot see the
   * project); `"transient"` is worth another try.
   */
  const [tokenError, setTokenError] = useState<
    null | "unavailable" | "transient"
  >(null);
  /** The message currently in flight, so a later failure can put it back. */
  const lastSentRef = useRef<string | null>(null);
  /**
   * What is in the composer right now.
   *
   * Read by the failure path instead of a `setState` updater, because a
   * restore can be followed in the same batch by attaching to a recovered
   * conversation — which remounts this component, so an updater queued against
   * it may never run and the text would be lost with it.
   */
  const draftRef = useRef("");
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
      if (saved) {
        draftRef.current = saved;
        setDraft(saved);
      }
    } catch {
      // No draft restore; nothing else depends on it.
    }
  }, [draftKey]);

  // Pick up an attempt that was in flight when the page went away, so a reload
  // mid-create is still the same attempt rather than a second conversation.
  useEffect(() => {
    if (resumeSessionId) return;
    try {
      intentRef.current = window.sessionStorage.getItem(
        intentStorageKey(projectId),
      );
    } catch {
      // Without storage the intent lives for this page load only, which still
      // covers retrying a message that is sitting in the composer.
    }
  }, [projectId, resumeSessionId]);

  /**
   * Name this attempt, once, and keep the name until a session exists.
   *
   * Called before the first submit rather than on mount: a conversation nobody
   * has spoken into has no attempt to identify.
   */
  const claimIntent = useCallback(() => {
    if (intentRef.current) return;
    const intentId = newIntentId();
    intentRef.current = intentId;
    try {
      window.sessionStorage.setItem(intentStorageKey(projectId), intentId);
    } catch {
      // Memory-only is still enough for a same-page retry.
    }
  }, [projectId]);

  /** The session id is the identity from here on; the intent has done its job. */
  const releaseIntent = useCallback(() => {
    if (!intentRef.current) return;
    intentRef.current = null;
    try {
      window.sessionStorage.removeItem(intentStorageKey(projectId));
    } catch {
      // Nothing depends on the removal succeeding.
    }
  }, [projectId]);

  const fetchToken = useCallback(async () => {
    let response: Response;
    try {
      response = await fetch(
        `/api/projects/${projectId}/image-studio/agent-token`,
        { method: "POST", credentials: "same-origin" },
      );
    } catch (error) {
      // Never reached the server; retrying is reasonable.
      setTokenError("transient");
      throw error;
    }
    if (!response.ok) {
      // Classified on what the route says, not on a header. Keying off
      // `Retry-After` meant a 500, a 502, a 429 or a plain 503 all hid the
      // chat until the page was reloaded — including the route's own
      // "Core did not answer", which is the most ordinary failure there is.
      const body = (await response.json().catch(() => null)) as {
        code?: string;
      } | null;
      setTokenError(classifyTokenFailure(response.status, body?.code));
      throw new Error("studio token unavailable");
    }
    setTokenError(null);
    const body = (await response.json()) as { token: string };
    return body.token;
  }, [projectId]);

  // The conversation is recorded against this project by the agent, inside the
  // request that creates it, using the principal Core has just verified. There
  // is nothing for the browser to bind, and so nothing to sequence, retry or
  // wait for — which is what the prewarm/bind/gate arrangement here was doing,
  // and racing.

  const agent = useEveAgent({
    agent: "image-studio",
    auth: { bearer: fetchToken },
    // Resolved before every request, so the current attempt's name rides along
    // without the store being rebuilt to carry it.
    headers: (): Record<string, string> =>
      intentRef.current ? { [INTENT_HEADER]: intentRef.current } : {},
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
    onError: (error) => {
      const message = lastSentRef.current;
      lastSentRef.current = null;
      if (message) restoreFailedMessage(message);
      // The agent refused to guess whether the first message got through, and
      // named the conversation so this can stop guessing too: attach to it and
      // replay. What the person sees is then what actually happened.
      const recovered = recoverableSessionId(error);
      if (recovered && !resumeSessionId) {
        releaseIntent();
        onRecoverSession(recovered);
      }
    },
    onSessionChange: (session) => {
      if (session) releaseIntent();
    },
    onFinish: () => onActivity(),
  });

  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isResuming = agent.status === "resuming";

  // Read inside the submit handler without making it depend on the render.
  const agentErrorRef = useRef<Error | null>(agent.error ?? null);
  agentErrorRef.current = agent.error ?? null;

  // Following a growing transcript is DOM synchronization.
  useEffect(() => {
    const node = transcriptRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [agent.data.messages.length]);

  function handleDraftChange(value: string) {
    draftRef.current = value;
    setDraft(value);
    try {
      window.sessionStorage.setItem(draftKey, value);
    } catch {
      // Draft persistence is a convenience, never a requirement.
    }
  }

  /**
   * Put a failed message back, unless the person has moved on.
   *
   * The eve client catches transport and model errors internally and resolves
   * its promise, so "await the send, then clear" cleared the composer for a
   * message that never went anywhere. Clearing optimistically and restoring on
   * failure is the arrangement that survives both that and a slow send: if
   * something newer is in the box by the time the failure lands, the newer
   * text wins and the failed message is dropped rather than overwriting it.
   */
  function restoreFailedMessage(message: string) {
    if (draftRef.current.trim().length > 0) return;
    draftRef.current = message;
    try {
      window.sessionStorage.setItem(draftKey, message);
    } catch {
      // Persistence is a convenience; the restored text is what matters —
      // except across the remount a recovery causes, where storage is how it
      // survives.
    }
    setDraft(message);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (message.length === 0 || isResuming) return;

    handleDraftChange("");
    lastSentRef.current = message;
    // Only the first message needs a name of its own; after that the session
    // id identifies the conversation and every send is addressed to it.
    if (!agent.session) claimIntent();
    try {
      await agent.send(message, isBusy ? { turnPolicy: "steer" } : undefined);
      // Resolving proves the client accepted it, not that it succeeded — so
      // the outcome is read from the agent's own error state, below.
      if (agentErrorRef.current !== null) restoreFailedMessage(message);
      else lastSentRef.current = null;
    } catch {
      restoreFailedMessage(message);
    }
  }

  if (tokenError === "unavailable") {
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

      {tokenError === "transient" ? (
        <div className="border-border border-t px-4 py-3 text-sm" role="alert">
          <p className="text-muted-foreground">{labels.errorRefreshFailed}</p>
          <Button
            className="mt-2"
            onClick={() => {
              setTokenError(null);
              void fetchToken().catch(() => {});
            }}
            size="sm"
            variant="secondary"
          >
            {labels.retryConnection}
          </Button>
        </div>
      ) : null}

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
