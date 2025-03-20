import { ExampleOutput, Prisma, Tag } from "@prisma/client";

import { ipfsUrlResolver } from "@/lib/ipfs";

export type AgentWithRelations = Prisma.AgentGetPayload<{
  include: {
    ExampleOutput: true;
    ExampleOutputOverride: true;
    Pricing: {
      include: {
        FixedPricing: {
          include: {
            Amounts: true;
          };
        };
      };
    };
    OverrideTags: true;
    OnChainTags: true;
    Rating: true;
  };
}>;

export function getName(agent: AgentWithRelations): string {
  return agent.overrideName ?? agent.onChainName;
}

export function getDescription(agent: AgentWithRelations): string | null {
  return agent.overrideDescription ?? agent.onChainDescription;
}

export function getExampleOutputs(agent: AgentWithRelations): ExampleOutput[] {
  return agent.ExampleOutputOverride.length > 0
    ? agent.ExampleOutputOverride
    : agent.ExampleOutput;
}

export function getTags(agent: AgentWithRelations): Tag[] {
  return agent.OverrideTags.length > 0 ? agent.OverrideTags : agent.OnChainTags;
}

export function getBaseUrl(agent: AgentWithRelations): string {
  return agent.overrideApiBaseUrl ?? agent.onChainApiBaseUrl;
}

export function getImageUrl(agent: AgentWithRelations): string {
  return ipfsUrlResolver(agent.overrideImage ?? agent.onChainImage);
}

export function getAverageRating(agent: AgentWithRelations): number | null {
  if (Number(agent.Rating.totalRatings) === 0) {
    return null;
  }
  return Number(agent.Rating.totalStars) / Number(agent.Rating.totalRatings);
}

export function getAuthorName(agent: AgentWithRelations): string {
  return agent.overrideAuthorName ?? agent.onChainAuthorName;
}

export function getAuthorContactEmail(
  agent: AgentWithRelations,
): string | null {
  return agent.overrideAuthorContactEmail ?? agent.onChainAuthorContactEmail;
}

export function getAuthorContactOther(
  agent: AgentWithRelations,
): string | null {
  return agent.overrideAuthorContactOther ?? agent.onChainAuthorContactOther;
}

export function getAuthorOrganization(
  agent: AgentWithRelations,
): string | null {
  return agent.overrideAuthorOrganization ?? agent.onChainAuthorOrganization;
}

export function getLegalPrivacyPolicy(
  agent: AgentWithRelations,
): string | null {
  return agent.overrideLegalPrivacyPolicy ?? agent.onChainLegalPrivacyPolicy;
}

export function getLegalTerms(agent: AgentWithRelations): string | null {
  return agent.overrideLegalTerms ?? agent.onChainLegalTerms;
}

export function getLegalOther(agent: AgentWithRelations): string | null {
  return agent.overrideLegalOther ?? agent.onChainLegalOther;
}

export function getCapabilityName(agent: AgentWithRelations): string {
  return agent.overrideCapabilityName ?? agent.onChainCapabilityName;
}

export function getCapabilityVersion(agent: AgentWithRelations): string {
  return agent.overrideCapabilityVersion ?? agent.onChainCapabilityVersion;
}

export function getCredits(agent: AgentWithRelations): number | null {
  return (
    agent.Pricing?.FixedPricing?.Amounts.reduce(
      (acc, amount) => acc + Number(amount.amount),
      0,
    ) ?? null
  );
}
