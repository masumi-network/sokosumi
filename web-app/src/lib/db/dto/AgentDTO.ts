import { PricingType, Prisma, Status } from "@prisma/client";

import { ipfsUrlResolver } from "@/lib/ipfs";

type AgentWithRelations = Prisma.AgentGetPayload<{
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
    Rating: true;
  };
}>;

export interface Pricing {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly credits: number;
  readonly pricingType: PricingType;
  readonly FixedPricing: FixedPricing;
}

export interface FixedPricing {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly Amounts: Amount[];
}

export interface Amount {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly unit: string;
  readonly amount: number;
}

export interface ExampleOutput {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly name: string;
  readonly mimeType: string;
}

export interface Legal {
  readonly privacyPolicy: string | null;
  readonly terms: string | null;
  readonly other: string | null;
}

export interface Rating {
  readonly totalStars: number;
  readonly totalRatings: number;
  readonly averageStars: number | null;
}

export interface Capability {
  readonly name: string;
  readonly version: string;
}

export interface Author {
  readonly name: string;
  readonly contactEmail: string | null;
  readonly contactOther: string | null;
  readonly organization: string | null;
}

export interface AgentDTO {
  readonly ranking: number;
  readonly showOnFrontPage: boolean;
  readonly agentIdentifier: string;
  readonly Pricing: Pricing;
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly apiBaseUrl: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly ExampleOutput: ExampleOutput[];
  readonly Capability: Capability;
  readonly requestsPerHour: string | null;
  readonly Author: Author;
  readonly Legal: Legal | null;
  readonly tags: string[];
  readonly image: string;
  readonly metadataVersion: number;
  readonly status: Status;
  readonly Rating: Rating;
}

function calculateCredits(amount: number): number {
  return amount;
}

export function createAgentDTO(agent: AgentWithRelations): AgentDTO {
  if (!agent.Rating || !agent.Pricing.FixedPricing) {
    throw new Error("Agent must have Rating and FixedPricing");
  }

  return {
    name: agent.overrideName ?? agent.onChainName,
    description: agent.overrideDescription ?? agent.onChainDescription,
    apiBaseUrl: agent.overrideApiBaseUrl ?? agent.onChainApiBaseUrl,
    ExampleOutput:
      agent.ExampleOutputOverride.length > 0
        ? agent.ExampleOutputOverride.map((example) => ({
            id: example.id,
            createdAt: example.createdAt,
            updatedAt: example.updatedAt,
            name: example.name,
            mimeType: example.mimeType,
            url: ipfsUrlResolver(example.url),
          }))
        : agent.ExampleOutput.map((example) => ({
            id: example.id,
            createdAt: example.createdAt,
            updatedAt: example.updatedAt,
            name: example.name,
            mimeType: example.mimeType,
            url: ipfsUrlResolver(example.url),
          })),
    Capability: {
      name: agent.overrideCapabilityName ?? agent.onChainCapabilityName,
      version:
        agent.overrideCapabilityVersion ?? agent.onChainCapabilityVersion,
    },
    Rating: {
      totalStars: Number(agent.Rating.totalStars),
      totalRatings: Number(agent.Rating.totalRatings),
      averageStars:
        Number(agent.Rating.totalRatings) === 0
          ? null
          : Math.min(
              5,
              Math.round(
                Number(agent.Rating.totalStars) /
                  Number(agent.Rating.totalRatings),
              ),
            ),
    },
    requestsPerHour:
      agent.overrideRequestsPerHour ?? agent.onChainRequestsPerHour,
    Author: {
      name: agent.overrideAuthorName ?? agent.onChainAuthorName,
      contactEmail:
        agent.overrideAuthorContactEmail ?? agent.onChainAuthorContactEmail,
      contactOther:
        agent.overrideAuthorContactOther ?? agent.onChainAuthorContactOther,
      organization:
        agent.overrideAuthorOrganization ?? agent.onChainAuthorOrganization,
    },
    Legal: (() => {
      const privacyPolicy =
        agent.overrideLegalPrivacyPolicy ?? agent.onChainLegalPrivacyPolicy;
      const terms = agent.overrideLegalTerms ?? agent.onChainLegalTerms;
      const other = agent.overrideLegalOther ?? agent.onChainLegalOther;
      return privacyPolicy || terms || other
        ? { privacyPolicy, terms, other }
        : null;
    })(),
    tags:
      agent.overrideTags.length > 0 ? agent.overrideTags : agent.onChainTags,
    image: ipfsUrlResolver(agent.overrideImage ?? agent.onChainImage),
    metadataVersion:
      agent.overrideMetadataVersion ?? agent.onChainMetadataVersion,
    status: agent.status,
    id: agent.id,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    agentIdentifier: agent.agentIdentifier,
    Pricing: {
      id: agent.agentPricingId,
      createdAt: agent.Pricing.createdAt,
      updatedAt: agent.Pricing.updatedAt,
      pricingType: agent.Pricing.pricingType,
      credits: calculateCredits(
        Number(agent.Pricing.FixedPricing.Amounts[0].amount),
      ),
      FixedPricing: {
        id: agent.Pricing.FixedPricing.id,
        createdAt: agent.Pricing.FixedPricing.createdAt,
        updatedAt: agent.Pricing.FixedPricing.updatedAt,
        Amounts: agent.Pricing.FixedPricing.Amounts.map((amount) => ({
          ...amount,
          amount: Number(amount.amount),
        })),
      },
    },
    ranking: Number(agent.ranking),
    showOnFrontPage: agent.showOnFrontPage,
  };
}
