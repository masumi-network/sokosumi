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

export class UnifiedAgent {
  readonly ranking: bigint;
  readonly showOnFrontPage: boolean;
  readonly agentIdentifier: string;
  readonly Pricing: {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    pricingType: PricingType;
    FixedPricing: {
      id: string;
      createdAt: Date;
      updatedAt: Date;
      Amounts: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        unit: string;
        amount: bigint;
      }[];
    };
  };
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly apiBaseUrl: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly ExampleOutput: {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    name: string;
    mimeType: string;
    url: string;
  }[];
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
  readonly Legal: {
    privacyPolicy: string | null;
    terms: string | null;
    other: string | null;
  };
  readonly tags: string[];
  readonly image: string;
  readonly metadataVersion: number;
  readonly status: Status;
  readonly Rating: {
    averageStars: bigint;
    totalStars: bigint;
    totalRatings: bigint;
  };

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
      averageStars: agent.Rating.totalStars / agent.Rating.totalRatings,
      totalStars: agent.Rating.totalStars,
      totalRatings: agent.Rating.totalRatings,
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
    this.Legal = {
      privacyPolicy:
        agent.overrideLegalPrivacyPolicy ?? agent.onChainLegalPrivacyPolicy,
      terms: agent.overrideLegalTerms ?? agent.onChainLegalTerms,
      other: agent.overrideLegalOther ?? agent.onChainLegalOther,
    };
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
      FixedPricing: {
        id: agent.Pricing.FixedPricing.id,
        createdAt: agent.Pricing.FixedPricing.createdAt,
        updatedAt: agent.Pricing.FixedPricing.updatedAt,
        Amounts: agent.Pricing.FixedPricing.Amounts,
      },
    };
    this.ranking = agent.ranking;
    this.showOnFrontPage = agent.showOnFrontPage;
  }

  static create(agent: AgentWithRelations): UnifiedAgent {
    return new UnifiedAgent(agent);
  }
}
