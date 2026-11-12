import type { ChatRoom, ChatRoomMessage } from "@sokosumi/core-client";
import type { QueryClient } from "@tanstack/react-query";
import type { RoomsClientProps } from "@/app/chat/components/rooms-client";
import type { TranscriptPosition } from "@/app/chat/components/transcript-viewport";
import {
  fetchRoomMessages,
  type RoomMessagesPage,
} from "@/components/chat/fetch-room-messages";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import { getRememberedPinnedRooms } from "@/components/chat/remembered-pinned-rooms";
import { chatReadThrottleResumeInMs } from "@/lib/chat/chat-read-throttle";
import { isListedInWorkspace } from "@/lib/chat/room-workspace-scope";
import { isOutboundLocalMessage } from "./outbound-room-message";
import {
  emptyRoomTranscript,
  mergeRoomHeadPage,
  mergeRoomJumpWindow,
  ROOM_HISTORY_WINDOW_LIMIT,
  type RoomTranscript,
} from "./room-transcript-ranges";

export const ROOM_RETENTION_MS = 30 * 60 * 1000;
/** A click's head read only stands in for the open that click starts. */
const ROOM_OPEN_PREFETCH_MS = 10_000;
/**
 * How long a read an approach started serves a later approach or the click.
 * The room hears of no new message between that read and its mount, so the
 * time is short: a click follows an approach well inside it, and a later
 * click reads for itself.
 */
export const ROOM_APPROACH_REUSE_MS = 2_000;
/**
 * Reads that approaches may start inside one open window. Core refills each
 * user's chat read budget by one read a second, and every chat read on every
 * device draws on it. Approaches take at most this part of that rate.
 */
const ROOM_APPROACH_READ_LIMIT = 6;
/** How long one approach's reads cover a room. A cursor that stays near it reads once. */
const ROOM_APPROACH_REPEAT_MS = 60_000;
export interface RoomTranscriptEntry {
  bootstrap: RoomsClientProps;
  transcript: RoomTranscript;
  resolved: boolean;
  failed: boolean;
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

/** Query cache owns data; this session owns scroll positions, request coalescing and fences. */
export class RoomTranscriptCache {
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
  // Head reads started by a room click, kept until the open's first head read takes them.
  // An approach starts them too. A failed read goes at once, an untaken one with a later approach.
  private readonly prefetched = new Map<
    string,
    { revision: number; at: number; page: Promise<RoomMessagesPage | null> }
  >();
  // Open-at-unread reads started by the same click, for the visit it opens.
  private readonly prefetchedUnread = new Map<
    string,
    { at: number; page: Promise<RoomMessagesPage | null> }
  >();
  // Start times of the reads approaches started, inside the open window.
  private approachReads: number[] = [];
  // When an approach last read each room.
  private readonly approachedAt = new Map<string, number>();
  // Positions follow the retained entry's lifetime without notifying data subscribers.
  private readonly positions = new WeakMap<object, TranscriptPosition>();

  constructor(
    readonly client: QueryClient,
    private readonly userId: string,
    private readonly workspaceId: string | null,
  ) {
    this.prefix = [
      "room-transcript",
      userId,
      workspaceId ?? "personal-workspace",
    ];
    // Defaults belong to the room query type, not an accumulating auth scope.
    client.setQueryDefaults(["room-transcript"], {
      gcTime: ROOM_RETENTION_MS,
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
    return this.userId === userId && this.workspaceId === workspaceId;
  }

  /**
   * The cache of the workspace switched to. It keeps the open room when that
   * room shows in every workspace (ADR-0059), so the room stays painted. A
   * Room visit is kept the same way on a switch to the room's own workspace
   * (ADR-0061), and a Pinned room on a switch to any (ADR-0062).
   */
  forWorkspace(workspaceId: string | null, openRoomId: string | undefined) {
    const next = new RoomTranscriptCache(this.client, this.userId, workspaceId);
    const entry = openRoomId ? this.get(openRoomId) : undefined;
    const room = entry?.bootstrap.rooms.find(({ id }) => id === openRoomId);
    if (openRoomId && entry && room && this.staysListed(room, workspaceId)) {
      this.client.setQueryData(next.key(openRoomId), entry);
      const position = this.positions.get(entry.lifetime);
      if (position) next.positions.set(entry.lifetime, position);
    }
    return next;
  }

  /** The bootstrap's pin is as old as the open, and the room may be pinned since. */
  private staysListed(room: ChatRoom, workspaceId: string | null) {
    return (
      isListedInWorkspace(room, workspaceId) ||
      getRememberedPinnedRooms(this.userId).some(({ id }) => id === room.id)
    );
  }

  key(roomId: string) {
    return [...this.prefix, roomId];
  }
  get(roomId: string) {
    return this.client.getQueryData<RoomTranscriptEntry>(this.key(roomId));
  }
  current(roomId: string, lifetime: object) {
    return this.available(roomId) && this.get(roomId)?.lifetime === lifetime;
  }

  getPosition(roomId: string) {
    const lifetime = this.get(roomId)?.lifetime;
    return lifetime ? this.positions.get(lifetime) : undefined;
  }

  setPosition(roomId: string, lifetime: object, position: TranscriptPosition) {
    if (this.current(roomId, lifetime)) this.positions.set(lifetime, position);
  }

  seed(props: RoomsClientProps): RoomTranscriptEntry {
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
    update: (entry: RoomTranscriptEntry) => RoomTranscriptEntry,
  ) {
    if (!this.current(roomId, lifetime)) return;
    this.client.setQueryData<RoomTranscriptEntry>(this.key(roomId), (entry) =>
      entry ? update(entry) : undefined,
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

  /**
   * Start a room's first head read when the reader clicks it, alongside the
   * route navigation, instead of after the room mounts. A room already painted
   * from cache reads for itself on mount.
   *
   * A page proves membership: Core answers it only for a member. When it
   * lands before the room page registers, `provisional` seeds the room so it
   * paints from this read; the page's bootstrap then replaces those props.
   *
   * An approach starts the same read before the click (`approach`). The click
   * takes that read while it is new, so one room open costs one head read.
   */
  prefetch(roomId: string, provisional?: () => RoomsClientProps | null) {
    const entry = this.get(roomId);
    if (!this.available(roomId) || entry?.resolved) return;
    const page = this.approachedHead(roomId) ?? this.startHead(roomId);
    if (!provisional || entry) return;
    void page.then((head) => {
      if (!head || !this.available(roomId) || this.get(roomId)) return;
      const props = provisional();
      if (!props) return;
      this.client.setQueryData<RoomTranscriptEntry>(this.key(roomId), {
        ...this.seed(props),
        transcript: mergeRoomHeadPage(emptyRoomTranscript(), head),
        resolved: true,
      });
    });
  }

  /**
   * Start the open-at-unread read alongside the click's head read. A room
   * with Room unread waits for both before its transcript shows, so the
   * second read must not start only once the room has mounted.
   */
  prefetchUnreadWindow(roomId: string) {
    if (!this.available(roomId) || this.approachedUnreadWindow(roomId)) return;
    const page = this.fetch(roomId, { openAtUnread: true });
    this.prefetchedUnread.set(roomId, { at: Date.now(), page });
    void page.then((window) => {
      // A failed read must not stand in for the click's own.
      if (!window && this.prefetchedUnread.get(roomId)?.page === page)
        this.prefetchedUnread.delete(roomId);
    });
  }

  /**
   * Start a room's open reads when the reader heads for its link, ahead of
   * the click: the head, and the open-at-unread window when the room opens at
   * its Unread divider. Nothing paints from them until the click.
   *
   * An approach is a guess, and a pass over a list makes many. So it reads
   * nothing while chat reads are throttled, nothing for a room an approach
   * read a short time ago, and nothing once the approaches of this open
   * window have used their share of reads.
   */
  approach(roomId: string, opensAtUnread: boolean) {
    if (!this.available(roomId) || chatReadThrottleResumeInMs() > 0) return;
    const now = Date.now();
    this.approachReads = this.approachReads.filter(
      (at) => now - at < ROOM_OPEN_PREFETCH_MS,
    );
    // Reads no open took would otherwise stay for as long as the cache does.
    for (const reads of [this.prefetched, this.prefetchedUnread])
      for (const [id, { at }] of reads)
        if (now - at >= ROOM_OPEN_PREFETCH_MS) reads.delete(id);
    for (const [id, at] of this.approachedAt)
      if (now - at >= ROOM_APPROACH_REPEAT_MS) this.approachedAt.delete(id);
    if (this.approachedAt.has(roomId)) return;
    const head = !this.get(roomId)?.resolved && !this.approachedHead(roomId);
    const unreadWindow = opensAtUnread && !this.approachedUnreadWindow(roomId);
    const reads = Number(head) + Number(unreadWindow);
    if (this.approachReads.length + reads > ROOM_APPROACH_READ_LIMIT) return;
    if (reads > 0) this.approachedAt.set(roomId, now);
    for (let read = 0; read < reads; read++) this.approachReads.push(now);
    if (head) this.startHead(roomId);
    if (unreadWindow) this.prefetchUnreadWindow(roomId);
  }

  private startHead(roomId: string) {
    const page = this.fetch(roomId);
    this.prefetched.set(roomId, {
      // A seeded entry starts at revision 0.
      revision: this.get(roomId)?.revision ?? 0,
      at: Date.now(),
      page,
    });
    void page.then((head) => {
      // A failed read must not stand in for the click's own.
      if (!head && this.prefetched.get(roomId)?.page === page)
        this.prefetched.delete(roomId);
    });
    return page;
  }

  /** The head read a recent approach started against this transcript, if any. */
  private approachedHead(roomId: string) {
    const started = this.prefetched.get(roomId);
    return started &&
      started.revision === (this.get(roomId)?.revision ?? 0) &&
      Date.now() - started.at < ROOM_APPROACH_REUSE_MS
      ? started.page
      : undefined;
  }

  private approachedUnreadWindow(roomId: string) {
    const started = this.prefetchedUnread.get(roomId);
    return started != null && Date.now() - started.at < ROOM_APPROACH_REUSE_MS;
  }

  /**
   * The click's open-at-unread read, once, for the visit that click opened.
   * An approach's read stands in for the click's, for the visit that opens next.
   */
  takeUnreadWindow(roomId: string) {
    const prefetched = this.prefetchedUnread.get(roomId);
    this.prefetchedUnread.delete(roomId);
    if (!prefetched || !this.fitsOpen(prefetched.at)) return undefined;
    return prefetched.page;
  }

  /** Whether a read started at `at` is still new enough to stand in for an open. */
  private fitsOpen(at: number) {
    return Date.now() - at < ROOM_OPEN_PREFETCH_MS;
  }

  evict(roomId: string) {
    this.revoked.add(roomId);
    this.approachedAt.delete(roomId);
    this.prefetched.delete(roomId);
    this.prefetchedUnread.delete(roomId);
    for (const key of this.reads.keys()) {
      if (JSON.parse(key)[0] === roomId) this.reads.delete(key);
    }
    this.client.removeQueries({ queryKey: this.key(roomId), exact: true });
  }
  clear() {
    this.valid = false;
    this.reads.clear();
    this.prefetched.clear();
    this.prefetchedUnread.clear();
    this.approachedAt.clear();
    this.client.removeQueries({ queryKey: this.prefix });
  }

  private read(
    roomId: string,
    options?: { around?: string; cursor?: string; limit?: number },
  ) {
    const revision = this.get(roomId)?.revision;
    const key = JSON.stringify([roomId, options, revision]);
    const existing = this.reads.get(key);
    if (existing) return existing;
    const prefetched = options ? undefined : this.prefetched.get(roomId);
    if (prefetched) this.prefetched.delete(roomId);
    // A prefetched page is only as new as the transcript it was started
    // against. A failed one reads again, now with the room's access handling.
    const promise = (
      prefetched &&
      prefetched.revision === revision &&
      this.fitsOpen(prefetched.at)
        ? prefetched.page.then((page) => page ?? this.fetch(roomId, options))
        : this.fetch(roomId, options)
    ).finally(() => {
      if (this.reads.get(key) === promise) this.reads.delete(key);
    });
    this.reads.set(key, promise);
    return promise;
  }

  private fetch(
    roomId: string,
    options?: {
      around?: string;
      cursor?: string;
      limit?: number;
      openAtUnread?: boolean;
    },
  ) {
    if (chatReadThrottleResumeInMs() > 0) return Promise.resolve(null);
    const lifetime = this.get(roomId)?.lifetime;
    return fetchRoomMessages(roomId, null, options, (status) => {
      if (!lifetime || !this.current(roomId, lifetime)) return;
      if (status === 401) {
        window.dispatchEvent(new Event("chat-session-ended"));
      } else {
        notifyOrganizationChatRoomsChanged({ removedRoomId: roomId });
      }
    });
  }

  /**
   * Latest + visible dirty window; never downloads the rest of retained history.
   * `onHead` hears each head read, which names the room's Unread divider.
   */
  async refresh(
    roomId: string,
    lifetime: object,
    isCurrent: () => boolean,
    onHead?: (head: RoomMessagesPage) => void,
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
    onHead?.(head);
    if (this.get(roomId)?.revision !== revision) return "stale";
    this.update(roomId, lifetime, (value) => ({
      ...value,
      resolved: true,
      failed: false,
      transcript: reconcile(value.transcript, head),
    }));

    const position = this.getPosition(roomId);
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
      page = await this.read(roomId, {
        around: candidate.id,
        limit: ROOM_HISTORY_WINDOW_LIMIT,
      });
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
        limit: ROOM_HISTORY_WINDOW_LIMIT,
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
