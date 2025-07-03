import "server-only";

import { getEnvSecrets } from "@/config/env.secrets";
import { getPaymentInformation } from "@/lib/api/generated/registry";
import { getRegistryClient } from "@/lib/api/registry-service.client";
import { AgentWithRelations } from "@/lib/db";
import { jobInputsDataSchema, JobInputsDataSchemaType } from "@/lib/job-input";
import { Err, Ok, Result } from "@/lib/ts-res";
import { safeAddPathComponent } from "@/lib/utils/url";
import { Agent } from "@/prisma/generated/client";

function getAgentApiBaseUrl(agent: Agent): URL {
  // Validate the API base URL
  const blacklistedHostnames = getEnvSecrets().BLACKLISTED_AGENT_HOSTNAMES;
  const apiBaseUrl = new URL(agent.apiBaseUrl);
  if (blacklistedHostnames.includes(apiBaseUrl.hostname)) {
    throw new Error("Agent API base URL is not allowed");
  }
  if (apiBaseUrl.protocol !== "https:" && apiBaseUrl.protocol !== "http:") {
    throw new Error("Agent API base URL must be HTTP or HTTPS");
  }

  if (apiBaseUrl.search !== "") {
    throw new Error("Agent API base URL must not have a query string");
  }
  if (apiBaseUrl.hash !== "") {
    throw new Error("Agent API base URL must not have a hash");
  }

  const usedUrl = agent.overrideApiBaseUrl ?? agent.apiBaseUrl;
  return new URL(usedUrl);
}

export function getAgentUrlWithPathComponent(
  agent: Agent,
  pathComponent: string,
): URL {
  const baseUrl = getAgentApiBaseUrl(agent);
  return safeAddPathComponent(baseUrl, pathComponent);
}

export async function fetchAgentInputSchema(
  agent: AgentWithRelations,
): Promise<Result<JobInputsDataSchemaType, string>> {
  try {
    const inputSchemaUrl = getAgentUrlWithPathComponent(agent, "input_schema");
    const response = await fetch(inputSchemaUrl);

    if (!response.ok) {
      return Err(response.statusText);
    }

    const parsedResult = jobInputsDataSchema().safeParse(await response.json());

    if (!parsedResult.success) {
      return Err("Failed to parse input schema");
    }
    const inputSchema = parsedResult.data;
    return Ok(inputSchema);
  } catch (err) {
    return Err(String(err));
  }
}

interface FixedPricing {
  pricingType: "Fixed";
  FixedPricing: {
    Amounts: Array<{
      amount: string;
      unit: string;
    }>;
  };
}
export async function getAgentPaymentInformation(
  agent: Agent,
): Promise<Result<FixedPricing, string>> {
  try {
    const registryClient = getRegistryClient();

    const paymentInformation = await getPaymentInformation({
      client: registryClient,
      query: {
        agentIdentifier: agent.blockchainIdentifier,
      },
    });
    if (
      !paymentInformation ||
      !paymentInformation.data ||
      !paymentInformation.data.data
    ) {
      return Err("Payment information not found or invalid price");
    }
    return Ok(paymentInformation.data.data.AgentPricing);
  } catch (err) {
    return Err(String(err));
  }
}
