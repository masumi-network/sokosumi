/**
 * Feedback loop for outbound timestamp chrome order.
 * Symptom: Spinner → Time → Check → Time (wrong).
 * Wanted: Spinner → Check → Time.
 */
import { act, render, screen } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import { ChatMessageRow } from "../../components/room-message-row";
import {
  confirmOutboundMessage,
  createPendingRoomMessage,
  listJustConfirmedOutboundMessageIds,
  OUTBOUND_SENT_TICK_MS,
} from "../outbound-room-message";
import {
  clearOutboundSentTicksForTests,
  markOutboundSentTick,
} from "../outbound-sent-tick";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/markdown", () => ({
  default: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <div role="tooltip">{children}</div>
  ),
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/app/chat/hooks/use-client-local-calendar-ready", () => ({
  // Always ready so wall-clock is visible immediately (not an empty <time>).
  useClientLocalCalendarReady: () => true,
}));

const senderUser = {
  id: "user-1",
  name: "Ada",
  email: "ada@example.com",
  image: null,
  presence: "online" as const,
};

function serverMessage(
  id: string,
  content: string,
  clientTurnId?: string,
): ChatRoomMessage {
  return {
    id,
    roomId: "room-1",
    parentMessageId: null,
    content,
    createdAt: new Date("2026-07-01T14:35:00.000Z"),
    editedAt: null,
    deletedAt: null,
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: clientTurnId ? { client_message_id: clientTurnId } : null,
    quote: null,
    membership: null,
    unfurls: null,
    sender: { type: "user", user: senderUser },
  };
}

type Chrome = "spinner" | "check" | "time" | "failed" | "empty";

function readChrome(): Chrome {
  if (screen.queryByTestId("outbound-delivery-pending")) {
    return "spinner";
  }
  if (screen.queryByTestId("outbound-delivery-sent")) {
    return "check";
  }
  if (screen.queryByTestId("outbound-delivery-failed-icon")) {
    return "failed";
  }
  if (screen.queryByRole("time")) {
    return "time";
  }
  return "empty";
}

/**
 * Mirrors rooms-client: messages + tick ids as separate useState.
 * `flashMode`:
 *  - "none" = confirm messages only (no tick) — bug intermediate is wall-clock
 *  - "after-messages-react-only" = set tick state after messages (no sync map)
 *  - "atomic-map-inside-updater" = mark sync registry inside setMessages updater
 *    even when React tick props stay false (production-hardened path)
 */
function DeliveryChromeHarness({
  flashMode,
}: {
  flashMode: "none" | "after-messages-react-only" | "atomic-map-inside-updater";
}) {
  const pending = createPendingRoomMessage({
    clientTurnId: "turn-1",
    roomId: "room-1",
    content: "on the train",
    senderUser,
  });
  const [messages, setMessages] = useState<ChatRoomMessage[]>([pending]);
  const [tickIds, setTickIds] = useState<ReadonlySet<string>>(() => new Set());

  const message = messages[0]!;
  const showTick = tickIds.has(message.id);

  return (
    <div>
      <button
        type="button"
        data-testid="confirm"
        onClick={() => {
          const confirmed = serverMessage("srv-1", "on the train", "turn-1");
          if (flashMode === "none") {
            setMessages((current) =>
              confirmOutboundMessage(current, confirmed, "turn-1"),
            );
            return;
          }
          if (flashMode === "after-messages-react-only") {
            let confirmedIds: string[] = [];
            setMessages((current) => {
              const next = confirmOutboundMessage(current, confirmed, "turn-1");
              confirmedIds = listJustConfirmedOutboundMessageIds(current, next);
              return next;
            });
            for (const id of confirmedIds) {
              setTickIds((prev) => new Set(prev).add(id));
            }
            return;
          }
          // Production path: arm sync map inside the messages updater so the
          // first settled paint cannot show wall-clock even if React tick
          // props are still false on that render.
          setMessages((current) => {
            const next = confirmOutboundMessage(current, confirmed, "turn-1");
            const confirmedIds = listJustConfirmedOutboundMessageIds(
              current,
              next,
            );
            for (const id of confirmedIds) {
              markOutboundSentTick([id, "turn-1"]);
            }
            return next;
          });
        }}
      >
        confirm
      </button>
      <button
        type="button"
        data-testid="clear-tick"
        onClick={() => {
          clearOutboundSentTicksForTests();
          setTickIds(new Set());
        }}
      >
        clear-tick
      </button>
      <ChatMessageRow
        message={message}
        coworkersById={new Map()}
        coworkersBySlug={new Map()}
        currentUserId="user-1"
        onToggleReaction={() => {}}
        showOutboundSentTick={showTick}
      />
    </div>
  );
}

function chromeSequenceFor(
  flashMode: "none" | "after-messages-react-only" | "atomic-map-inside-updater",
): Chrome[] {
  clearOutboundSentTicksForTests();
  const sequence: Chrome[] = [];
  render(<DeliveryChromeHarness flashMode={flashMode} />);
  sequence.push(readChrome());

  act(() => {
    screen.getByTestId("confirm").click();
  });
  sequence.push(readChrome());

  act(() => {
    screen.getByTestId("clear-tick").click();
  });
  sequence.push(readChrome());

  return sequence;
}

describe("outbound delivery chrome sequence", () => {
  it("documents the bug: confirm without tick paints time before check can appear", () => {
    const sequence = chromeSequenceFor("none");
    // pending → settled without tick → wall clock (no check phase)
    expect(sequence[0]).toBe("spinner");
    expect(sequence[1]).toBe("time");
  });

  it("sync map inside messages updater: spinner → check → time (React tick prop still false)", () => {
    const sequence = chromeSequenceFor("atomic-map-inside-updater");
    expect(sequence).toEqual(["spinner", "check", "time"]);
  });

  it("after-messages React tick state must not insert wall-clock between spinner and check", () => {
    const sequence = chromeSequenceFor("after-messages-react-only");
    expect(sequence).toEqual(["spinner", "check", "time"]);
  });

  it("listJustConfirmedOutboundMessageIds returns the server id for a pending swap", () => {
    const pending = createPendingRoomMessage({
      clientTurnId: "turn-1",
      roomId: "room-1",
      content: "on the train",
      senderUser,
    });
    const confirmed = serverMessage("srv-1", "on the train", "turn-1");
    const next = confirmOutboundMessage([pending], confirmed, "turn-1");
    expect(listJustConfirmedOutboundMessageIds([pending], next)).toEqual([
      "srv-1",
    ]);
  });

  it("OUTBOUND_SENT_TICK_MS is long enough for a visible check", () => {
    expect(OUTBOUND_SENT_TICK_MS).toBeGreaterThanOrEqual(800);
  });
});
