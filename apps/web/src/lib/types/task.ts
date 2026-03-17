import type { AgentWithCreditsPrice } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/database";

import type { Coworker } from "@/lib/clients/generated/core";
import type { TaskEvent } from "@/lib/clients/generated/core/types.gen";

export type { TaskEvent };

export type KanbanColumnId =
  | "backlog"
  | "todo"
  | "in-progress"
  | "input-required"
  | "done";

export interface TaskWithCoworker {
  id: string;
  name: string;
  status: TaskStatus;
  userId: string;
  createdAt: string;
  updatedAt: string;
  coworker?: Coworker | null;
  commentsCount: number;
  columnId: KanbanColumnId;
  description?: string | null;
  descriptionPlain?: string | null;
  events: TaskEvent[];
  agents: AgentWithCreditsPrice[];
}

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
