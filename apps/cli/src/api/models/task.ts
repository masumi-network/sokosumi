import { type AgentJob, parseAgentJob } from "./agent-job.js";
import { asRecord, nullableNumber, nullableString } from "./parse-helpers.js";

export interface Task {
  id: string | null;
  identifier: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  userId: string | null;
  organizationId: string | null;
  name: string | null;
  description: string | null;
  status: string | null;
  priority: string | null;
  projectId: string | null;
  coworkerId: string | null;
  coworkerName: string | null;
  assigneeUserId: string | null;
  jobs: AgentJob[];
  totalCredits: number | null;
  events: unknown[];
}

function assigneeCoworkerName(assignee: unknown): string | null {
  const value = asRecord(assignee);
  if (value.type !== "coworker") return null;
  return nullableString(asRecord(value.coworker).name);
}

export function parseTask(input: unknown): Task {
  const value = asRecord(input);
  const jobs = Array.isArray(value.jobs) ? value.jobs : [];
  return {
    id: nullableString(value.id),
    identifier: nullableString(value.identifier),
    createdAt: nullableString(value.createdAt),
    updatedAt: nullableString(value.updatedAt),
    userId: nullableString(value.ownerId),
    organizationId: nullableString(value.organizationId),
    name: nullableString(value.name),
    description: nullableString(value.description),
    status: nullableString(value.status),
    priority: nullableString(value.priority),
    projectId: nullableString(value.projectId),
    coworkerId: nullableString(value.assigneeId),
    coworkerName: assigneeCoworkerName(value.assignee),
    assigneeUserId: nullableString(value.assigneeUserId),
    jobs: jobs.map(parseAgentJob),
    totalCredits: nullableNumber(value.credits),
    events: Array.isArray(value.events) ? value.events : [],
  };
}
