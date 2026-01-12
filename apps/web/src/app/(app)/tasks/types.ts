import { AgentJobStatus } from "@sokosumi/database";

export type KanbanColumnId =
  | "backlog"
  | "todo"
  | "in-progress"
  | "input-required"
  | "refund-requested";

export interface TaskAgentStep {
  name: string;
  status: "done" | "pending" | "blocked";
}

export type TagColorKey =
  | "skyBlue"
  | "lightTeal"
  | "neonGrass"
  | "youngGrass"
  | "persimmon"
  | "irisFlower";

export interface TaskTag {
  label: string;
  color: TagColorKey;
}

export interface TaskActivity {
  id: string;
  actorName: string;
  actorImage?: string;
  action: string;
  status?: string;
  timestamp: string;
}

export interface TaskCardData {
  id: string;
  title: string;
  status: AgentJobStatus;
  budget?: number | null;
  agents: TaskAgentStep[];
  tags: TaskTag[];
  orchestrator: string;
  commentsCount: number;
  date: string;
  columnId: KanbanColumnId;
  assignee: string;
  dueDate: string;
  description: string;
  activities: TaskActivity[];
}

export interface KanbanColumnDefinition {
  id: KanbanColumnId;
  translationKey: string;
}

export const COLUMN_STATUS_COLORS: Record<KanbanColumnId, string> = {
  backlog: "bg-muted-foreground",
  todo: "bg-blue-500",
  "in-progress": "bg-amber-500",
  "input-required": "bg-orange-500",
  "refund-requested": "bg-destructive",
};

export const TAG_COLOR_TOKEN_MAP: Record<TagColorKey, string> = {
  skyBlue: "bg-sky-blue/10 text-sky-blue",
  lightTeal: "bg-light-teal/10 text-light-teal",
  neonGrass: "bg-neon-grass/10 text-neon-grass",
  youngGrass: "bg-young-grass/10 text-young-grass",
  persimmon: "bg-persimmon/10 text-persimmon",
  irisFlower: "bg-iris-flower/10 text-iris-flower",
};
