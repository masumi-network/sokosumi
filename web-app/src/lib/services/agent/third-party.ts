import "server-only";

import { Err, Ok, Result } from "ts-res";

import { getEnvSecrets } from "@/config/env.secrets";
import { getPaymentInformation } from "@/lib/api/generated/registry";
import { getRegistryClient } from "@/lib/api/registry-service.client";
import { AgentWithRelations } from "@/lib/db";
import { jobInputsDataSchema, JobInputsDataSchemaType } from "@/lib/job-input";
import { Agent } from "@/prisma/generated/client";

export function getAgentApiBaseUrl(agent: Agent): URL {
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
  const cleanedUrl = usedUrl.endsWith("/") ? usedUrl.slice(0, -1) : usedUrl;
  return new URL(cleanedUrl);
}

export async function fetchAgentInputSchema(
  agent: AgentWithRelations,
): Promise<Result<JobInputsDataSchemaType, string>> {
  try {
    const baseUrl = getAgentApiBaseUrl(agent);
    const inputSchemaUrl = new URL(`${baseUrl.href}/input_schema`);
    console.log("fetching input schema for", inputSchemaUrl.href);
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
