import type { Coworker } from "@/lib/clients/generated/core";
import type {
  TaskEvent,
  TaskShare,
  UserSummary,
} from "@/lib/clients/generated/core/types.gen";
import type { CoreAgentDto, TaskStatus } from "@/lib/types/core-dto";

/**
 * Tasks board view model — Core `Task` / `TaskListItem` plus UI joins
 * (assignee, agents, kanban column, plain description). Built next to the
 * tasks UI via `mapTaskToTaskWithCoworker`; services must return Core DTOs.
 */
export interface TaskWithCoworker {
  id: string;
  name: string;
  status: TaskStatus;
  ownerId: string;
  owner: UserSummary;
  createdAt: string;
  updatedAt: string;
  jobsCount: number;
  assignee?: Coworker | null;
  share?: TaskShare | null;
  commentsCount: number;
  columnId: KanbanColumnId;
  description?: string | null;
  descriptionPlain?: string | null;
  events: TaskEvent[];
  agents: CoreAgentDto[];
  metadata?: string | null;
  nextRunAt?: string | null;
}

export type KanbanColumnId =
  | "backlog"
  | "todo"
  | "in-progress"
  | "input-required"
  | "done";

export interface KanbanColumnDefinition {
  id: KanbanColumnId;
  translationKey: string;
}

export const KANBAN_COLUMNS: KanbanColumnDefinition[] = [
  { id: "backlog", translationKey: "App.Tasks.Columns.backlog" },
  { id: "todo", translationKey: "App.Tasks.Columns.todo" },
  { id: "in-progress", translationKey: "App.Tasks.Columns.inProgress" },
  { id: "input-required", translationKey: "App.Tasks.Columns.inputRequired" },
  { id: "done", translationKey: "App.Tasks.Columns.done" },
];

export const COLUMN_STATUS_COLORS: Record<KanbanColumnId, string> = {
  backlog: "bg-muted-foreground",
  todo: "bg-blue-500",
  "in-progress": "bg-amber-500",
  "input-required": "bg-orange-500",
  done: "bg-emerald-500",
};
