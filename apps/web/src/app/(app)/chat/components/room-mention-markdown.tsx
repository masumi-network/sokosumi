"use client";

import type { ChannelLinkTarget } from "@sokosumi/utils";
import { type MutableRefObject, type ReactNode, useMemo, useRef } from "react";
import type { Components } from "react-markdown";

import Markdown from "@/components/markdown";
import type {
  ChatRoomCoworkerParticipant,
  ChatRoomOrchestratorParticipant,
} from "@/lib/clients/generated/core";

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
  orchestratorsById?: Map<string, ChatRoomOrchestratorParticipant>;
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
  lookupsRef,
  ...props
}: {
  node?: unknown;
  children?: ReactNode;
  className?: string;
  lookupsRef: MutableRefObject<RoomMentionHoverLookups>;
} & Record<string, unknown>) {
  const lookups = lookupsRef.current;
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
        orchestratorsById: lookups.orchestratorsById,
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
      openDelay={100}
      closeDelay={300}
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
  orchestratorsById,
  orchestratorsBySlug,
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
  orchestratorsById?: Map<string, ChatRoomOrchestratorParticipant>;
  orchestratorsBySlug?: Map<string, ChatRoomOrchestratorParticipant>;
  usersById?: Map<string, MentionHoverUserLookup>;
  usersBySlug?: Map<string, MentionHoverUserLookup>;
  channelLinks?: readonly ChannelLinkTarget[];
  currentUserId?: string;
  canOpenHumanDirect?: boolean;
  onOpenDirectMessage?: (profile: ChatParticipantHoverProfile) => void;
  openingDirectParticipantKey?: string | null;
  hoverInteractive?: boolean;
}) {
  const lookups: RoomMentionHoverLookups = {
    coworkersById,
    orchestratorsById,
    usersById,
    currentUserId,
    canOpenHumanDirect,
    onOpenDirect: onOpenDirectMessage,
    openingDirectParticipantKey,
    interactive: hoverInteractive,
  };
  const lookupsRef = useRef(lookups);
  lookupsRef.current = lookups;

  const components = useMemo<Components>(
    () => ({
      span: (props) => (
        <RoomMentionHoverSpan {...props} lookupsRef={lookupsRef} />
      ),
    }),
    [],
  );

  if (!content.trim()) {
    return null;
  }

  return (
    <Markdown className={markdownClassName} components={components}>
      {formatRoomMarkdownContent({
        content,
        coworkersById,
        coworkersBySlug,
        orchestratorsById,
        orchestratorsBySlug,
        usersById,
        usersBySlug,
        channelLinks,
      })}
    </Markdown>
  );
}
