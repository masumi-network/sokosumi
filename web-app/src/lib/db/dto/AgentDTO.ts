import { Prisma } from "@prisma/client";
import { getTranslations } from "next-intl/server";

import { ipfsUrlResolver } from "@/lib/ipfs";

type AgentWithRelations = Prisma.AgentGetPayload<{
  include: {
    exampleOutput: true;
    overrideExampleOutput: true;
    pricing: {
      include: {
        fixedPricing: {
          include: {
            amounts: true;
          };
        };
      };
    };
    tags: true;
    overrideTags: true;
    rating: true;
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
  readonly onChainIdentifier: string;
  readonly name: string;
  readonly description: string;
  readonly exampleOutput: ExampleOutputDTO[];
  readonly author: string;
  readonly legal?: LegalDTO;
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
  if (!agent.rating || !agent.pricing.fixedPricing) {
    throw new Error("Agent must have Rating and FixedPricing");
  }

  const t = await getTranslations("Data.Agent");

  return {
    id: agent.id,
    onChainIdentifier: agent.onChainIdentifier,
    name: agent.overrideName ?? agent.name,
    description:
      agent.overrideDescription ?? agent.description ?? t("defaultDescription"),
    exampleOutput:
      agent.overrideExampleOutput.length > 0
        ? agent.overrideExampleOutput.map((example) => ({
            id: example.id,
            name: example.name,
            mimeType: example.mimeType,
            url: ipfsUrlResolver(example.url),
          }))
        : agent.exampleOutput.map((example) => ({
            id: example.id,
            name: example.name,
            mimeType: example.mimeType,
            url: ipfsUrlResolver(example.url),
          })),
    averageStars:
      Number(agent.rating.totalRatings) === 0
        ? null
        : Math.min(
            5,
            Math.round(
              Number(agent.rating.totalStars) /
                Number(agent.rating.totalRatings),
            ),
          ),
    author: agent.overrideAuthorName ?? agent.authorName,
    legal: (() => {
      const privacyPolicy =
        agent.overrideLegalPrivacyPolicy ?? agent.legalPrivacyPolicy;
      const terms = agent.overrideLegalTerms ?? agent.legalTerms;
      const other = agent.overrideLegalOther ?? agent.legalOther;
      return privacyPolicy || terms || other
        ? { privacyPolicy, terms, other }
        : undefined;
    })(),
    tags:
      agent.overrideTags.length > 0
        ? agent.overrideTags.map((tag) => tag.name)
        : agent.tags.map((tag) => tag.name),
    image: ipfsUrlResolver(agent.overrideImage ?? agent.image),
    credits: calculateCredits(
      Number(agent.pricing.fixedPricing.amounts[0].amount),
    ),
  };
}
