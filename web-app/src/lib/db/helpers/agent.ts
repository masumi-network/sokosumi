import {
  AgentDemoData,
  AgentDemoValues,
  AgentLegal,
  AgentWithExampleOutput,
  AgentWithTags,
} from "@/lib/db/types";
import { ipfsUrlResolver } from "@/lib/ipfs";
import { JobInputsDataSchemaType, jobInputsFormSchema } from "@/lib/job-input";
import { jobStatusResponseSchema } from "@/lib/schemas";
import { Agent, ExampleOutput } from "@/prisma/generated/client";

export function getAgentName(agent: Agent): string {
  return agent.overrideName ?? agent.name;
}

export function getAgentDescription(agent: Agent): string | null {
  return agent.overrideDescription ?? agent.description;
}

export function getAgentResolvedImage(agent: Agent): string {
  return ipfsUrlResolver(agent.overrideImage ?? agent.image);
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

export function getAgentAuthorResolvedImage(agent: Agent): string | null {
  const image = agent.overrideAuthorImage ?? agent.authorImage;
  return image ? ipfsUrlResolver(image) : null;
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
  return ipfsUrlResolver(exampleOutput.url);
}

export function getAgentDemoValues(
  agent: Agent,
  inputSchema: JobInputsDataSchemaType,
): AgentDemoValues | null {
  const demoData = getAgentDemoData(agent);
  if (!demoData) {
    return null;
  }

  try {
    const inputParsedResult = jobInputsFormSchema(
      inputSchema.input_data,
    ).safeParse(JSON.parse(demoData.demoInput));
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
