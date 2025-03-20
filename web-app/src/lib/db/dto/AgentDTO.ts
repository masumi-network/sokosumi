import { Prisma } from "@prisma/client";

import { ipfsUrlResolver } from "@/lib/ipfs";

import { createPricingTypeDTO, PricingTypeDTO } from "./PricingTypeDTO";
import { createStatusDTO, StatusDTO } from "./StatusDTO";
import { TagDTO } from "./TagDTO";

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
    OverrideTags: true;
    OnChainTags: true;
    Rating: true;
  };
}>;

export interface PricingDTO {
  readonly id: string;
  readonly credits: number;
  readonly pricingType: PricingTypeDTO;
  readonly FixedPricing: FixedPricingDTO;
}

export interface FixedPricingDTO {
  readonly id: string;
  readonly Amounts: AmountDTO[];
}

export interface AmountDTO {
  readonly id: string;
  readonly unit: string;
  readonly amount: number;
}

export interface ExampleOutputDTO {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
}

export interface LegalDTO {
  readonly privacyPolicy: string | null;
  readonly terms: string | null;
  readonly other: string | null;
}

export interface RatingDTO {
  readonly totalStars: number;
  readonly totalRatings: number;
  readonly averageStars: number | null;
}

export interface CapabilityDTO {
  readonly name: string;
  readonly version: string;
}

export interface AuthorDTO {
  readonly name: string;
  readonly contactEmail: string | null;
  readonly contactOther: string | null;
  readonly organization: string | null;
}

export interface AgentDTO {
  readonly id: string;
  readonly ranking: number;
  readonly showOnFrontPage: boolean;
  readonly agentIdentifier: string;
  readonly Pricing: PricingDTO;
  readonly name: string;
  readonly description: string | null;
  readonly apiBaseUrl: string;
  readonly ExampleOutput: ExampleOutputDTO[];
  readonly Capability: CapabilityDTO;
  readonly requestsPerHour: string | null;
  readonly Author: AuthorDTO;
  readonly Legal: LegalDTO | null;
  readonly tags: TagDTO[];
  readonly image: string;
  readonly metadataVersion: number;
  readonly status: StatusDTO;
  readonly Rating: RatingDTO;
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
            name: example.name,
            mimeType: example.mimeType,
            url: ipfsUrlResolver(example.url),
          }))
        : agent.ExampleOutput.map((example) => ({
            id: example.id,
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
      agent.OverrideTags.length > 0 ? agent.OverrideTags : agent.OnChainTags,
    image: ipfsUrlResolver(agent.overrideImage ?? agent.onChainImage),
    metadataVersion:
      agent.overrideMetadataVersion ?? agent.onChainMetadataVersion,
    status: createStatusDTO(agent.status),
    id: agent.id,
    agentIdentifier: agent.agentIdentifier,
    Pricing: {
      id: agent.agentPricingId,
      pricingType: createPricingTypeDTO(agent.Pricing.pricingType),
      credits: calculateCredits(
        Number(agent.Pricing.FixedPricing.Amounts[0].amount),
      ),
      FixedPricing: {
        id: agent.Pricing.FixedPricing.id,
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
