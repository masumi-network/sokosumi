"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import SettingsPanel from "@/app/personal-assistant/components/settings-panel";
import { mergeHermesMessageLists } from "@/lib/hermes/merge-persisted-messages";
import { personalityToOrbMotion } from "@/lib/hermes/personality-orb";
import type {
  HermesInstancePublic,
  HermesOrganizationOption,
  HermesPendingConfirmation,
  HermesPersistedMessage,
} from "@/lib/hermes/types";
import { orderedMessageList } from "@/lib/intl/ordered-message-list";
import AutonomyPanel from "./autonomy-panel";
import {
  AssistantMotionContext,
  AssistantSeedContext,
} from "./running-state/assistant-context";
import {
  buildTimeline,
  getPendingCards,
  getPersistedResolvedIds,
  isChatEmpty,
} from "./running-state/build-timeline";
import { ChatTimeline } from "./running-state/chat-timeline";
import { ComposerSection } from "./running-state/composer-section";
import { buildMockPendingConfirmations } from "./running-state/confirmation-mock";
import {
  AutonomyChip,
  IntegrationsChip,
  SkillsChip,
} from "./running-state/header-chips";
import {
  hasSameMessageIds,
  persistedToMessages,
} from "./running-state/message-helpers";
import type { ResolvedConfirmationEntry } from "./running-state/types";
import { useChatScroll } from "./running-state/use-chat-scroll";
import { useChatSend } from "./running-state/use-chat-send";
import { useHermesInboxSync } from "./running-state/use-hermes-inbox-sync";
import { WelcomeBlock } from "./running-state/welcome-block";
import SkillsPanel from "./skills-panel";

export interface RunningStateProps {
  userName?: string | null;
  userImageUrl?: string | null;
  /** The assistant's generative orb seed — its avatar in every message. */
  avatarSeed: string;
  /** Base seed for the curated orb palette (the user's id) — drives the
   * colour re-picker in Settings. */
  orbBaseSeed: string;
  instance: HermesInstancePublic | null;
  previewMode: boolean;
  initialMessages?: HermesPersistedMessage[];
  /** Orgs the user is a member of (for the confirmation-card dropdown). */
  organizations?: HermesOrganizationOption[];
  /** Active org from the session — pre-selected in the dropdown. */
  activeOrganizationId?: string | null;
  /** Paid coverage for chat / confirmations / settings mutations. */
  hasActiveSubscription?: boolean;
  /** Opens the subscription wall when an unpaid user tries to use PA. */
  onRequireSubscription?: () => void;
  onDestroy: () => Promise<void> | void;
  /** Re-pull the instance from the orchestrator. SettingsPanel calls this
   * after mutations so the integrations chip / autonomy badge don't drift. */
  onRefresh?: () => void | Promise<void>;
}

export default function RunningState({
  userName,
  userImageUrl,
  avatarSeed,
  orbBaseSeed,
  instance,
  previewMode,
  initialMessages,
  organizations = [],
  activeOrganizationId = null,
  hasActiveSubscription = true,
  onRequireSubscription,
  onDestroy,
  onRefresh,
}: RunningStateProps) {
  const searchParams = useSearchParams();
  const t = useTranslations("App.Hermes.Running");
  const mockReplies = orderedMessageList(
    t.raw("mockReplies") as Record<string, string>,
  );

  const [messages, setMessages] = useState(() =>
    persistedToMessages(initialMessages ?? []),
  );
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autonomyOpen, setAutonomyOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  // Dev-only mock confirmations injected via `?state=running&mock=confirmation`
  // (plus optional `&coworkerId=…&coworkerName=…`). Lets you eyeball the
  // ConfirmationCard chips without waiting for Hermes to actually emit a
  // sokosumi_create_task call. Captured once on mount; never repolls.
  const [mockConfirmations] = useState<HermesPendingConfirmation[]>(() => {
    if (!previewMode) return [];
    return buildMockPendingConfirmations(searchParams);
  });
  // Confirmations the user has already resolved this session. We snapshot
  // the full confirmation + the resolution (approved vs rejected + the org
  // they picked, when relevant) so the card can stay in the chat as a
  // read-only audit trail even after the orchestrator drops it from
  // `pendingConfirmations`. The chronological order of resolution is
  // what we render — Map iteration order preserves insertion.
  const [resolvedConfirmations, setResolvedConfirmations] = useState<
    Map<string, ResolvedConfirmationEntry>
  >(() => new Map());

  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const {
    isReplying,
    isReplyingRef,
    progressChips,
    reasoning,
    streamingId,
    requestStartedAt,
    durations,
    stepsByKey,
    sendMessage,
    stop,
  } = useChatSend({
    files,
    setFiles,
    setInput,
    messages,
    setMessages,
    mockReplies,
    previewMode,
    hasActiveSubscription,
    onRequireSubscription,
    onRefresh,
    t,
  });

  const { syncMessages } = useHermesInboxSync({
    previewMode,
    isReplyingRef,
    setMessages,
  });

  // Derived before useChatScroll so the content ResizeObserver re-attaches
  // when WelcomeBlock ↔ ChatTimeline swaps (cards alone can flip isEmpty).
  const persistedResolvedIds = getPersistedResolvedIds(messages);
  const pendingCards = getPendingCards(
    instance?.pendingConfirmations,
    mockConfirmations,
    resolvedConfirmations,
    persistedResolvedIds,
  );
  const resolvedCards = Array.from(resolvedConfirmations.values());
  const isEmpty = isChatEmpty(messages, pendingCards, resolvedCards);

  const { scrollerRef, atBottom, handleScrollerScroll, scrollToBottom } =
    useChatScroll({
      messages,
      isReplying,
      streamingId,
      isEmpty,
    });

  useEffect(() => {
    if (!initialMessages) return;
    const serverMessages = persistedToMessages(initialMessages);
    setMessages((prev) => {
      const merged = mergeHermesMessageLists(prev, serverMessages);
      return hasSameMessageIds(prev, merged) ? prev : merged;
    });
  }, [initialMessages]);

  const handleSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      sendMessage(input);
    },
    [input, sendMessage],
  );

  const handleConfirmationResolved = useCallback(
    (
      id: string,
      resolution: ResolvedConfirmationEntry["resolution"],
      resolvedConfirmation: HermesPendingConfirmation,
    ) => {
      const latestVisibleTs = Math.max(
        new Date(resolvedConfirmation.createdAt).getTime() || 0,
        ...messages.map((m) => new Date(m.createdAt).getTime() || 0),
        ...Array.from(resolvedConfirmations.values(), (e) => e.timelineTs),
      );
      setResolvedConfirmations((prev) => {
        if (prev.has(id)) return prev;
        const next = new Map(prev);
        next.set(id, {
          // Use the confirmation the card actually resolved, not
          // this map closure's capture — a background instance
          // refresh could have swapped the object for this id
          // mid-approval, storing stale metadata otherwise.
          confirmation: resolvedConfirmation,
          resolution,
          timelineTs: latestVisibleTs + 1,
        });
        return next;
      });
      // Poll a few times to surface the orchestrator's result
      // quickly rather than waiting for the next 5s tick.
      for (const delay of [1200, 3000, 6000]) {
        setTimeout(() => void syncMessages(), delay);
      }
      // Refresh the instance so the resolved gate drops out of
      // pendingConfirmations (and any follow-up gate the tool
      // queued appears) without waiting for the 30s refresh.
      void onRefresh?.();
    },
    [messages, onRefresh, resolvedConfirmations, syncMessages],
  );

  const firstName = userName?.split(" ")[0] ?? null;
  const timeline = buildTimeline(messages, resolvedConfirmations);
  const orbMotion = personalityToOrbMotion(instance?.personality);

  return (
    <AssistantSeedContext.Provider value={avatarSeed}>
      <AssistantMotionContext.Provider value={orbMotion}>
        <div className="relative flex h-full w-full flex-col overflow-hidden rounded-lg">
          {/* Floating top-right controls — Autonomy (level + scheduled
          tasks), Skills (marketplace sheet) and Settings (identity,
          integrations, danger zone). */}
          <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5">
            <AutonomyChip onClick={() => setAutonomyOpen(true)} />
            <SkillsChip onClick={() => setSkillsOpen(true)} />
            <IntegrationsChip
              integrations={instance?.integrations ?? []}
              onClick={() => setSettingsOpen(true)}
            />
          </div>

          {/* Scrollable content area — flex-grows to fill remaining height,
          composer below sits at natural height. No more manual bottom
          offset to keep in sync with the composer's height. */}
          <div
            ref={scrollerRef}
            onScroll={handleScrollerScroll}
            className="scrollbar-none min-h-0 w-full flex-1 overflow-x-hidden overflow-y-auto [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          >
            {isEmpty ? (
              <WelcomeBlock firstName={firstName} />
            ) : (
              <ChatTimeline
                timeline={timeline}
                streamingId={streamingId}
                durations={durations}
                stepsByKey={stepsByKey}
                userImageUrl={userImageUrl}
                userName={userName}
                isReplying={isReplying}
                progressChips={progressChips}
                requestStartedAt={requestStartedAt}
                reasoning={reasoning}
                pendingCards={pendingCards}
                organizations={organizations}
                activeOrganizationId={activeOrganizationId}
                hasActiveSubscription={hasActiveSubscription}
                onRequireSubscription={onRequireSubscription}
                onSelectSuggestion={(prompt) => {
                  setInput(prompt);
                  composerRef.current?.focus();
                }}
                onConfirmationResolved={handleConfirmationResolved}
              />
            )}
          </div>

          <ComposerSection
            atBottom={atBottom}
            isEmpty={isEmpty}
            isTransitioning={instance?.transitioning === true}
            isReplying={isReplying}
            input={input}
            setInput={setInput}
            files={files}
            setFiles={setFiles}
            onSubmit={handleSubmit}
            onStop={stop}
            onScrollToBottom={scrollToBottom}
            composerRef={composerRef}
            placeholder={t("composerPlaceholder")}
            sendLabel={t("send")}
            stopLabel={t("stop")}
            attachLabel={t("attach")}
            jumpToLatestLabel={t("jumpToLatest")}
            transitioningLabel={t("transitioning")}
            transitioningHintLabel={t("transitioningHint")}
          />

          <SettingsPanel
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            previewMode={previewMode}
            integrations={instance?.integrations ?? []}
            lastSokosumiSyncAt={instance?.lastSokosumiSyncAt ?? null}
            lastInboxRefreshAt={instance?.lastInboxRefreshAt ?? null}
            assistantName={instance?.assistantName ?? null}
            avatarSeed={instance?.avatarSeed ?? null}
            orbBaseSeed={orbBaseSeed}
            hasActiveSubscription={hasActiveSubscription}
            onRequireSubscription={onRequireSubscription}
            onDestroy={onDestroy}
            onRefreshInstance={onRefresh}
          />
          <AutonomyPanel
            open={autonomyOpen}
            onOpenChange={setAutonomyOpen}
            previewMode={previewMode}
            autonomyLevel={instance?.autonomyLevel ?? "medium"}
            hasActiveSubscription={hasActiveSubscription}
            onRequireSubscription={onRequireSubscription}
            onRefreshInstance={onRefresh}
          />
          <SkillsPanel
            open={skillsOpen}
            onOpenChange={setSkillsOpen}
            previewMode={previewMode}
            hasActiveSubscription={hasActiveSubscription}
            onRequireSubscription={onRequireSubscription}
          />
        </div>
      </AssistantMotionContext.Provider>
    </AssistantSeedContext.Provider>
  );
}
