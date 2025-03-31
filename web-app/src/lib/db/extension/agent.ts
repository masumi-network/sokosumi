import { Agent, ExampleOutput, Prisma } from "@prisma/client";

import { ipfsUrlResolver } from "@/lib/ipfs";

export function getName(agent: Agent): string {
  return agent.overrideName ?? agent.name;
}

export function getDescription(agent: Agent): string | null {
  return agent.overrideDescription ?? agent.description;
}

export function getResolvedImage(agent: Agent): string {
  return ipfsUrlResolver(agent.overrideImage ?? agent.image);
}

export type AgentWithFixedPricing = Prisma.AgentGetPayload<{
  include: {
    pricing: {
      include: {
        fixedPricing: {
          include: {
            amounts: true;
          };
        };
      };
    };
  };
}>;

export function getCredits(agent: AgentWithFixedPricing): number {
  if (!agent.pricing.fixedPricing) {
    throw new Error("Agent must have FixedPricing");
  }
  return Number(agent.pricing.fixedPricing.amounts[0].amount);
}

export type AgentWithRating = Prisma.AgentGetPayload<{
  include: {
    rating: true;
  };
}>;

export function getAverageStars(agent: AgentWithRating): number | null {
  if (!agent.rating) {
    throw new Error("Agent must have Rating");
  }
  if (Number(agent.rating.totalRatings) === 0) {
    return null;
  }
  return Math.min(
    5,
    Math.round(
      Number(agent.rating.totalStars) / Number(agent.rating.totalRatings),
    ),
  );
}

export type AgentWithTags = Prisma.AgentGetPayload<{
  include: {
    tags: true;
    overrideTags: true;
  };
}>;

export function getTags(agent: AgentWithTags): string[] {
  return agent.overrideTags.length > 0
    ? agent.overrideTags.map((tag) => tag.name)
    : agent.tags.map((tag) => tag.name);
}

export interface Legal {
  readonly privacyPolicy: string | null;
  readonly terms: string | null;
  readonly other: string | null;
}

export function getLegal(agent: Agent): Legal | null {
  const privacyPolicy = getLegalPrivacyPolicy(agent);
  const terms = getLegalTerms(agent);
  const other = getLegalOther(agent);
  return privacyPolicy || terms || other
    ? { privacyPolicy, terms, other }
    : null;
}

export function getLegalPrivacyPolicy(agent: Agent): string | null {
  return agent.overrideLegalPrivacyPolicy ?? agent.legalPrivacyPolicy;
}

export function getLegalTerms(agent: Agent): string | null {
  return agent.overrideLegalTerms ?? agent.legalTerms;
}

export function getLegalOther(agent: Agent): string | null {
  return agent.overrideLegalOther ?? agent.legalOther;
}

export interface Author {
  readonly name: string;
  readonly email: string | null;
  readonly other: string | null;
}

export function getAuthor(agent: Agent): Author {
  return {
    name: agent.overrideAuthorName ?? agent.authorName,
    email: agent.overrideAuthorContactEmail ?? agent.authorContactEmail,
    other: agent.overrideAuthorContactOther ?? agent.authorContactOther,
  };
}

export function getAuthorName(agent: Agent): string {
  return agent.overrideAuthorName ?? agent.authorName;
}

export function getAuthorEmail(agent: Agent): string | null {
  return agent.overrideAuthorContactEmail ?? agent.authorContactEmail;
}

export function getAuthorOther(agent: Agent): string | null {
  return agent.overrideAuthorContactOther ?? agent.authorContactOther;
}

export type AgentWithExampleOutput = Prisma.AgentGetPayload<{
  include: {
    exampleOutput: true;
    overrideExampleOutput: true;
  };
}>;

export function getExampleOutput(
  agent: AgentWithExampleOutput,
): ExampleOutput[] {
  return agent.overrideExampleOutput.length > 0
    ? agent.overrideExampleOutput
    : agent.exampleOutput;
}
