"use client";

import type { ChannelLinkTarget } from "@sokosumi/utils";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Pin } from "lucide-react";
import { listPinnedMessagesAction } from "@/app/chat/actions";
import type {
  ChatRoomCoworkerParticipant,
  ChatRoomPinnedMessageListItem,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { stripMarkdownToText } from "@/lib/utils/strip-markdown";
import { pickLatestPinnedMessage } from "./pick-latest-pinned-message";
import {
  type MentionHoverUserLookup,
  messageSender,
  ROOM_QUOTE_MARKDOWN_CLASSNAME,
} from "./room-helpers";
import { RoomMessageMarkdown } from "./room-mention-markdown";

export interface LatestPinnedMessageBannerLabels {
  latest: string;
  jumpToLatest: (author: string) => string;
  viewAll: string;
  count: (count: number) => string;
  couldNotLoad: string;
}

export interface LatestPinnedMessageBannerProps {
  roomId: string;
  listGeneration: number;
  labels: LatestPinnedMessageBannerLabels;
  onJump: (messageId: string) => void;
  onOpenAll: () => void;
  onIdsLoaded: (messageIds: readonly string[]) => void;
  coworkersById?: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug?: Map<string, ChatRoomCoworkerParticipant>;
  usersById?: Map<string, MentionHoverUserLookup>;
  usersBySlug?: Map<string, MentionHoverUserLookup>;
  channelLinks?: readonly ChannelLinkTarget[];
}

/** Page large enough to skip a few deleted newest pins. */
export const LATEST_PINNED_FETCH_LIMIT = 8;

const EMPTY_COWORKER_MAP = new Map<string, ChatRoomCoworkerParticipant>();
const EMPTY_USER_MAP = new Map<string, MentionHoverUserLookup>();
const EMPTY_CHANNEL_LINKS: ChannelLinkTarget[] = [];

interface LatestPinnedBannerState {
  messageId: string;
  authorName: string | null;
  content: string | null;
  total: number;
}

interface LatestPinnedMessagesPage {
  items: ChatRoomPinnedMessageListItem[];
  nextCursor: string | null;
  total: number;
}

function latestPinnedMessageQueryKey(roomId: string, listGeneration: number) {
  return ["latest-pinned-message", roomId, listGeneration] as const;
}

function flattenLatestPinnedPreview(content: string): string {
  return stripMarkdownToText(content) ?? "";
}

function selectLatestPinnedBanner(
  page: LatestPinnedMessagesPage,
): LatestPinnedBannerState | null {
  const latest = pickLatestPinnedMessage(page.items);
  if (!latest) {
    return null;
  }
  const message = latest.message;
  return {
    messageId: latest.messageId,
    authorName: message ? messageSender(message).name : null,
    content: message ? flattenLatestPinnedPreview(message.content) : null,
    total: page.total,
  };
}

export function LatestPinnedMessageBanner({
  roomId,
  listGeneration,
  labels,
  onJump,
  onOpenAll,
  onIdsLoaded,
  coworkersById = EMPTY_COWORKER_MAP,
  coworkersBySlug = EMPTY_COWORKER_MAP,
  usersById = EMPTY_USER_MAP,
  usersBySlug = EMPTY_USER_MAP,
  channelLinks = EMPTY_CHANNEL_LINKS,
}: LatestPinnedMessageBannerProps): React.ReactElement | null {
  const query = useQuery({
    queryKey: latestPinnedMessageQueryKey(roomId, listGeneration),
    queryFn: async () => {
      const result = await listPinnedMessagesAction(roomId, {
        limit: LATEST_PINNED_FETCH_LIMIT,
      });
      if (!result.ok) {
        throw new Error(result.error.message ?? undefined);
      }
      onIdsLoaded(result.value.items.map((item) => item.messageId));
      return result.value;
    },
    placeholderData: (previousData, previousQuery) => {
      if (previousQuery?.queryKey[1] !== roomId) {
        return undefined;
      }
      return keepPreviousData(previousData);
    },
    select: selectLatestPinnedBanner,
  });

  const pin = query.data;

  if (query.isPending && pin === undefined) {
    return (
      <div
        className="border-border bg-muted/40 flex h-11 shrink-0 items-stretch border-b"
        data-testid="latest-pinned-message-loading"
        aria-hidden
      >
        <div className="bg-primary/40 w-1 shrink-0" />
        <div className="flex min-w-0 flex-1 items-center gap-2 px-3 md:px-6">
          <div className="bg-muted size-3.5 animate-pulse rounded-full" />
          <div className="bg-muted h-3 w-40 animate-pulse rounded" />
        </div>
      </div>
    );
  }

  if (pin == null) {
    return null;
  }

  const authorName = pin.authorName;
  const content = pin.content;

  return (
    <div
      className="border-border bg-muted/40 flex min-h-11 shrink-0 items-stretch border-b"
      data-testid="latest-pinned-message"
      role="region"
      aria-label={labels.latest}
    >
      <div className="bg-primary w-1 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 md:px-6">
        <Pin
          className="text-primary size-3.5 shrink-0"
          fill="currentColor"
          fillOpacity={0.25}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-primary text-xs font-medium tracking-wide">
            {labels.latest}
          </p>
          {authorName != null && content != null ? (
            <button
              type="button"
              className="flex min-w-0 max-w-full cursor-pointer items-baseline gap-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              aria-label={labels.jumpToLatest(authorName)}
              onClick={() => {
                onJump(pin.messageId);
              }}
            >
              <span className="text-foreground shrink-0 font-medium">
                {authorName}
              </span>
              <span
                data-testid="latest-pinned-message-snippet"
                className="text-muted-foreground min-w-0 truncate text-sm [&_p]:inline"
              >
                <RoomMessageMarkdown
                  content={content}
                  markdownClassName={ROOM_QUOTE_MARKDOWN_CLASSNAME}
                  coworkersById={coworkersById}
                  coworkersBySlug={coworkersBySlug}
                  usersById={usersById}
                  usersBySlug={usersBySlug}
                  channelLinks={channelLinks}
                  hoverInteractive={false}
                />
              </span>
            </button>
          ) : (
            <button
              type="button"
              className="text-muted-foreground cursor-pointer truncate text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              onClick={() => {
                onOpenAll();
              }}
            >
              {labels.couldNotLoad}
            </button>
          )}
        </div>
        {pin.total > 1 ? (
          <button
            type="button"
            className={cn(
              "text-muted-foreground hover:text-foreground hover:bg-accent shrink-0 cursor-pointer rounded-full border px-2 py-0.5 text-xs font-medium",
              "outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
            title={labels.viewAll}
            aria-label={labels.viewAll}
            onClick={() => {
              onOpenAll();
            }}
          >
            {labels.count(pin.total)}
          </button>
        ) : null}
      </div>
    </div>
  );
}
