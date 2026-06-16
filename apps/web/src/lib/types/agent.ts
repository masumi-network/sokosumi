import type { JobInputsFormSchemaType } from "@/lib/job-input";
import type { JobStatusResponseSchemaType } from "@/lib/schemas";
import type { Agent } from "@/lib/types/core-dto";

export type AgentWithAvailability = {
  agent: Agent;
  isAvailable: boolean;
};

export interface AgentLegal {
  readonly privacyPolicy: string | null;
  readonly terms: string | null;
  readonly dpa: string | null;
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
