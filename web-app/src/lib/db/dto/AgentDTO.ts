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

export class AgentDTO {
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
  readonly Capability: {
    name: string;
    version: string;
  };
  readonly requestsPerHour: string | null;
  readonly Author: {
    name: string;
    contactEmail: string | null;
    contactOther: string | null;
    organization: string | null;
  };
  readonly Legal: Legal | null;
  readonly tags: string[];
  readonly image: string;
  readonly metadataVersion: number;
  readonly status: Status;
  readonly Rating: Rating;

  constructor(agent: AgentWithRelations) {
    if (!agent.Rating || !agent.Pricing.FixedPricing) {
      throw new Error("Agent must have Rating and FixedPricing");
    }
    this.name = agent.overrideName ?? agent.onChainName;
    this.description = agent.overrideDescription ?? agent.onChainDescription;
    this.apiBaseUrl = agent.overrideApiBaseUrl ?? agent.onChainApiBaseUrl;
    this.ExampleOutput =
      agent.ExampleOutputOverride.length > 0
        ? agent.ExampleOutputOverride.map((example) => {
            return {
              id: example.id,
              createdAt: example.createdAt,
              updatedAt: example.updatedAt,
              name: example.name,
              mimeType: example.mimeType,
              url: ipfsUrlResolver(example.url),
            };
          })
        : agent.ExampleOutput.length > 0
          ? agent.ExampleOutput.map((example) => {
              return {
                id: example.id,
                createdAt: example.createdAt,
                updatedAt: example.updatedAt,
                name: example.name,
                mimeType: example.mimeType,
                url: ipfsUrlResolver(example.url),
              };
            })
          : [];
    this.Capability = {
      name: agent.overrideCapabilityName ?? agent.onChainCapabilityName,
      version:
        agent.overrideCapabilityVersion ?? agent.onChainCapabilityVersion,
    };
    this.Rating = {
      totalStars: Number(agent.Rating.totalStars),
      totalRatings: Number(agent.Rating.totalRatings),
      averageStars:
        Number(agent.Rating.totalRatings) === Number(0)
          ? null
          : Math.min(
              5,
              Math.round(
                Number(agent.Rating.totalStars) /
                  Number(agent.Rating.totalRatings),
              ),
            ),
    };
    this.requestsPerHour =
      agent.overrideRequestsPerHour ?? agent.onChainRequestsPerHour;
    this.Author = {
      name: agent.overrideAuthorName ?? agent.onChainAuthorName,
      contactEmail:
        agent.overrideAuthorContactEmail ?? agent.onChainAuthorContactEmail,
      contactOther:
        agent.overrideAuthorContactOther ?? agent.onChainAuthorContactOther,
      organization:
        agent.overrideAuthorOrganization ?? agent.onChainAuthorOrganization,
    };
    const privacyPolicy =
      agent.overrideLegalPrivacyPolicy ?? agent.onChainLegalPrivacyPolicy;
    const terms = agent.overrideLegalTerms ?? agent.onChainLegalTerms;
    const other = agent.overrideLegalOther ?? agent.onChainLegalOther;

    this.Legal =
      privacyPolicy || terms || other
        ? {
            privacyPolicy,
            terms,
            other,
          }
        : null;
    this.tags =
      agent.overrideTags.length > 0 ? agent.overrideTags : agent.onChainTags;
    this.image = ipfsUrlResolver(agent.overrideImage ?? agent.onChainImage);
    this.metadataVersion =
      agent.overrideMetadataVersion ?? agent.onChainMetadataVersion;
    this.status = agent.status;
    this.id = agent.id;
    this.createdAt = agent.createdAt;
    this.updatedAt = agent.updatedAt;
    this.agentIdentifier = agent.agentIdentifier;
    this.Pricing = {
      id: agent.agentPricingId,
      createdAt: agent.Pricing.createdAt,
      updatedAt: agent.Pricing.updatedAt,
      pricingType: agent.Pricing.pricingType,
      credits: this.calculateCredits(
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
    };
    this.ranking = Number(agent.ranking);
    this.showOnFrontPage = agent.showOnFrontPage;
  }

  static create(agent: AgentWithRelations): AgentDTO {
    return new AgentDTO(agent);
  }

  private calculateCredits(amount: number): number {
    return amount;
  }
}
