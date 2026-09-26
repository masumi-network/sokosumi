"use client";

import { useEveAgent } from "eve/react";
import { AlertTriangle, ArrowDown, Loader2, SendHorizonal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  CHAT_MESSAGE_LIST_CONTENT_CLASS,
  CHAT_MESSAGE_LIST_SCROLLER_CLASS,
} from "@/app/chat/chat-message-list-scroller";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { modelById, placementById, placementName } from "./catalog";
import { heldScrollTop, isScrolledUp } from "./transcript-anchor";
import type {
  StudioAsset,
  StudioCatalog,
  StudioLabels,
  StudioTarget,
} from "./types";

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

/**
 * The attempt, and what it was an attempt to say.
 *
 * The name alone was not enough. Reused for a *different* message it means
 * "create-once for this conversation", which is exactly right for a replay and
 * exactly wrong for an edit: the agent answers with the conversation the first
 * attempt created and dispatches nothing, and the edited message disappears
 * without a word. Keeping what the attempt said is what lets the two be told
 * apart.
 */
interface StudioIntent {
  id: string;
  /** The message and selection this attempt was for. */
  says: string;
}

function intentSays(
  message: string,
  asset: StudioAsset | null,
  target: StudioTarget,
): string {
  // `message` already carries model, placement, frame and resolution. The
  // two settings it does not mention are added explicitly, so no submitted
  // value can change without changing this identity.
  return JSON.stringify([
    message,
    asset?.id ?? null,
    target.settings.outputFormat ?? null,
    target.settings.seed ?? null,
  ]);
}

function readIntent(projectId: string): StudioIntent | null {
  try {
    const raw = window.sessionStorage.getItem(intentStorageKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StudioIntent>;
    return typeof parsed.id === "string" && typeof parsed.says === "string"
      ? { id: parsed.id, says: parsed.says }
      : null;
  } catch {
    // No stored attempt; this page load starts its own.
    return null;
  }
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
 * What the chips mean, written out for a model to read.
 *
 * Two carriers, on purpose. `clientContext` is the structured form the agent
 * reads programmatically; the sentence appended to the message is what a
 * person sees in the transcript afterwards. Only sending the structured form
 * would make the conversation lie about itself — the reply would be shaped by
 * a placement the transcript never mentions.
 *
 * Nothing is invented here: every value comes from the catalog entry Core
 * sent, and the placement's pixels are labelled as a target rather than as
 * the size of anything.
 */
export function describeTarget(
  catalog: StudioCatalog,
  target: StudioTarget,
  asset: StudioAsset | null,
): string {
  const parts: string[] = [];
  const models = target.modelIds
    .map((id) => modelById(catalog, id)?.label)
    .filter((label): label is string => Boolean(label));
  if (models.length > 0) parts.push(`model: ${models.join(", ")}`);

  const placement = placementById(catalog, target.placementId);
  if (placement) {
    parts.push(
      `placement: ${placementName(placement)} (${placement.aspectRatio}, target ${placement.width}x${placement.height})`,
    );
  }
  if (target.settings.aspectRatio) {
    parts.push(`frame: ${target.settings.aspectRatio}`);
  }
  if (target.settings.resolution) {
    parts.push(`resolution: ${target.settings.resolution}`);
  }
  if (asset) parts.push(`looking at: v${asset.version}`);
  return parts.join("; ");
}

/**
 * JSON, spelled out.
 *
 * eve only carries values it can serialize, and the studio's setting types
 * are interfaces rather than index-signature objects, so each field is
 * copied across explicitly. Verbose, but it is also the list of what the
 * assistant is told — worth being able to read at a glance.
 */
type TurnJson = {
  readonly [key: string]:
    | string
    | number
    | boolean
    | null
    | readonly string[]
    | TurnJson;
};

function turnContext(
  catalog: StudioCatalog,
  target: StudioTarget,
  asset: StudioAsset | null,
): TurnJson {
  const placement = placementById(catalog, target.placementId);
  return {
    modelIds: target.modelIds,
    placementId: placement?.id ?? null,
    placementLabel: placement ? placementName(placement) : null,
    placementAspectRatio: placement?.aspectRatio ?? null,
    // Named a target, not a size: it is what the platform recommends for the
    // finished asset, not what this generation will produce.
    placementTargetWidth: placement?.width ?? null,
    placementTargetHeight: placement?.height ?? null,
    settings: {
      aspectRatio: target.settings.aspectRatio ?? null,
      resolution: target.settings.resolution ?? null,
      outputFormat: target.settings.outputFormat ?? null,
      seed: target.settings.seed ?? null,
      placementId: target.settings.placementId ?? null,
    },
    selectedVersionId: asset?.id ?? null,
    selectedVersionNumber: asset?.version ?? null,
    selectedVersionPrompt: asset?.prompt ?? null,
    note: asset
      ? "The person is looking at this version. Treat 'this', 'it', and 'the image' as referring to it."
      : null,
  };
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
  catalog,
  labels,
  onActivity,
  projectId,
  resumeSessionId,
  selectedAsset,
  target,
}: {
  catalog: StudioCatalog;
  labels: StudioLabels;
  onActivity: () => void;
  projectId: string;
  resumeSessionId: string | null;
  selectedAsset: StudioAsset | null;
  target: StudioTarget;
}) {
  const [recoveredSessionId, setRecoveredSessionId] = useState<string | null>(
    null,
  );
  const sessionId = recoveredSessionId ?? resumeSessionId;
  return (
    <StudioConversation
      catalog={catalog}
      key={sessionId ?? "new"}
      labels={labels}
      onActivity={onActivity}
      onRecoverSession={setRecoveredSessionId}
      projectId={projectId}
      resumeSessionId={sessionId}
      selectedAsset={selectedAsset}
      target={target}
    />
  );
}

function StudioConversation({
  catalog,
  labels,
  onActivity,
  onRecoverSession,
  projectId,
  resumeSessionId,
  selectedAsset,
  target,
}: {
  catalog: StudioCatalog;
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
  /**
   * The model and placement chips. Sent with every turn so a request made
   * after choosing "Instagram Reels" is answered as a 9:16 Reels concept
   * rather than as whatever the assistant would have defaulted to.
   */
  target: StudioTarget;
}) {
  const draftKey = `sokosumi:image-studio:draft:${projectId}`;
  const [draft, setDraft] = useState("");
  /**
   * The attempt this client is making, while it still has no session id to
   * identify the conversation by. Read fresh on every request through the
   * `headers` resolver, so it needs no rerender to take effect.
   */
  const intentRef = useRef<StudioIntent | null>(null);
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
  const scrollerRef = useRef<HTMLDivElement>(null);
  /**
   * True while the transcript is parked above the newest message.
   *
   * The scroller is bottom-anchored (`flex-col-reverse`), so `scrollTop` is 0
   * at the newest message and negative above it. That is also why nothing
   * here writes `scrollTop`: an arriving message appends below the viewport
   * and the browser keeps the reader where they were, which is the whole
   * point — reading back through a long conversation used to be interrupted
   * every time the assistant said anything.
   */
  const [scrolledUp, setScrolledUp] = useState(false);
  /** The transcript column, watched for growth. */
  const contentRef = useRef<HTMLDivElement>(null);

  // Read the current selection inside callbacks without making them depend on
  // it; the hook's options are captured when its store is created.
  const selectedAssetRef = useRef<StudioAsset | null>(selectedAsset);
  selectedAssetRef.current = selectedAsset;
  const targetRef = useRef<StudioTarget>(target);
  targetRef.current = target;
  /** What the submission in flight is about; see `handleSubmit`. */
  const pendingSnapshotRef = useRef<{
    catalog: StudioCatalog;
    target: StudioTarget;
    asset: StudioAsset | null;
  } | null>(null);
  const catalogRef = useRef<StudioCatalog>(catalog);
  catalogRef.current = catalog;

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
    intentRef.current = readIntent(projectId);
  }, [projectId, resumeSessionId]);

  /**
   * Name this attempt, once, and keep the name until a session exists.
   *
   * Called before the first submit rather than on mount: a conversation nobody
   * has spoken into has no attempt to identify.
   */
  const claimIntent = useCallback(
    (says: string) => {
      if (intentRef.current) return;
      const intent = { id: newIntentId(), says };
      intentRef.current = intent;
      try {
        window.sessionStorage.setItem(
          intentStorageKey(projectId),
          JSON.stringify(intent),
        );
      } catch {
        // Memory-only is still enough for a same-page retry.
      }
    },
    [projectId],
  );

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
      intentRef.current ? { [INTENT_HEADER]: intentRef.current.id } : {},
    ...(resumeSessionId
      ? {
          initialSession: { sessionId: resumeSessionId, streamIndex: 0 },
          resume: true,
        }
      : {}),
    // Attach the current selection to every turn without threading it through
    // each call site. It is ephemeral per-turn context, not session history.
    prepareSend: (input) => {
      /**
       * The snapshot the submit handler took, chosen on *presence* rather
       * than on each field being truthy.
       *
       * `snap?.asset ?? selectedAssetRef.current` was wrong: a submission
       * made with nothing selected has a perfectly legitimate `asset: null`,
       * and `??` fell straight through to the live ref. Selecting an image
       * while a prewarm was in flight then put a version into the structured
       * context that the message text never mentioned — the same
       * text-and-context disagreement the snapshot exists to prevent, just
       * in the other direction.
       */
      const snap = pendingSnapshotRef.current;
      return {
        ...input,
        clientContext: turnContext(
          snap ? snap.catalog : catalogRef.current,
          snap ? snap.target : targetRef.current,
          snap ? snap.asset : selectedAssetRef.current,
        ),
      };
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
  const contextSummary = describeTarget(catalog, target, selectedAsset);

  // Keeping a reader's place while the column grows underneath them is DOM
  // synchronization, and a ResizeObserver is what actually knows when it
  // grew — a message-count dependency would miss a streaming reply, which
  // grows the same paragraph a token at a time.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;

    let previousHeight = content.scrollHeight;
    const observer = new ResizeObserver(() => {
      const nextHeight = content.scrollHeight;
      const held = heldScrollTop({
        scrollTop: scroller.scrollTop,
        previousHeight,
        nextHeight,
      });
      previousHeight = nextHeight;
      if (held !== null) scroller.scrollTop = held;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  // Read inside the submit handler without making it depend on the render.
  const agentErrorRef = useRef<Error | null>(agent.error ?? null);
  agentErrorRef.current = agent.error ?? null;

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
    const typed = draft.trim();
    if (typed.length === 0 || isResuming) return;

    /**
     * One snapshot of what this submission is about, taken now.
     *
     * The chips and the gallery selection stay changeable while an `await`
     * inside this handler is pending — `prewarm()` in particular. Reading the
     * refs again later, as `prepareSend` did, let the transcript describe one
     * selection and the structured context carry another. Both now come from
     * this single snapshot.
     */
    const snapshot = {
      catalog: catalogRef.current,
      target: targetRef.current,
      asset: selectedAssetRef.current,
    };
    pendingSnapshotRef.current = snapshot;

    // The chips ride along in the text as well as in the context, so the
    // transcript records what the reply was actually shaped by.
    const described = describeTarget(
      snapshot.catalog,
      snapshot.target,
      snapshot.asset,
    );
    const message = described ? `${typed}\n\n[${described}]` : typed;

    handleDraftChange("");
    // What goes back in the box on failure is what the person wrote, not what
    // was sent. Restoring the decorated text put the studio's own bracketed
    // summary into their draft, and a second attempt would have decorated it
    // again.
    lastSentRef.current = typed;
    try {
      // Only the first message needs a name of its own; after that the session
      // id identifies the conversation and every send is addressed to it.
      if (!agent.session) {
        // Keyed on everything this submission actually sends, not just the
        // words. The decorated message covers model, placement, frame and
        // resolution; `intentSays` adds the settings the description leaves
        // out — output format and seed — because changing only those still
        // makes it a different request, and reusing the old intent id would
        // have the agent answer it as a replay of the previous settings.
        const says = intentSays(message, snapshot.asset, snapshot.target);
        const attempt = intentRef.current;
        if (attempt && attempt.says !== says) {
          // The person changed their message before the earlier attempt's
          // outcome came back. Reusing its name would ask the agent to create
          // that conversation once — and it would answer with the one that
          // already exists, having said nothing new. So find that conversation
          // first, without saying anything, and then say the new thing into
          // it. Whatever the earlier attempt did or did not deliver stays
          // visible in the transcript rather than being guessed at.
          await agent.prewarm();
        } else {
          claimIntent(says);
        }
      }
      await agent.send(message, isBusy ? { turnPolicy: "steer" } : undefined);
      // Resolving proves the client accepted it, not that it succeeded — so
      // the outcome is read from the agent's own error state, below.
      // `typed`, not `message`: the composer holds the person's words, and
      // the studio's bracketed summary is added on the way out each time.
      if (agentErrorRef.current !== null) restoreFailedMessage(typed);
      else lastSentRef.current = null;
    } catch {
      restoreFailedMessage(typed);
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
      className="border-border bg-card-background flex h-full min-h-0 flex-col overflow-hidden rounded-xl border"
    >
      <div className="border-border shrink-0 border-b px-4 py-3">
        <h2 className="text-sm font-medium">{labels.chatTitle}</h2>
        {contextSummary ? (
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {labels.contextAttached}: {contextSummary}
          </p>
        ) : null}
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          aria-live="polite"
          className={CHAT_MESSAGE_LIST_SCROLLER_CLASS}
          onScroll={(event) => {
            // Bottom-anchored: 0 is the newest message, negative is above it.
            setScrolledUp(isScrolledUp(event.currentTarget.scrollTop));
          }}
          ref={scrollerRef}
        >
          <div
            className={cn(CHAT_MESSAGE_LIST_CONTENT_CLASS, "gap-4 p-4")}
            ref={contentRef}
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
                    <p className="break-words whitespace-pre-wrap" key={index}>
                      {part.text}
                    </p>
                  ) : part.type === "dynamic-tool" ? (
                    <p
                      className="text-muted-foreground text-xs italic"
                      key={index}
                    >
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
        </div>

        {scrolledUp ? (
          <Button
            className="absolute inset-x-0 bottom-2 mx-auto w-fit shadow-sm"
            onClick={() => {
              const node = scrollerRef.current;
              if (node) node.scrollTo({ top: 0, behavior: "smooth" });
            }}
            size="sm"
            variant="secondary"
          >
            <ArrowDown aria-hidden />
            {labels.jumpToLatest}
          </Button>
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
        className="border-border flex shrink-0 items-end gap-2 border-t p-3"
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
