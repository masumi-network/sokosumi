import type { Agent } from "@/lib/clients/generated/core";

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
