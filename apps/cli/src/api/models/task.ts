import { type AgentJob, parseAgentJob } from "./agent-job.js";

export interface Task {
  id: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  userId: string | null;
  organizationId: string | null;
  name: string | null;
  description: string | null;
  status: string | null;
  coworkerId: string | null;
  coworkerName: string | null;
  jobs: AgentJob[];
  totalCredits: number | null;
  events: unknown[];
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

export function parseTask(input: unknown): Task {
  const value = asRecord(input);
  const coworker = asRecord(value.coworker);
  const jobs = Array.isArray(value.jobs) ? value.jobs : [];
  return {
    id: typeof value.id === "string" ? value.id : null,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : null,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
    userId: typeof value.userId === "string" ? value.userId : null,
    organizationId:
      typeof value.organizationId === "string" ? value.organizationId : null,
    name: typeof value.name === "string" ? value.name : null,
    description:
      typeof value.description === "string" ? value.description : null,
    status: typeof value.status === "string" ? value.status : null,
    coworkerId:
      typeof value.coworkerId === "string"
        ? value.coworkerId
        : typeof value.assigneeId === "string"
          ? value.assigneeId
          : null,
    coworkerName:
      typeof value.coworkerName === "string"
        ? value.coworkerName
        : typeof coworker.name === "string"
          ? coworker.name
          : null,
    jobs: jobs.map(parseAgentJob),
    totalCredits:
      typeof value.totalCredits === "number" &&
      Number.isFinite(value.totalCredits)
        ? value.totalCredits
        : typeof value.credits === "number" && Number.isFinite(value.credits)
          ? value.credits
          : null,
    events: Array.isArray(value.events) ? value.events : [],
  };
}
