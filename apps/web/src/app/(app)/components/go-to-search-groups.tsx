"use client";

import { chatRoomHref } from "@/app/chat/utils/chat-route-base";
import { useScopeProjects } from "@/app/components/project-scope/use-scope-projects";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { ChannelKindGlyph } from "@/components/chat/channel-discoverability-icon";
import { useLiveChatRooms } from "@/components/chat/use-live-chat-rooms";
import { CommandGroup, CommandItem } from "@/components/ui/command";

const GO_TO_LIMIT = 5;

/**
 * Projects and channels whose name matches, so Search can jump to them.
 * Mounted only while a query is typed: both lists come from the reader's own
 * access (Core's project search, the reader's room memberships).
 */
export function GoToSearchGroups({
  query,
  labels,
  onSelect,
}: {
  query: string;
  labels: { projectsGroup: string; channelsGroup: string };
  onSelect: (href: string) => void;
}) {
  const needle = query.trim().toLowerCase();
  const projects = useScopeProjects({
    search: query,
    selectedProjectId: null,
  }).rows.slice(0, GO_TO_LIMIT);
  const channels = (useLiveChatRooms() ?? [])
    .filter(
      (room) =>
        room.kind === "channel" && room.name.toLowerCase().includes(needle),
    )
    .slice(0, GO_TO_LIMIT);

  return (
    <>
      {projects.length > 0 ? (
        <CommandGroup heading={labels.projectsGroup}>
          {projects.map((project) => (
            <CommandItem
              key={project.id}
              value={`project:${project.id}`}
              onSelect={() => onSelect(`/projects/${project.id}`)}
            >
              <ProjectAvatar
                name={project.name}
                logo={project.logo}
                className="size-4 rounded-sm [&_[data-slot=avatar-fallback]]:rounded-sm"
                fallbackClassName="text-2xs"
              />
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
