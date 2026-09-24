import { convertAgentNamesToMentionOptions } from "@/app/tasks/utils/agent-names";
import type { CoworkerOption } from "@/lib/types/coworker";

export interface MentionableUser {
  id: string;
  name: string;
}

export function mentionableUsersFromAssigneeOptions(
  coworkerOptions: readonly CoworkerOption[],
): MentionableUser[] {
  return coworkerOptions
    .filter((option) => option.kind === "user")
    .map((option) => ({ id: option.id, name: option.name }));
}

export function withoutExcludedMentionUsers(
  users: readonly MentionableUser[],
  excludedIds: Iterable<string>,
): MentionableUser[] {
  const excluded = new Set(excludedIds);
  return users.filter((user) => !excluded.has(user.id));
}

export function buildTaskMentionOptions(
  agentNameById: Map<string, string>,
  mentionableUsers: readonly MentionableUser[],
): Record<string, { value: string }> {
  return {
    ...convertAgentNamesToMentionOptions(agentNameById),
    ...Object.fromEntries(
      mentionableUsers.map((user) => [user.id, { value: user.name }]),
    ),
  };
}
