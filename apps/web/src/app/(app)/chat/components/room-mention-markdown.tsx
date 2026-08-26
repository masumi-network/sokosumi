"use client";

import type { ChannelLinkTarget } from "@sokosumi/utils";
import type { ReactNode } from "react";
import type { Components } from "react-markdown";

import Markdown from "@/components/markdown";
import type { ChatRoomCoworkerParticipant } from "@/lib/clients/generated/core";

import { ChatParticipantHoverCard } from "./chat-participant-hover-card";
import { participantDirectKey } from "./open-direct-with-participant";
import {
  type ChatParticipantHoverProfile,
  chatParticipantProfileForDirectTarget,
  formatRoomMarkdownContent,
  type MentionHoverUserLookup,
  mentionDirectTargetFromAttributes,
} from "./room-helpers";

interface RoomMentionHoverLookups {
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  usersById?: Map<string, MentionHoverUserLookup>;
  currentUserId?: string;
  canOpenHumanDirect?: boolean;
  onOpenDirect?: (profile: ChatParticipantHoverProfile) => void;
  openingDirectParticipantKey?: string | null;
  interactive?: boolean;
}

function RoomMentionHoverSpan({
  node,
  children,
  className,
  lookups,
  ...props
}: {
  node?: unknown;
  children?: ReactNode;
  className?: string;
  lookups: RoomMentionHoverLookups;
} & Record<string, unknown>) {
  const nodeProperties =
    node && typeof node === "object" && "properties" in node
      ? ((node as { properties?: Record<string, unknown> }).properties ?? {})
      : {};
  const target = mentionDirectTargetFromAttributes({
    ...nodeProperties,
    ...props,
  });
  const profile = target
    ? chatParticipantProfileForDirectTarget(target, {
        coworkersById: lookups.coworkersById,
        usersById: lookups.usersById,
      })
    : null;
  const span = (
    <span className={className} {...props}>
      {children}
    </span>
  );
  if (!profile) {
    return span;
  }
  return (
    <ChatParticipantHoverCard
      profile={profile}
      currentUserId={lookups.currentUserId}
      canOpenHumanDirect={lookups.canOpenHumanDirect}
      onOpenDirect={lookups.onOpenDirect}
      isOpeningDirect={
        lookups.openingDirectParticipantKey === participantDirectKey(profile)
      }
      isDirectActionBusy={lookups.openingDirectParticipantKey != null}
      interactive={lookups.interactive ?? true}
    >
      {span}
    </ChatParticipantHoverCard>
  );
}

export function RoomMessageMarkdown({
  content,
  markdownClassName,
  coworkersById,
  coworkersBySlug,
  usersById,
  usersBySlug,
  channelLinks = [],
  currentUserId,
  canOpenHumanDirect = false,
  onOpenDirectMessage,
  openingDirectParticipantKey = null,
  hoverInteractive = true,
}: {
  content: string;
  markdownClassName?: string;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
  usersById?: Map<string, MentionHoverUserLookup>;
  usersBySlug?: Map<string, MentionHoverUserLookup>;
  channelLinks?: readonly ChannelLinkTarget[];
  currentUserId?: string;
  canOpenHumanDirect?: boolean;
  onOpenDirectMessage?: (profile: ChatParticipantHoverProfile) => void;
  openingDirectParticipantKey?: string | null;
  hoverInteractive?: boolean;
}) {
  if (!content.trim()) {
    return null;
  }

  const lookups: RoomMentionHoverLookups = {
    coworkersById,
    usersById,
    currentUserId,
    canOpenHumanDirect,
    onOpenDirect: onOpenDirectMessage,
    openingDirectParticipantKey,
    interactive: hoverInteractive,
  };

  const components: Components = {
    span: (props) => <RoomMentionHoverSpan {...props} lookups={lookups} />,
  };

  return (
    <Markdown className={markdownClassName} components={components}>
      {formatRoomMarkdownContent({
        content,
        coworkersById,
        coworkersBySlug,
        usersById,
        usersBySlug,
        channelLinks,
      })}
    </Markdown>
  );
}
