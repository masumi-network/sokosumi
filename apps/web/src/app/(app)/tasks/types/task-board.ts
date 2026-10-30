import type {
  ProjectSummary,
  TaskEvent,
  TaskPriority,
  TaskShare,
  TaskTags,
  TaskVisibility,
  UserSummary,
} from "@sokosumi/core-client";
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
  /** Short id such as SOK-12; null for tasks without a project. */
  identifier: string | null;
  name: string;
  status: TaskStatus;
  priority: TaskPriority;
  visibility: TaskVisibility;
  ownerId: string | null;
  owner: UserSummary | null;
  project: ProjectSummary | null;
  createdAt: string;
  updatedAt: string;
  jobsCount: number;
  assignee?: TaskAssigneeView | null;
  /** Task participants (humans added by comment `@`), in join order. */
  participants: TaskAssigneeView[];
  share?: TaskShare | null;
  commentsCount: number;
  columnId: KanbanColumnId;
  tags?: TaskTags;
  description?: string | null;
  descriptionPlain?: string | null;
  events: TaskEvent[];
  agents: CoreAgentDto[];
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
 * The column dot, in the colour the badges inside that column carry: the
 * guide's green and yellow, Iris for in progress, and two neutrals. Todo is
 * the strong neutral, backlog the muted one, so the two read apart by weight.
 */
export const COLUMN_STATUS_COLORS: Record<KanbanColumnId, string> = {
  backlog: "bg-status-done",
  todo: "bg-status-external",
  "in-progress": "bg-status-working",
  "input-required": "bg-semantic-warning",
  done: "bg-semantic-success",
};
