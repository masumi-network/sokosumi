"use client";

import type { ReactNode } from "react";
import { chatRoomHref } from "@/app/chat/utils/chat-route-base";
import { useScopeProjects } from "@/app/components/project-scope/use-scope-projects";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { ChannelKindGlyph } from "@/components/chat/channel-discoverability-icon";
import { useLiveChatRoomsRead } from "@/components/chat/use-live-chat-rooms";
import { CommandGroup, CommandItem } from "@/components/ui/command";

const GO_TO_LIMIT = 5;

/** Where the Projects and Channels reads stand, for the dialog's status. */
export interface GoToSearchState {
  pending: boolean;
  failed: boolean;
  count: number;
}

const IDLE_GO_TO: GoToSearchState = {
  pending: false,
  failed: false,
  count: 0,
};

/**
 * Projects and channels whose name matches, so Search can jump to them.
 * Mounted with the open dialog, so it also renders the dialog's one status
 * region. Both lists come from the reader's own access (Core's project
 * search, the reader's room memberships).
 */
export function GoToSearchGroups({
  query,
  labels,
  onSelect,
  renderStatus,
}: {
  query: string;
  labels: { projectsGroup: string; channelsGroup: string };
  onSelect: (href: string) => void;
  /** The dialog's status line, told whether these reads are still out. */
  renderStatus: (state: GoToSearchState) => ReactNode;
}) {
  const needle = query.trim().toLowerCase();
  const typed = needle.length > 0;
  const scopeProjects = useScopeProjects({
    search: query,
    selectedProjectId: null,
  });
  const projects = typed ? scopeProjects.rows.slice(0, GO_TO_LIMIT) : [];
  // Null until the reader's own rooms are read; `failed` while that read
  // fails and the reader retries.
  const { rooms, failed: roomsFailed } = useLiveChatRoomsRead();
  const channels = (typed ? (rooms ?? []) : [])
    .filter(
      (room) =>
        room.kind === "channel" && room.name.toLowerCase().includes(needle),
    )
    .slice(0, GO_TO_LIMIT);

  return (
    <>
      {renderStatus(
        typed
          ? {
              // A failed source is answered, not pending: its failure shows
              // once the other source answers too.
              pending:
                (rooms === null && !roomsFailed) ||
                (!scopeProjects.isError &&
                  (scopeProjects.isPending || scopeProjects.isSearchPending)),
              failed: roomsFailed || scopeProjects.isError,
              count: projects.length + channels.length,
            }
          : IDLE_GO_TO,
      )}
      {projects.length > 0 ? (
        <CommandGroup heading={labels.projectsGroup}>
          {projects.map((project) => (
            <CommandItem
              key={project.id}
              value={`project:${project.id}`}
              onSelect={() => onSelect(`/projects/${project.id}`)}
            >
              {/* Decorative: its initial would repeat the name. */}
              <span aria-hidden className="contents">
                <ProjectAvatar
                  name={project.name}
                  logo={project.logo}
                  className="size-4 rounded-sm [&_[data-slot=avatar-fallback]]:rounded-sm"
                  fallbackClassName="text-2xs"
                />
              </span>
              <span className="truncate">{project.name}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}
      {channels.length > 0 ? (
        <CommandGroup heading={labels.channelsGroup}>
          {channels.map((room) => (
            <CommandItem
              key={room.id}
              value={`channel:${room.id}`}
              onSelect={() => onSelect(chatRoomHref(room.id))}
            >
              <ChannelKindGlyph
                discoverability={room.discoverability}
                className="size-4"
              />
              <span className="truncate">{room.name}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}
    </>
  );
}
