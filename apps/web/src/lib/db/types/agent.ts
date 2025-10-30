import { Agent } from "@sokosumi/database";

import { JobInputsFormSchemaType } from "@/lib/job-input";
import { JobStatusResponseSchemaType } from "@/lib/schemas";

// Re-export types from database package
export {
  agentCreatedAtOrderBy,
  agentExampleOutputInclude,
  agentInclude,
  agentJobsCountOrderBy,
  agentJobsInclude,
  agentOrderBy,
  agentOrganizationsInclude,
  agentPricingInclude,
  agentRatingInclude,
  agentTagsInclude,
  type AgentWithCreditsPrice,
  type AgentWithExampleOutput,
  type AgentWithJobs,
  type AgentWithOrganizations,
  type AgentWithPricing,
  type AgentWithRating,
  type AgentWithRelations,
  type AgentWithTags,
} from "@sokosumi/database";

// Web app-specific types
export type AgentWithAvailability = {
  agent: Agent;
  isAvailable: boolean;
};

export interface AgentLegal {
  readonly privacyPolicy: string | null;
  readonly terms: string | null;
  readonly other: string | null;
}

export interface AgentDemoData {
  demoInput: string;
  demoOutput: string;
}

export interface AgentDemoValues {
  input: JobInputsFormSchemaType;
  output: JobStatusResponseSchemaType;
}
