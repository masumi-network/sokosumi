import { convertCreditsToCents } from "@sokosumi/utils";

import type {
  Agent,
  AgentDetail,
  File as CoreJobFile,
  Job,
  JobEvent,
  JobSummary,
  MemberRecord,
  Notice,
  OrganizationRecord,
  Task,
  TaskEvent,
} from "@/lib/clients/generated/core";

/** Agent list or detail payload from Core. */
export type CoreAgentDto = Agent | AgentDetail;

export type AgentRatingStats = Agent["metrics"]["ratings"];

export type OrganizationWithLimitedInfo = Pick<
  OrganizationRecord,
  "id" | "name" | "slug"
>;

export type OrganizationMembershipSelf = Pick<MemberRecord, "id" | "role">;

/** Core API enum unions — use `@sokosumi/utils` const maps for runtime values. */
export type TaskStatus = Task["status"];
export type SokosumiJobStatus = JobSummary["status"];
export type JobType = Job["jobType"];
export type AgentJobStatus = JobEvent["status"];
export type OnChainJobStatus = NonNullable<Job["onChainStatus"]>;
export type BlobStatus = CoreJobFile["status"];
export type NoticeKind = Notice["kind"];
export type TaskEventOrigin = TaskEvent["origin"];
export type RiskClassification = AgentDetail["riskClassification"];

const UNAVAILABLE_AGENT_DATE = new Date(0);

/** Placeholder when Core returns no agent (e.g. deleted or inaccessible). */
export function createUnavailableCoreAgent(agentId: string): Agent {
  return {
    id: agentId,
    createdAt: UNAVAILABLE_AGENT_DATE,
    updatedAt: UNAVAILABLE_AGENT_DATE,
    name: agentId,
    image: null,
    icon: null,
    credits: 0,
    summary: null,
    description: "",
    metrics: {
      executions: { count: 0, averageTime: null },
      ratings: { total: 0, average: null },
    },
    author: {
      name: null,
      image: null,
      organization: null,
      other: null,
    },
    legal: {
      privacyPolicy: null,
      terms: null,
      dpa: null,
      other: null,
    },
    categories: [],
  };
}

export function isCoreAgentDetail(agent: CoreAgentDto): agent is AgentDetail {
  return "riskClassification" in agent;
}

export function getAgentRatingStats(agent: CoreAgentDto): AgentRatingStats {
  return agent.metrics.ratings;
}

export function getAgentCredits(agent: CoreAgentDto): number {
  return agent.credits;
}

export function getAgentCreditsCents(agent: CoreAgentDto): bigint {
  return convertCreditsToCents(agent.credits);
}

export function getAgentRatingStatsMap(
  agents: CoreAgentDto[],
): Record<string, AgentRatingStats> {
  return Object.fromEntries(
    agents.map((agent) => [agent.id, getAgentRatingStats(agent)]),
  );
}
