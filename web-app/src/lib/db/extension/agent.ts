import { Agent, ExampleOutput, Prisma } from "@prisma/client";

import { getEnvSecrets } from "@/config/env.config";
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

export function getApiBaseUrl(agent: Agent): URL {
  //Validate the API base URL
  const blacklistedHostnames = getEnvSecrets().BLACKLISTED_AGENT_HOSTNAMES;
  const apiBaseUrl = new URL(agent.apiBaseUrl);
  if (blacklistedHostnames.includes(apiBaseUrl.hostname)) {
    throw new Error("Agent API base URL is not allowed");
  }
  if (apiBaseUrl.protocol !== "https:" && apiBaseUrl.protocol !== "http:") {
    throw new Error("Agent API base URL must be HTTP or HTTPS");
  }
  if (
    apiBaseUrl.port !== "80" &&
    apiBaseUrl.port !== "443" &&
    apiBaseUrl.port !== ""
  ) {
    throw new Error("Agent API base URL must be HTTP or HTTPS");
  }
  if (apiBaseUrl.search !== "") {
    throw new Error("Agent API base URL must not have a query string");
  }
  if (apiBaseUrl.hash !== "") {
    throw new Error("Agent API base URL must not have a hash");
  }
  return new URL(agent.overrideApiBaseUrl ?? agent.apiBaseUrl);
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
  const unit = agent.pricing.fixedPricing.amounts[0].unit;
  const amount = Number(agent.pricing.fixedPricing.amounts[0].amount);

  switch (unit) {
    case "usdm":
      return amount;
    case "lovelace":
      return amount / 10 ** 6;
    default:
      return amount / 10 ** 6; // Default is lovelace
  }
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
