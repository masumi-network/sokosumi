"use client";

import { useQuery } from "@tanstack/react-query";
import { Repeat } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useDebounce } from "use-debounce";
import { chatRoomHref } from "@/app/chat/utils/chat-route-base";
import { useScopeProjects } from "@/app/components/project-scope/use-scope-projects";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { getCoworkerImage } from "@/app/tasks/utils/coworker-image";
import { TASK_SCHEDULES_PATH } from "@/app/tasks/utils/task-schedule-view";
import { ChannelKindGlyph } from "@/components/chat/channel-discoverability-icon";
import { useLiveChatRoomsRead } from "@/components/chat/use-live-chat-rooms";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { coreClient } from "@/lib/clients/core.browser.client";

const GO_TO_LIMIT = 5;
const SCHEDULE_SEARCH_DEBOUNCE_MS = 250;

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
 * Search's result list, led by the Projects and channels whose name matches
 * so Search can jump to them; the dialog's other groups follow as children.
 * Mounted with the open dialog. It renders the dialog's one status region
 * just above the list, since a listbox may hold only options and groups.
 * Both lists come from the reader's own access (Core's project search, the
 * reader's room memberships). Schedules (Core's name search) and the
 * Coworkers this workspace can assign follow; a failed read of either only
 * hides its group, as Files does.
 */
export function GoToSearchList({
  query,
  activeOrganizationId,
  labels,
  onSelect,
  onNewTaskWith,
  renderStatus,
  listRef,
  listStyle,
  children,
}: {
  query: string;
  activeOrganizationId: string | null;
  labels: {
    projectsGroup: string;
    channelsGroup: string;
    schedulesGroup: string;
    coworkersGroup: string;
    newTask: string;
    newTaskWith: (name: string) => string;
  };
  onSelect: (href: string) => void;
  /** Opens New task with this Coworker; without it, no Coworkers group. */
  onNewTaskWith?: (coworkerId: string) => void;
  /** The dialog's status line, told whether these reads are still out. */
  renderStatus: (state: GoToSearchState) => ReactNode;
  listRef: (list: HTMLDivElement | null) => void;
  listStyle: CSSProperties;
  children: ReactNode;
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
  const [scheduleNeedle] = useDebounce(
    query.trim(),
    SCHEDULE_SEARCH_DEBOUNCE_MS,
  );
  const scheduleRead = useQuery({
    queryKey: ["search-schedules", activeOrganizationId, scheduleNeedle],
    queryFn: async () =>
      (
        await coreClient.listTaskSchedules({
          q: scheduleNeedle,
          limit: GO_TO_LIMIT,
        })
      ).data,
    enabled: scheduleNeedle.length > 0,
  });
  const schedules =
    typed && scheduleNeedle.length > 0 ? (scheduleRead.data ?? []) : [];
  // One read per open: the assignable Coworkers are few, so they filter here.
  const coworkerRead = useQuery({
    queryKey: ["search-coworkers", activeOrganizationId],
    queryFn: async () =>
      (await coreClient.getTaskScheduleAssignees()).data.coworkers,
    enabled: Boolean(onNewTaskWith),
  });
  const coworkers =
    typed && onNewTaskWith
      ? (coworkerRead.data ?? [])
          .filter((coworker) => coworker.name.toLowerCase().includes(needle))
          .slice(0, GO_TO_LIMIT)
      : [];
  // As the Tasks read: the debounce gap is not "loading".
  const extraPending = scheduleRead.isLoading || coworkerRead.isLoading;

  return (
    <>
      {renderStatus(
        typed
          ? {
              // A failed source is answered, not pending: its failure shows
              // once the other source answers too.
              pending:
                extraPending ||
                (rooms === null && !roomsFailed) ||
                (!scopeProjects.isError &&
                  (scopeProjects.isPending || scopeProjects.isSearchPending)),
              failed: roomsFailed || scopeProjects.isError,
              count:
                projects.length +
                channels.length +
                schedules.length +
                coworkers.length,
            }
          : IDLE_GO_TO,
      )}
      <CommandList ref={listRef} style={listStyle}>
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
        {schedules.length > 0 ? (
          <CommandGroup heading={labels.schedulesGroup}>
            {schedules.map((schedule) => (
              <CommandItem
                key={schedule.id}
                value={`schedule:${schedule.id}`}
                onSelect={() =>
                  onSelect(`${TASK_SCHEDULES_PATH}/${schedule.id}`)
                }
              >
                <Repeat aria-hidden className="size-4" />
                <span className="truncate">{schedule.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {coworkers.length > 0 && onNewTaskWith ? (
          <CommandGroup heading={labels.coworkersGroup}>
            {coworkers.map((coworker) => (
              <CommandItem
                key={coworker.id}
                value={`coworker:${coworker.id}`}
                aria-label={labels.newTaskWith(coworker.name)}
                onSelect={() => onNewTaskWith(coworker.id)}
              >
                <Avatar aria-hidden className="size-4">
                  <AvatarImage
                    src={getCoworkerImage(coworker) ?? undefined}
                    alt=""
                  />
                  <AvatarFallback className="text-2xs">
                    {coworker.name.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate">{coworker.name}</span>
                <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                  {labels.newTask}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {children}
      </CommandList>
    </>
  );
}
