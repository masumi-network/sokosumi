import { Agent } from "@sokosumi/database";

import { JobInputsFormSchemaType } from "@/lib/job-input";
import { JobStatusResponseSchemaType } from "@/lib/schemas";

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

export interface CategoryStyleTheme {
  color?: string;
  border?: {
    gradient?: {
      type: string;
      angle?: number;
      shape?: string;
      extent?: string;
      position?: { x: number; y: number };
      stops: Array<{
        color: string;
        offset: number;
        opacity?: number;
      }>;
    };
  };
}

export interface CategoryStyles {
  light?: CategoryStyleTheme;
  dark?: CategoryStyleTheme;
}
