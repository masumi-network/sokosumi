import type {
  TaskEvent,
  TaskShare,
  UserSummary,
} from "@/lib/clients/generated/core/types.gen";
import type { CoreAgentDto, TaskStatus } from "@/lib/types/core-dto";

export interface TaskAssigneeView {
  id: string;
  name: string;
  image?: string | null;
  slug?: string;
  kind: "coworker" | "sokoBot" | "user";
  avatarSeed?: string | null;
}

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
  assignee?: TaskAssigneeView | null;
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

/**
 * Column marks reuse the task status ramps, so a column header and the badges
 * inside it carry the same hue. The raw palette values these replace were a
 * second colour system, which let a column mark and the badge under it paint
 * the same meaning two different shades of green.
 */
export const COLUMN_STATUS_COLORS: Record<KanbanColumnId, string> = {
  backlog: "bg-status-done",
  todo: "bg-status-queued",
  "in-progress": "bg-status-active",
  "input-required": "bg-semantic-warning",
  done: "bg-semantic-success",
};
