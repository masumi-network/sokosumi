import type { TaskPlan, TaskPlanItem, TaskStatus } from "@sokosumi/core-client";
import { getTranslations } from "next-intl/server";
import { taskService } from "@/lib/services/task.service";
import { getTaskLinkRelationIcon } from "./task-link-relation-icon";
import { TaskRelationRow } from "./task-relation-row";

export interface TaskPlanLabels {
  title: string;
  hint: string;
  blockedBy: string;
  subtask: string;
  loopsBack: string;
  shownAbove: string;
  more: string;
  truncated: string;
}

interface PlanNode {
  item: TaskPlanItem;
  children: PlanNode[];
}

/** Depth-first rows back into a tree: each row nests under the last shallower one. */
function nestPlanItems(items: readonly TaskPlanItem[]): PlanNode[] {
  const roots: PlanNode[] = [];
  const path: PlanNode[] = [];
  for (const item of items) {
    const node: PlanNode = { item, children: [] };
    path.length = item.depth - 1;
    const parent = path.at(-1);
    (parent ? parent.children : roots).push(node);
    path.push(node);
  }
  return roots;
}

interface TaskPlanTreeProps {
  plan: TaskPlan;
  labels: TaskPlanLabels;
  statusLabels: Record<TaskStatus, string>;
}

/**
 * Blockers and sub-tasks a few links past the opened Task. Hidden when every
 * row is a direct link, since Related tasks already lists those.
 */
export function TaskPlanTree({
  plan,
  labels,
  statusLabels,
}: TaskPlanTreeProps) {
  if (!plan.items.some((item) => item.depth > 1)) return null;

  function renderNodes(nodes: PlanNode[], top: boolean) {
    return (
      <ul
        aria-label={top ? labels.title : undefined}
        className={
          top
            ? "space-y-1"
            : "border-border ms-2.5 mt-1 space-y-1 border-s ps-2"
        }
      >
        {nodes.map(({ item, children }) => {
          const Icon = getTaskLinkRelationIcon(item.relation);
          const relationLabel =
            item.relation === "blocked_by" ? labels.blockedBy : labels.subtask;
          const note =
            item.repeat === "loops_back"
              ? labels.loopsBack
              : item.repeat === "shown_above"
                ? labels.shownAbove
                : item.hasMore
                  ? labels.more
                  : null;
          return (
            <li key={`${item.depth}-${item.task.id}-${item.relation}`}>
              <div className="flex min-w-0 items-center gap-1">
                <Icon
                  role="img"
                  aria-label={relationLabel}
                  className="text-muted-foreground size-4 shrink-0"
                >
                  <title>{relationLabel}</title>
                </Icon>
                <div className="min-w-0 flex-1">
                  <TaskRelationRow
                    taskId={item.task.id}
                    taskName={item.task.name}
                    taskIdentifier={item.task.identifier}
                    taskStatus={item.task.status}
                    statusLabel={statusLabels[item.task.status]}
                  />
                </div>
              </div>
              {note ? (
                <p className="text-muted-foreground ms-5 text-xs">{note}</p>
              ) : null}
              {children.length > 0 ? renderNodes(children, false) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-muted-foreground text-xs font-medium">
          {labels.title}
        </h2>
        <p className="text-muted-foreground text-xs">{labels.hint}</p>
      </div>
      {renderNodes(nestPlanItems(plan.items), true)}
      {plan.truncated ? (
        <p className="text-muted-foreground text-xs">{labels.truncated}</p>
      ) : null}
    </section>
  );
}

interface TaskPlanSectionProps {
  taskId: string;
  statusLabels: Record<TaskStatus, string>;
}

/** Loads the plan; renders nothing when it fails or adds nothing. */
export async function TaskPlanSection({
  taskId,
  statusLabels,
}: TaskPlanSectionProps) {
  const [plan, t] = await Promise.all([
    taskService.getTaskPlan(taskId),
    getTranslations("App.Tasks.Detail"),
  ]);
  if (!plan) return null;

  return (
    <TaskPlanTree
      plan={plan}
      statusLabels={statusLabels}
      labels={{
        title: t("plan.title"),
        hint: t("plan.hint"),
        blockedBy: t("actions.relations.blockedBy"),
        subtask: t("actions.relations.subtask"),
        loopsBack: t("plan.loopsBack"),
        shownAbove: t("plan.shownAbove"),
        more: t("plan.more"),
        truncated: t("plan.truncated"),
      }}
    />
  );
}
