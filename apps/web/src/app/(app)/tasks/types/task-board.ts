import type {
  ProjectSummary,
  TaskEvent,
  TaskShare,
  TaskVisibility,
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
  visibility: TaskVisibility;
  ownerId: string;
  owner: UserSummary;
  project: ProjectSummary | null;
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
  /** ISO Run at of a Queued Task. */
  runAt?: string | null;
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
 * One hue per column, and the badges inside a column carry it too. Hue is
 * what says where a task sits, so two columns sharing one is the same bug as
 * two statuses sharing one.
 *
 * `todo` and `in-progress` were both `bg-status-working` until now, which
 * made `READY` and `RUNNING` indistinguishable at a glance and gave the board
 * three columns and two colours. `todo` takes the staged blue, which is the
 * calmer of the two because it is the column that usually holds more.
 *
 * Every pair here clears 12.27 OKLab dE in light and 14.76 in dark, measured
 * against each other and against the blue `Recent` mark in the jobs list.
 * Both floors are that mark against `backlog`; the column colours alone sit
 * further apart, at 14.13 and 19.21.
 */
export const COLUMN_STATUS_COLORS: Record<KanbanColumnId, string> = {
  backlog: "bg-status-done",
  todo: "bg-status-external",
  "in-progress": "bg-status-working",
  "input-required": "bg-semantic-warning",
  done: "bg-semantic-success",
};
