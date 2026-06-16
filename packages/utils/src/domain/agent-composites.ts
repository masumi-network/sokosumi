import type {
  AgentRatingStats,
  UserAgentRatingWithUser,
} from "./agent-rating.js";
import type {
  Agent,
  AgentPricing,
  Category,
  ExampleOutput,
  Job,
  Tag,
  UserAgentRating,
} from "./models.js";

export type AgentWithPricing = Agent & {
  pricing: AgentPricing;
};

export type AgentWithTags = Agent & {
  tags: Tag[];
  overrideTags: Tag[];
};

export type AgentWithCategories = Agent & {
  categories: Category[];
};

export type AgentWithExampleOutput = Agent & {
  exampleOutput: ExampleOutput[];
  overrideExampleOutput: ExampleOutput[];
};

export type AgentWithRating = Agent & {
  userAgentRating: UserAgentRating[];
};

export type AgentWithJobs = Agent & {
  jobs: Job[];
};

export type AgentWithRelations = Agent & {
  pricing: AgentPricing;
  exampleOutput: ExampleOutput[];
  overrideExampleOutput: ExampleOutput[];
  tags: Tag[];
  overrideTags: Tag[];
  categories: Category[];
  userAgentRating: UserAgentRating[];
  jobs: Job[];
};

export type AgentWithCreditsPrice = AgentWithRelations & {
  creditsPrice: {
    cents: bigint;
  };
};

export type { AgentRatingStats, UserAgentRatingWithUser };
