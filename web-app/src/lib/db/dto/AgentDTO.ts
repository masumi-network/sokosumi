import { Prisma } from "@prisma/client";
import { getTranslations } from "next-intl/server";

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
    OverrideTags: true;
    OnChainTags: true;
    Rating: true;
  };
}>;

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

export interface AgentDTO {
  readonly id: string;
  readonly agentIdentifier: string;
  readonly name: string;
  readonly description: string;
  readonly ExampleOutput: ExampleOutputDTO[];
  readonly author: string;
  readonly Legal: LegalDTO | null;
  readonly tags: string[];
  readonly image: string;
  readonly averageStars: number | null;
  readonly credits: number;
}

function calculateCredits(amount: number): number {
  return amount;
}

export async function createAgentDTO(
  agent: AgentWithRelations,
): Promise<AgentDTO> {
  if (!agent.Rating || !agent.Pricing.FixedPricing) {
    throw new Error("Agent must have Rating and FixedPricing");
  }

  const t = await getTranslations("Agent");

  return {
    id: agent.id,
    agentIdentifier: agent.agentIdentifier,
    name: agent.overrideName ?? agent.onChainName,
    description:
      agent.overrideDescription ??
      agent.onChainDescription ??
      t("defaultDescription"),
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
    author: agent.overrideAuthorName ?? agent.onChainAuthorName,
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
      agent.OverrideTags.length > 0
        ? agent.OverrideTags.map((tag) => tag.name)
        : agent.OnChainTags.map((tag) => tag.name),
    image: ipfsUrlResolver(agent.overrideImage ?? agent.onChainImage),
    credits: calculateCredits(
      Number(agent.Pricing.FixedPricing.Amounts[0].amount),
    ),
  };
}
