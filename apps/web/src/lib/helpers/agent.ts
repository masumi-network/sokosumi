import {
  type Agent,
  type AgentWithCategories,
  type AgentWithCreditsPrice,
  type AgentWithExampleOutput,
  type AgentWithPricing,
  type AgentWithTags,
  type ExampleOutput,
  PricingType,
} from "@sokosumi/database";
import type { InputSchemaSchemaType } from "@sokosumi/masumi/schemas";
import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";

import { SPECIAL_AGENT_CATEGORY_SLUGS } from "@/lib/constants/agent-categories";
import { jobInputsFormSchema } from "@/lib/job-input/form";
import {
  jobStatusResponseSchema,
  type PricingAmountsSchemaType,
} from "@/lib/schemas";
import { categoryStylesSchema } from "@/lib/schemas/category";
import { flattenInputs } from "@/lib/schemas/job";
import type {
  AgentDemoData,
  AgentDemoValues,
  AgentLegal,
} from "@/lib/types/agent";
import type { CategoryStyles } from "@/lib/types/category";

/** Agent type including legal/author fields from schema (Prisma client may not expose them). */
type AgentWithOverrides = Agent & {
  authorName?: string | null;
  authorOrganization?: string | null;
  legalDpa?: string | null;
  legalOther?: string | null;
  legalPrivacyPolicy?: string | null;
  legalTerms?: string | null;
  overrideAuthorName?: string | null;
  overrideAuthorOrganization?: string | null;
  overrideLegalDpa?: string | null;
  overrideLegalOther?: string | null;
  overrideLegalPrivacyPolicy?: string | null;
  overrideLegalTerms?: string | null;
};

/**
 * Structural subsets accepted by the resolved-field helpers so both Prisma
 * agents and the core job/agent DTOs (e.g. `Job["agent"]`) can be passed.
 */
interface AgentNameSource {
  name: string;
  overrideName?: string | null;
}

interface AgentImageSource {
  image?: string | null;
  overrideImage?: string | null;
}

interface AgentLegalSource {
  legalDpa?: string | null;
  legalOther?: string | null;
  legalPrivacyPolicy?: string | null;
  legalTerms?: string | null;
  overrideLegalDpa?: string | null;
  overrideLegalOther?: string | null;
  overrideLegalPrivacyPolicy?: string | null;
  overrideLegalTerms?: string | null;
}

export function getAgentName(agent: AgentNameSource): string {
  return agent.overrideName ?? agent.name;
}

export function getAgentDescription(
  agent: Agent | AgentWithCreditsPrice,
): string | null {
  return agent.overrideDescription ?? agent.description;
}

export function getAgentResolvedImage(agent: AgentImageSource): string | null {
  const image = agent.overrideImage ?? agent.image;
  if (!image) {
    return null;
  }
  return resolveIpfsOrHttpUrl(image);
}

export function getAgentResolvedIcon(agent: {
  icon?: string | null;
}): string | null {
  if (!agent.icon) {
    return null;
  }
  const resolvedUrl = resolveIpfsOrHttpUrl(agent.icon);

  try {
    new URL(resolvedUrl);
    return resolvedUrl;
  } catch (_error) {
    return null;
  }
}

export function getAgentTags(agent: AgentWithTags): string[] {
  return agent.overrideTags.length > 0
    ? agent.overrideTags.map((tag) => tag.name)
    : agent.tags.map((tag) => tag.name);
}

export function getAgentCategorySlugs(agent: AgentWithCategories): string[] {
  return agent.categories.map((category) => category.slug);
}

export function isAgentNew(agent: AgentWithCategories): boolean {
  return getAgentCategorySlugs(agent).includes(
    SPECIAL_AGENT_CATEGORY_SLUGS.NEW,
  );
}

export function getAgentLegal(agent: AgentLegalSource): AgentLegal | null {
  const privacyPolicy = getAgentLegalPrivacyPolicy(agent);
  const terms = getAgentLegalTerms(agent);
  const dpa = getAgentLegalDpa(agent);
  const other = getAgentLegalOther(agent);
  return privacyPolicy || terms || dpa || other
    ? { privacyPolicy, terms, dpa, other }
    : null;
}

export function getAgentLegalPrivacyPolicy(
  agent: AgentLegalSource,
): string | null {
  return agent.overrideLegalPrivacyPolicy ?? agent.legalPrivacyPolicy ?? null;
}

export function getAgentLegalTerms(agent: AgentLegalSource): string | null {
  return agent.overrideLegalTerms ?? agent.legalTerms ?? null;
}

export function getAgentLegalDpa(agent: AgentLegalSource): string | null {
  return agent.overrideLegalDpa ?? agent.legalDpa ?? null;
}

export function getAgentLegalOther(agent: AgentLegalSource): string | null {
  return agent.overrideLegalOther ?? agent.legalOther ?? null;
}

export function getAgentAuthorOrganization(agent: Agent): string | null {
  const a = agent as AgentWithOverrides;
  return a.overrideAuthorOrganization ?? a.authorOrganization ?? null;
}

export function getShortAgentAuthorName(agent: Agent): string | null {
  const a = agent as AgentWithOverrides;
  const organization = getAgentAuthorOrganization(agent);
  if (organization) {
    return organization;
  }
  return a.overrideAuthorName ?? a.authorName ?? null;
}

export function getFullAgentAuthorName(agent: Agent): string | null {
  const a = agent as AgentWithOverrides;
  const organization = getAgentAuthorOrganization(agent);
  const name = a.overrideAuthorName ?? a.authorName ?? null;

  if (organization && name) {
    return `${organization} (${name})`;
  } else if (organization) {
    return organization;
  }
  return name;
}

export function getAgentAuthorResolvedImage(agent: Agent): string | null {
  const image = agent.overrideAuthorImage ?? agent.authorImage;
  return image ? resolveIpfsOrHttpUrl(image) : null;
}

export function getAgentSummary(agent: Agent): string | null {
  return agent.summary;
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
  return resolveIpfsOrHttpUrl(exampleOutput.url);
}

/**
 * Get the pricing amounts for an agent.
 * @param agent - The agent with pricing.
 * @returns The pricing amounts or null if pricing is invalid or unknown.
 */
export function getAgentPricingAmounts(
  agent: AgentWithPricing,
): PricingAmountsSchemaType | null {
  switch (agent.pricing.pricingType) {
    case PricingType.FIXED: {
      if (
        !agent.pricing.fixedPricing ||
        agent.pricing.fixedPricing.amounts.length === 0
      ) {
        return null;
      }
      return agent.pricing.fixedPricing.amounts.map((amount) => ({
        unit: amount.unit,
        amount: amount.amount,
      }));
    }
    case PricingType.FREE: {
      return [];
    }
    case PricingType.UNKNOWN: {
      return null;
    }
  }
}

export function getAgentDemoValues(
  agent: Agent,
  inputSchema: InputSchemaSchemaType,
): AgentDemoValues | null {
  const demoData = getAgentDemoData(agent);
  if (!demoData) {
    return null;
  }

  try {
    const flatInputs = flattenInputs(inputSchema);

    const inputParsedResult = jobInputsFormSchema(flatInputs).safeParse(
      JSON.parse(demoData.demoInput),
    );
    if (!inputParsedResult.success) {
      console.error(
        "Failed to parse agent demo input",
        inputParsedResult.error,
      );
      return null;
    }

    const outputParsedResult = jobStatusResponseSchema.safeParse(
      JSON.parse(demoData.demoOutput),
    );
    if (!outputParsedResult.success) {
      console.error(
        "Failed to parse agent demo output",
        outputParsedResult.error,
      );
      return null;
    }

    return { input: inputParsedResult.data, output: outputParsedResult.data };
  } catch (error) {
    console.error("Failed to parse agent demo values", error);
    return null;
  }
}

export function getAgentDemoData(agent: Agent): AgentDemoData | null {
  return !!agent.demoInput && !!agent.demoOutput
    ? { demoInput: agent.demoInput, demoOutput: agent.demoOutput }
    : null;
}

const DEFAULT_CATEGORY_STYLES: CategoryStyles = {
  light: {
    color: "text-default-foreground",
  },
  dark: {
    color: "text-default-foreground",
  },
};

export function getAgentCategoryStyles(
  agent: AgentWithCategories,
): CategoryStyles {
  if (!agent.categories || agent.categories.length === 0) {
    return DEFAULT_CATEGORY_STYLES;
  }

  const firstCategory = agent.categories.filter(
    (category) => category.styles,
  )[0];

  if (!firstCategory?.styles) {
    return DEFAULT_CATEGORY_STYLES;
  }

  try {
    let rawStyles: unknown;
    if (typeof firstCategory.styles === "string") {
      rawStyles = JSON.parse(firstCategory.styles);
    } else {
      rawStyles = firstCategory.styles;
    }

    const validationResult = categoryStylesSchema.safeParse(rawStyles);
    if (validationResult.success) {
      return validationResult.data;
    }

    return DEFAULT_CATEGORY_STYLES;
  } catch {
    return DEFAULT_CATEGORY_STYLES;
  }
}
