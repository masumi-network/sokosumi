import type { AgentDetail, CoreAgentDto } from "@/lib/types/core-dto";

export function createMockCoreAgent(
  overrides: Partial<CoreAgentDto> = {},
): CoreAgentDto {
  const now = new Date();
  const base: AgentDetail = {
    id: `agent-${Math.random().toString(36).slice(2)}`,
    createdAt: now,
    updatedAt: now,
    name: "Test Agent",
    image: "https://example.com/image.png",
    icon: null,
    credits: 1,
    summary: null,
    description: "Test description",
    metrics: {
      executions: { count: 0, averageTime: null },
      ratings: { total: 0, average: null },
    },
    author: {
      name: "Test Author",
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
    riskClassification: "MINIMAL",
    tags: [],
    exampleOutputs: [],
  };

  return { ...base, ...overrides };
}
