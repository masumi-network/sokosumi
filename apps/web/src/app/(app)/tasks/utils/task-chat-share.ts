import type { ChatRoom } from "@sokosumi/core-client";
import { escapeMarkdownLinkLabel } from "@sokosumi/utils";

import { type TaskHrefInput, taskHref } from "./task-href";

/**
 * The rooms a Task may be sent to: the reader's own notes, and rooms of the
 * Task's own organization that take messages and hold no guests. A link never
 * grants access, but the message carries the title, so it stays inside the
 * workspace that already owns the Task. A personal Task goes to notes only.
 */
export function chatRoomsForTask(
  rooms: ChatRoom[],
  taskOrganizationId: string | null,
): ChatRoom[] {
  return rooms.filter(
    (room) =>
      !room.isReadOnly &&
      (room.isSelfDirect ||
        (taskOrganizationId !== null &&
          room.organizationId === taskOrganizationId &&
          room.discoverability !== "external" &&
          room.discoverability !== "matched")),
  );
}

/**
 * The chat message for a Task: the note, then a link labelled with its
 * identifier and title. The link is an app path, so it opens in place and is
 * never unfurled.
 */
export function taskChatMessage(task: TaskHrefInput, note: string): string {
  const label = task.identifier ? `${task.identifier} ${task.name}` : task.name;
  const link = `[${escapeMarkdownLinkLabel(label)}](${taskHref(task)})`;
  const cleanNote = note.trim();
  return cleanNote ? `${cleanNote}\n\n${link}` : link;
}
