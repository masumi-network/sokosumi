import type { ProjectSeoActionTask } from "@sokosumi/database";
import type { ProjectSeoWorkspace } from "@/schemas/project-seo.schema";

type VisibleTask = { id: string; status: string; completedAt: Date | null };

export function applySeoActionTaskVisibility(
  actions: ProjectSeoWorkspace["actions"],
  links: ProjectSeoActionTask[],
  tasks: VisibleTask[],
): void {
  const readable = new Map(tasks.map((task) => [task.id, task]));
  const hidden = links.filter((link) => !readable.has(link.taskId));
  const actionKey = (observationId: string, actionId: string) =>
    JSON.stringify([observationId, actionId]);
  const hiddenKeys = new Set(
    hidden.map((link) => actionKey(link.observationId, link.actionId)),
  );
  // The Task creator reuses stable opportunities across observations.
  const hiddenOpportunities = new Set(hidden.map((link) => link.actionId));
  for (const action of actions) {
    const task = action.taskId ? readable.get(action.taskId) : undefined;
    if (
      !task &&
      (action.taskId ||
        hiddenKeys.has(actionKey(action.observationId, action.id)) ||
        (action.kind === "opportunity" && hiddenOpportunities.has(action.id)))
    ) {
      action.taskId = null;
      action.status = "unavailable";
    }
    if (task?.status === "COMPLETED" && task.completedAt)
      action.completedAt = task.completedAt.toISOString();
  }
}
