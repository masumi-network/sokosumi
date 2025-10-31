// Explicit TypeScript types for agents endpoints (for next-openapi-gen typescript mode)

export type AgentTag = {
  name: string; // Tag name
};

export type AgentPrice = {
  credits: number; // Total credits including fee
  includedFee: number; // Fee credits included
};

export type AgentResponse = {
  id: string;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
  name: string;
  description: string | null;
  status: string; // AgentStatus
  isShown: boolean;
  price: AgentPrice;
  tags: AgentTag[];
};

export type AgentsSuccessResponse = {
  success: true;
  data: AgentResponse[];
  timestamp: string; // ISO timestamp
};

// Simplified input schema response to aid generator resolution
export type AgentInputSchemaItem = {
  id: string;
  type: string; // e.g., textarea, file, string, etc.
  name: string;
  data?: {
    label?: string;
    placeholder?: string;
    description?: string;
    outputFormat?: string; // e.g., "string"
  };
  validations?: Array<{
    validation?: string; // e.g., accept, maxSize, min, max
    value?: string; // value as string (e.g., sizes or patterns)
  }>;
};

export type AgentInputSchemaResponse = {
  input_data: AgentInputSchemaItem[];
};

export type AgentInputSchemaSuccessResponse = {
  success: true;
  data: AgentInputSchemaResponse;
  timestamp: string;
};

export type AgentParams = {
  agentId: string;
};
