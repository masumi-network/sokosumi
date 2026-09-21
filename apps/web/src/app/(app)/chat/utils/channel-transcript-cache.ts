import type { QueryClient } from "@tanstack/react-query";
import type { RoomsClientProps } from "@/app/chat/components/rooms-client";
import type { TranscriptPosition } from "@/app/chat/components/transcript-viewport";
import {
  fetchRoomMessages,
  type RoomMessagesPage,
} from "@/components/chat/fetch-room-messages";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import { chatReadThrottleResumeInMs } from "@/lib/chat/chat-read-throttle";
import type { ChatRoomMessage } from "@/lib/clients/generated/core";
import { isOutboundLocalMessage } from "./outbound-room-message";
import {
  emptyRoomTranscript,
  mergeRoomHeadPage,
  mergeRoomJumpWindow,
  type RoomTranscript,
} from "./room-transcript-ranges";

export const CHANNEL_RETENTION_MS = 30 * 60 * 1000;
export interface ChannelTranscriptEntry {
  bootstrap: RoomsClientProps;
  transcript: RoomTranscript;
  resolved: boolean;
  failed: boolean;
  position?: TranscriptPosition;
  dirtyIds: readonly string[];
  revision: number;
  /** Object identity fences responses from a previous incarnation of this room. */
  lifetime: object;
}

function compare(left: ChatRoomMessage, right: ChatRoomMessage): number {
  return (
    new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime() ||
    left.id.localeCompare(right.id)
  );
}

/** Only a completely read interval can prove that an absent row was deleted. */
function reconcile(
  transcript: RoomTranscript,
  page: RoomMessagesPage,
  newest?: ChatRoomMessage,
): RoomTranscript {
  const oldest = page.messages[0];
  const ids = new Set(page.messages.map((message) => message.id));
  const messages = transcript.messages.filter((message) => {
    const covered =
      (!page.nextCursor || (oldest && compare(message, oldest) >= 0)) &&
      (!newest || compare(message, newest) <= 0);
    return !covered || ids.has(message.id);
  });
  const retained = { ...transcript, messages };
  return newest
    ? mergeRoomJumpWindow(retained, page)
    : mergeRoomHeadPage(retained, page);
}

/** Query cache owns data; this session object owns only request coalescing and fences. */
export class ChannelTranscriptCache {
  readonly prefix: readonly string[];
  private valid = true;
  private readonly revoked = new Set<string>();
  activate() {
    this.valid = true;
  }
  available(roomId: string) {
    return this.valid && !this.revoked.has(roomId);
  }
  private readonly reads = new Map<string, Promise<RoomMessagesPage | null>>();

  constructor(
    readonly client: QueryClient,
    userId: string,
    workspaceId: string | null,
  ) {
    this.prefix = [
      "channel-transcript",
      userId,
      workspaceId ?? "personal-workspace",
    ];
    client.setQueryDefaults(this.prefix, {
      gcTime: CHANNEL_RETENTION_MS,
      staleTime: Infinity,
      enabled: false,
      retry: false,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      structuralSharing: false,
    });
  }

  matchesScope(userId: string, workspaceId: string | null) {
    return (
      this.prefix[1] === userId &&
      this.prefix[2] === (workspaceId ?? "personal-workspace")
    );
  }

  key(roomId: string) {
    return [...this.prefix, roomId];
  }
  get(roomId: string) {
    return this.client.getQueryData<ChannelTranscriptEntry>(this.key(roomId));
  }
  current(roomId: string, lifetime: object) {
    return this.available(roomId) && this.get(roomId)?.lifetime === lifetime;
  }

  seed(props: RoomsClientProps): ChannelTranscriptEntry {
    const roomId = props.selectedRoomId ?? "";
    const existing = this.get(roomId);
    if (existing) return existing;
    const resolved =
      !props.messagesPromise &&
      !props.loadHistoryOnClient &&
      !props.messageLoadFailed;
    return {
      bootstrap: {
        ...props,
        messages: [],
        messagesPromise: undefined,
        loadHistoryOnClient: true,
      },
      transcript: resolved
        ? mergeRoomHeadPage(emptyRoomTranscript(), {
            messages: props.messages,
            nextCursor: props.messagesNextCursor,
          })
        : emptyRoomTranscript(),
      resolved,
      failed: props.messageLoadFailed,
      dirtyIds: [],
      revision: 0,
      lifetime: {},
    };
  }

  update(
    roomId: string,
    lifetime: object,
    update: (entry: ChannelTranscriptEntry) => ChannelTranscriptEntry,
  ) {
    if (!this.current(roomId, lifetime)) return;
    this.client.setQueryData<ChannelTranscriptEntry>(
      this.key(roomId),
      (entry) => (entry ? update(entry) : undefined),
    );
  }

  setTranscript(
    roomId: string,
    lifetime: object,
    update: (transcript: RoomTranscript) => RoomTranscript,
  ) {
    this.update(roomId, lifetime, (entry) => {
      const transcript = update(entry.transcript);
      return {
        ...entry,
        transcript: {
          ...transcript,
          messages: transcript.messages.filter(
            (message) => !isOutboundLocalMessage(message),
          ),
        },
        revision: entry.revision + 1,
      };
    });
  }

  markDirty(roomId: string) {
    const entry = this.get(roomId);
    if (entry)
      this.update(roomId, entry.lifetime, (value) => ({
        ...value,
        dirtyIds: value.transcript.messages.map((message) => message.id),
      }));
  }

  joined(roomId: string) {
    this.revoked.delete(roomId);
  }

  evict(roomId: string) {
    this.revoked.add(roomId);
    for (const key of this.reads.keys()) {
      if (JSON.parse(key)[0] === roomId) this.reads.delete(key);
    }
    this.client.removeQueries({ queryKey: this.key(roomId), exact: true });
  }
  clear() {
    this.valid = false;
    this.reads.clear();
    this.client.removeQueries({ queryKey: this.prefix });
  }

  private read(
    roomId: string,
    options?: { around?: string; cursor?: string; limit?: number },
  ) {
    const key = JSON.stringify([roomId, options, this.get(roomId)?.revision]);
    const existing = this.reads.get(key);
    if (existing) return existing;
    if (chatReadThrottleResumeInMs() > 0) return Promise.resolve(null);
    const lifetime = this.get(roomId)?.lifetime;
    const promise = fetchRoomMessages(roomId, null, options, (status) => {
      if (!lifetime || !this.current(roomId, lifetime)) return;
      if (status === 401) {
        window.dispatchEvent(new Event("chat-session-ended"));
      } else {
        notifyOrganizationChatRoomsChanged({ removedRoomId: roomId });
      }
    }).finally(() => {
      if (this.reads.get(key) === promise) this.reads.delete(key);
    });
    this.reads.set(key, promise);
    return promise;
  }

  /** Latest + visible dirty window; never downloads the rest of retained history. */
  async refresh(
    roomId: string,
    lifetime: object,
    isCurrent: () => boolean,
  ): Promise<"stale" | "done"> {
    const entry = this.get(roomId);
    if (!entry || !this.current(roomId, lifetime)) return "done";
    const revision = entry.revision;
    const current = () => isCurrent() && this.current(roomId, lifetime);
    const head = await this.read(roomId);
    if (!current()) return "done";
    if (!head) {
      this.update(roomId, lifetime, (value) => ({
        ...value,
        failed: !value.resolved,
      }));
      return "done";
    }
    if (this.get(roomId)?.revision !== revision) return "stale";
    this.update(roomId, lifetime, (value) => ({
      ...value,
      resolved: true,
      failed: false,
      transcript: reconcile(value.transcript, head),
    }));

    const position = this.get(roomId)?.position;
    const visibleIds = position?.visibleMessageIds ?? [];
    const visible = entry.transcript.messages.filter((message) =>
      visibleIds.includes(message.id),
    );
    const oldest = visible[0];
    const newest = visible.at(-1);
    if (
      !oldest ||
      !newest ||
      !visible.some((message) => entry.dirtyIds.includes(message.id))
    )
      return "done";
    // A head response already proves the visible interval when it reaches it.
    if (
      !head.nextCursor ||
      (head.messages[0] && compare(head.messages[0], oldest) <= 0)
    ) {
      this.cleanInterval(roomId, lifetime, oldest, newest);
      return "done";
    }
    // Try the window's upper boundary, then surviving retained boundaries to
    // its right. A missing around target is not evidence of lost room access.
    let page: RoomMessagesPage | null = null;
    const candidates = entry.transcript.messages
      .filter((message) => compare(message, newest) >= 0)
      .slice(0, 3);
    for (const candidate of candidates) {
      page = await this.read(roomId, { around: candidate.id, limit: 30 });
      if (!current()) return "done";
      if (page?.messages.at(-1) && compare(page.messages.at(-1)!, newest) >= 0)
        break;
      page = null;
    }
    if (!page) page = head;
    let pages = 0;
    // Bounded work. Partial coverage keeps all cached rows and stays dirty.
    while (
      page.nextCursor &&
      (!page.messages[0] || compare(page.messages[0], oldest) > 0) &&
      pages++ < 8
    ) {
      const older = await this.read(roomId, {
        cursor: page.nextCursor,
        limit: 30,
      });
      if (!current()) return "done";
      if (!older || older.nextCursor === page.nextCursor) return "done";
      page = {
        messages: [...older.messages, ...page.messages],
        nextCursor: older.nextCursor,
      };
    }
    if (!current()) return "done";
    if (this.get(roomId)?.revision !== revision) return "stale";
    if (
      page.nextCursor &&
      (!page.messages[0] || compare(page.messages[0], oldest) > 0)
    )
      return "done";
    this.update(roomId, lifetime, (value) => ({
      ...value,
      transcript: reconcile(value.transcript, page!, newest),
    }));
    this.cleanInterval(roomId, lifetime, oldest, newest);
    return "done";
  }

  private cleanInterval(
    roomId: string,
    lifetime: object,
    oldest: ChatRoomMessage,
    newest: ChatRoomMessage,
  ) {
    this.update(roomId, lifetime, (value) => ({
      ...value,
      dirtyIds: value.dirtyIds.filter((id) => {
        const message = value.transcript.messages.find((row) => row.id === id);
        return (
          message &&
          (compare(message, oldest) < 0 || compare(message, newest) > 0)
        );
      }),
    }));
  }
}
