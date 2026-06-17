import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";

import type { AgentExampleOutput } from "@/lib/clients/generated/core";
import { SPECIAL_AGENT_CATEGORY_SLUGS } from "@/lib/constants/agent-categories";
import { categoryStylesSchema } from "@/lib/schemas/category";
import type { AgentLegal } from "@/lib/types/agent";
import type { CategoryStyles } from "@/lib/types/category";
import { type CoreAgentDto, isCoreAgentDetail } from "@/lib/types/core-dto";

interface AgentJobAgentSource {
  name: string;
  overrideName?: string | null;
  image?: string | null;
  overrideImage?: string | null;
  legalPrivacyPolicy?: string | null;
  overrideLegalPrivacyPolicy?: string | null;
  legalTerms?: string | null;
  overrideLegalTerms?: string | null;
  legalDpa?: string | null;
  overrideLegalDpa?: string | null;
  legalOther?: string | null;
  overrideLegalOther?: string | null;
}

export function getAgentName(
  agent: CoreAgentDto | AgentJobAgentSource,
): string {
  if ("overrideName" in agent && agent.overrideName) {
    return agent.overrideName;
  }

  return agent.name;
}

export function getAgentDescription(agent: CoreAgentDto): string | null {
  return agent.description ?? null;
}

export function getAgentResolvedImage(
  agent: CoreAgentDto | AgentJobAgentSource,
): string | null {
  const image =
    "overrideImage" in agent && agent.overrideImage
      ? agent.overrideImage
      : agent.image;
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

export function getAgentTags(agent: CoreAgentDto): string[] {
  return isCoreAgentDetail(agent) ? agent.tags : [];
}

export function getAgentCategorySlugs(agent: CoreAgentDto): string[] {
  return agent.categories.map((category) => category.slug);
}

export function isAgentNew(agent: CoreAgentDto): boolean {
  return getAgentCategorySlugs(agent).includes(
    SPECIAL_AGENT_CATEGORY_SLUGS.NEW,
  );
}

export function getAgentLegal(
  agent: CoreAgentDto | AgentJobAgentSource,
): AgentLegal | null {
  const privacyPolicy = getAgentLegalPrivacyPolicy(agent);
  const terms = getAgentLegalTerms(agent);
  const dpa = getAgentLegalDpa(agent);
  const other = getAgentLegalOther(agent);
  return privacyPolicy || terms || dpa || other
    ? { privacyPolicy, terms, dpa, other }
    : null;
}

export function getAgentLegalPrivacyPolicy(
  agent: CoreAgentDto | AgentJobAgentSource,
): string | null {
  if ("legal" in agent) {
    return agent.legal.privacyPolicy ?? null;
  }

  return agent.overrideLegalPrivacyPolicy ?? agent.legalPrivacyPolicy ?? null;
}

export function getAgentLegalTerms(
  agent: CoreAgentDto | AgentJobAgentSource,
): string | null {
  if ("legal" in agent) {
    return agent.legal.terms ?? null;
  }

  return agent.overrideLegalTerms ?? agent.legalTerms ?? null;
}

export function getAgentLegalDpa(
  agent: CoreAgentDto | AgentJobAgentSource,
): string | null {
  if ("legal" in agent) {
    return agent.legal.dpa ?? null;
  }

  return agent.overrideLegalDpa ?? agent.legalDpa ?? null;
}

export function getAgentLegalOther(
  agent: CoreAgentDto | AgentJobAgentSource,
): string | null {
  if ("legal" in agent) {
    return agent.legal.other ?? null;
  }

  return agent.overrideLegalOther ?? agent.legalOther ?? null;
}

export function getAgentAuthorOrganization(agent: CoreAgentDto): string | null {
  return agent.author.organization ?? null;
}

export function getShortAgentAuthorName(agent: CoreAgentDto): string | null {
  const organization = getAgentAuthorOrganization(agent);
  if (organization) {
    return organization;
  }
  return agent.author.name ?? null;
}

export function getFullAgentAuthorName(agent: CoreAgentDto): string | null {
  const organization = getAgentAuthorOrganization(agent);
  const name = agent.author.name ?? null;

  if (organization && name) {
    return `${organization} (${name})`;
  } else if (organization) {
    return organization;
  }
  return name;
}

export function getAgentAuthorResolvedImage(
  agent: CoreAgentDto,
): string | null {
  const image = agent.author.image;
  return image ? resolveIpfsOrHttpUrl(image) : null;
}

export function getAgentSummary(agent: CoreAgentDto): string | null {
  return agent.summary;
}

export function getAgentAuthorEmail(agent: CoreAgentDto): string | null {
  return agent.author.email ?? null;
}

export function getAgentAuthorOther(agent: CoreAgentDto): string | null {
  return agent.author.other ?? null;
}

export function getAgentCredits(agent: CoreAgentDto): number {
  return agent.credits;
}

export function getAgentExampleOutputs(
  agent: CoreAgentDto,
): AgentExampleOutput[] {
  return isCoreAgentDetail(agent) ? agent.exampleOutputs : [];
}

export function getAgentResolvedExampleOutputUrl(
  exampleOutput: AgentExampleOutput,
): string {
  return resolveIpfsOrHttpUrl(exampleOutput.url);
}

const DEFAULT_CATEGORY_STYLES: CategoryStyles = {
  light: {
    color: "text-default-foreground",
  },
  dark: {
    color: "text-default-foreground",
  },
};

export function getAgentCategoryStyles(agent: CoreAgentDto): CategoryStyles {
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
