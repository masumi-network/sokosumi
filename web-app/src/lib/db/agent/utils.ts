import { getEnvSecrets } from "@/config/env.config";
import { ipfsUrlResolver } from "@/lib/ipfs";
import { Agent, ExampleOutput } from "@/prisma/generated/client";

import {
  AgentLegal,
  AgentWithExampleOutput,
  AgentWithRating,
  AgentWithTags,
} from "./types";

export function getAgentName(agent: Agent): string {
  return agent.overrideName ?? agent.name;
}

export function getAgentDescription(agent: Agent): string | null {
  return agent.overrideDescription ?? agent.description;
}

export function getAgentResolvedImage(agent: Agent): string {
  return ipfsUrlResolver(agent.overrideImage ?? agent.image);
}

export function getAgentApiBaseUrl(agent: Agent): URL {
  // Validate the API base URL
  const blacklistedHostnames = getEnvSecrets().BLACKLISTED_AGENT_HOSTNAMES;
  const apiBaseUrl = new URL(agent.apiBaseUrl);
  if (blacklistedHostnames.includes(apiBaseUrl.hostname)) {
    throw new Error("Agent API base URL is not allowed");
  }
  if (apiBaseUrl.protocol !== "https:" && apiBaseUrl.protocol !== "http:") {
    throw new Error("Agent API base URL must be HTTP or HTTPS");
  }

  if (apiBaseUrl.search !== "") {
    throw new Error("Agent API base URL must not have a query string");
  }
  if (apiBaseUrl.hash !== "") {
    throw new Error("Agent API base URL must not have a hash");
  }

  const usedUrl = agent.overrideApiBaseUrl ?? agent.apiBaseUrl;
  const cleanedUrl = usedUrl.endsWith("/") ? usedUrl.slice(0, -1) : usedUrl;
  return new URL(cleanedUrl);
}

export function getAgentAverageStars(agent: AgentWithRating): number | null {
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

export function getAgentTags(agent: AgentWithTags): string[] {
  return agent.overrideTags.length > 0
    ? agent.overrideTags.map((tag) => tag.name)
    : agent.tags.map((tag) => tag.name);
}

export function getAgentLegal(agent: Agent): AgentLegal | null {
  const privacyPolicy = getAgentLegalPrivacyPolicy(agent);
  const terms = getAgentLegalTerms(agent);
  const other = getAgentLegalOther(agent);
  return privacyPolicy || terms || other
    ? { privacyPolicy, terms, other }
    : null;
}

export function getAgentLegalPrivacyPolicy(agent: Agent): string | null {
  return agent.overrideLegalPrivacyPolicy ?? agent.legalPrivacyPolicy;
}

export function getAgentLegalTerms(agent: Agent): string | null {
  return agent.overrideLegalTerms ?? agent.legalTerms;
}

export function getAgentLegalOther(agent: Agent): string | null {
  return agent.overrideLegalOther ?? agent.legalOther;
}

export function getAgentAuthorOrganization(agent: Agent): string | null {
  return agent.overrideAuthorOrganization ?? agent.authorOrganization;
}

export function getShortAgentAuthorName(agent: Agent): string {
  // Prioritize organization over name
  const organization = getAgentAuthorOrganization(agent);
  if (organization) {
    return organization;
  }
  return agent.overrideAuthorName ?? agent.authorName;
}

export function getFullAgentAuthorName(agent: Agent): string {
  // For detail pages, show both organization and name
  const organization = getAgentAuthorOrganization(agent);
  const name = agent.overrideAuthorName ?? agent.authorName;

  if (organization && name) {
    return `${organization} (${name})`;
  } else if (organization) {
    return organization;
  }
  return name;
}

export function getAgentAuthorEmail(agent: Agent): string | null {
  return agent.overrideAuthorContactEmail ?? agent.authorContactEmail;
}

export function getAgentAuthorOther(agent: Agent): string | null {
  return agent.overrideAuthorContactOther ?? agent.authorContactOther;
}

export function getAgentExampleOutput(
  agent: AgentWithExampleOutput,
): ExampleOutput[] {
  return agent.overrideExampleOutput.length > 0
    ? agent.overrideExampleOutput
    : agent.exampleOutput;
}

export function getAgentResolvedExampleOutputUrl(
  exampleOutput: ExampleOutput,
): string {
  return ipfsUrlResolver(exampleOutput.url);
}
