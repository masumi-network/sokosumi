import { escapeMarkdownLinkLabel } from "./markdown-prose-scan.js";

/** What decides whether a Task may be sent into a chat room. */
export interface TaskChatRoomAudience {
  kind: "channel" | "direct";
  organizationId: string | null;
  discoverability: string | null;
  /** The sender's own notes: a Direct with only them in it. */
  isSelfDirect: boolean;
  /** Any Coworker or Soko Bot in the room. */
  hasAgentMembers: boolean;
  hasGuests: boolean;
}

export type TaskChatRoomRefusal =
  | "agent-members"
  | "guests"
  | "other-workspace";

/**
 * Why a Task cannot be sent into this room, or null when it can. A shared
 * Task is passive: its message names no one and starts no agent, so rooms
 * with a Coworker or Soko Bot are refused rather than risk a Direct's
 * automatic mention. The message carries the Task's title, so it stays
 * inside the Task's own organization and away from guests; a personal Task
 * can go to the sender's notes only.
 */
export function taskChatRoomRefusal(
  room: TaskChatRoomAudience,
  taskOrganizationId: string | null,
): TaskChatRoomRefusal | null {
  if (room.hasAgentMembers) return "agent-members";
  if (
    room.hasGuests ||
    room.discoverability === "external" ||
    room.discoverability === "matched"
  ) {
    return "guests";
  }
  if (room.isSelfDirect) return null;
  if (
    taskOrganizationId === null ||
    room.organizationId !== taskOrganizationId
  ) {
    return "other-workspace";
  }
  return null;
}

export interface TaskChatMessageTask {
  id: string;
  identifier: string | null;
  name: string;
}

/**
 * The chat message for a shared Task: the note, then a link labelled with
 * its identifier and title. The link names the Task by id, which resolves in
 * any workspace (offering a switch), where an identifier resolves only in the
 * active one.
 */
export function taskChatMessage(
  task: TaskChatMessageTask,
  note: string,
): string {
  const label = task.identifier ? `${task.identifier} ${task.name}` : task.name;
  const link = `[${escapeMarkdownLinkLabel(label)}](/tasks/${task.id})`;
  const cleanNote = note.trim();
  return cleanNote ? `${cleanNote}\n\n${link}` : link;
}
