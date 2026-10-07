import type { DeveloperCoworkerRef } from "@sokosumi/core-client";

export function formatDeveloperTaskCoworkerNames(
  assignee: DeveloperCoworkerRef,
  creatorCoworker: DeveloperCoworkerRef,
): string | null {
  const names: string[] = [];

  if (assignee) {
    names.push(assignee.name);
  }

  if (creatorCoworker && (!assignee || creatorCoworker.id !== assignee.id)) {
    names.push(creatorCoworker.name);
  }

  return names.length > 0 ? names.join(" · ") : null;
}
