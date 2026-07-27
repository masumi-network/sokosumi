import type { OrbState } from "thinking-orbs";

import type {
  HermesOrganizationOption,
  HermesPendingConfirmation,
} from "@/lib/hermes/types";

import { ConfirmationCard } from "./confirmation-card";
import { durationKey } from "./message-helpers";
import { MessageRow } from "./message-row";
import { AssistantTyping, ProgressChips, ReasoningLine } from "./progress-ui";
import type {
  ConfirmationResolution,
  ProgressStep,
  TimelineEntry,
} from "./types";

interface ChatTimelineProps {
  timeline: TimelineEntry[];
  streamingId: string | null;
  durations: Map<string, number>;
  stepsByKey: Map<string, ProgressStep[]>;
  userImageUrl?: string | null;
  userName?: string | null;
  isReplying: boolean;
  progressChips: ProgressStep[];
  /** Live thinking-orb activity state, driven by the stream's phase frames. */
  thinkingState: OrbState;
  requestStartedAt: number | null;
  reasoning: string | null;
  pendingCards: HermesPendingConfirmation[];
  organizations: HermesOrganizationOption[];
  activeOrganizationId: string | null;
  hasActiveSubscription: boolean;
  onRequireSubscription?: () => void;
  onSelectSuggestion: (prompt: string) => void;
  onConfirmationResolved: (
    id: string,
    resolution: ConfirmationResolution,
    resolvedConfirmation: HermesPendingConfirmation,
  ) => void;
}

export function ChatTimeline({
  timeline,
  streamingId,
  durations,
  stepsByKey,
  userImageUrl,
  userName,
  isReplying,
  progressChips,
  thinkingState,
  requestStartedAt,
  reasoning,
  pendingCards,
  organizations,
  activeOrganizationId,
  hasActiveSubscription,
  onRequireSubscription,
  onSelectSuggestion,
  onConfirmationResolved,
}: ChatTimelineProps) {
  return (
    <div className="flex flex-col items-center pt-32 pb-6">
      {/* Top pad clears the absolute vertical header chip stack
          (Autonomy / Skills / Settings ≈ top-3 + 3×h-8 + gaps ≈ 7.5rem). */}
      <div className="flex w-full max-w-4xl flex-col gap-1">
        {timeline.map((item) =>
          item.kind === "message" ? (
            <MessageRow
              key={item.key}
              message={item.message}
              userImageUrl={userImageUrl}
              userName={userName}
              isStreaming={item.message.id === streamingId}
              durationMs={
                durations.get(durationKey(item.message.content)) ??
                item.message.durationMs
              }
              steps={
                stepsByKey.get(durationKey(item.message.content)) ??
                item.message.steps
              }
              onSelectSuggestion={onSelectSuggestion}
            />
          ) : (
            <ConfirmationCard
              key={item.key}
              confirmation={item.entry.confirmation}
              organizations={organizations}
              activeOrganizationId={activeOrganizationId}
              resolution={item.entry.resolution}
              hasActiveSubscription={hasActiveSubscription}
              onRequireSubscription={onRequireSubscription}
              onResolved={() => {}}
            />
          ),
        )}
        {isReplying && !streamingId ? (
          <>
            {progressChips.length > 0 ? (
              <ProgressChips
                chips={progressChips}
                startedAt={requestStartedAt}
                orbState={thinkingState}
              />
            ) : (
              <AssistantTyping
                startedAt={requestStartedAt}
                orbState={thinkingState}
              />
            )}
            {reasoning ? <ReasoningLine snippet={reasoning} /> : null}
          </>
        ) : null}
        {pendingCards.map((confirmation) => (
          <ConfirmationCard
            key={confirmation.id}
            confirmation={confirmation}
            organizations={organizations}
            activeOrganizationId={activeOrganizationId}
            resolution={null}
            hasActiveSubscription={hasActiveSubscription}
            onRequireSubscription={onRequireSubscription}
            onResolved={onConfirmationResolved}
          />
        ))}
      </div>
    </div>
  );
}
